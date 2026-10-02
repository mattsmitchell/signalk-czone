'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const {
  parseRawLine,
  createFastPacketReassembler,
  decodeCzoneHeader,
  CIRCUIT_STATUS_PGN,
  CZONE_CONFIG_CLAIM_PGN,
  CZONE_DATABLOCK_ACK_PGN,
  CZONE_DATABLOCK_PGN,
  emitPgn
} = require('./lib/nmea2000')
const circuitState = require('./lib/circuit-state')
const signalk = require('./lib/signalk')
const czone = require('./lib/czone')
const zcf = require('./lib/zcf')

const CURRENT_PGN_DC = 130822
const CURRENT_PGN_AC = 130817
const AC_CURRENT_SCALE = 0.2 // observed: raw 40 == 8.0 A on Water Heater Port
const DC_CURRENT_SCALE = 0.1 // DC record byte 0: 0.1 A/count
const DC_LEVEL_OFF = 0x0400
const DC_LEVEL_DIMMED_MIN = 0x0401
const DC_LEVEL_ON_100 = 0x07e8
const DC_LEVEL_ON_MAX = 0x0800
const RECORD_COUNT = 8
const RECORD_SIZE = 3
const CZONE_PAYLOAD_SIZE = 28
const MAX_UPLOAD_BYTES = 1024 * 1024
const CZONE_CONFIG_BLOCK_HEADER = 23
const CZONE_CONFIG_BLOCK_SIZE = 200
const CZONE_CONFIG_READ_TIMEOUT_MS = 45000
const STATUS_PGN = CIRCUIT_STATUS_PGN

function hex2 (value) {
  return Number(value).toString(16).padStart(2, '0')
}

function safeName (value) {
  const text = String(value || 'CZoneCircuit').trim()
  const cleaned = text
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'CZoneCircuit'
}

function getConfig (config) {
  const c = config && config.configuration ? config.configuration : (config || {})
  return {
    zcfPath: c.zcfPath || '',
    logUnmapped: c.logUnmapped === true,
    debugRaw: c.debugRaw === true,
    allowCzoneWrite: c.allowCzoneWrite === true
  }
}

function safeFilename (value) {
  const base = path.basename(String(value || 'CZone.zcf'))
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!cleaned.toLowerCase().endsWith('.zcf')) return `${cleaned}.zcf`
  return cleaned
}

function loadMapping (zcfPath) {
  const zcf = require('./lib/zcf')

  const loaders = ['loadZcf', 'parseZcf', 'load', 'parse']
  for (const name of loaders) {
    if (typeof zcf[name] === 'function') return zcf[name](zcfPath)
  }
  if (typeof zcf === 'function') return zcf(zcfPath)
  if (zcf && typeof zcf.default === 'function') return zcf.default(zcfPath)
  throw new Error('lib/zcf.js does not expose a ZCF loader (expected loadZcf/parseZcf/load/parse)')
}

function lookupMapping (zcf, mapping, module, page, slot, pgn) {
  if (zcf && typeof zcf.lookup === 'function') return zcf.lookup(mapping, module, page, slot, pgn)
  if (!mapping || !Array.isArray(mapping.currentMappings)) return null
  return mapping.currentMappings.find(x =>
    Number(x.module) === module &&
    Number(x.page) === page &&
    Number(x.slot) === slot &&
    (pgn === undefined || Number(x.pgn) === pgn)
  ) || null
}

function mappingName (entry) {
  return entry && (entry.friendlyName || entry.name || entry.label || entry.circuitName)
}

function publishCurrent (app, entry, module, channel, current, pgn, source) {
  const friendly = safeName(mappingName(entry))
  const pathName = `electrical.czone.${friendly}.current`
  const circuitType = pgn === CURRENT_PGN_AC ? 'AC' : 'DC'

  // Keep the stable public Signal K path free of transport/protocol details.
  // The circuit class is carried in source metadata as well as the source
  // identity. signalk-to-influxdb2 persists the resulting $source as its
  // `source` tag, so Grafana/Influx can distinguish AC from DC without
  // changing the established electrical.czone.<circuit>.current names.
  app.handleMessage('signalk-czone', {
    updates: [{
      source: {
        label: `CZone-${circuitType}`,
        type: 'CZone',
        src: source,
        pgn
      },
      timestamp: new Date().toISOString(),
      meta: [{
        path: pathName,
        value: {
          description: `${circuitType} CZone circuit current`,
          circuitType,
          czonePgn: pgn
        }
      }],
      values: [{ path: pathName, value: current }]
    }]
  })
  return pathName
}

function readRequestBody (req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = error => {
      if (settled) return
      settled = true
      reject(error)
      try { req.destroy() } catch (_) {}
    }
    req.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        fail(new Error(`Upload exceeds ${maxBytes} bytes`))
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    req.on('error', fail)
  })
}

function parseMultipartSingleFile (body, contentType) {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '')
  if (!match) throw new Error('Expected multipart/form-data upload')
  const boundary = match[1] || match[2]
  const delimiter = Buffer.from(`--${boundary}`)
  let pos = 0

  while (true) {
    const start = body.indexOf(delimiter, pos)
    if (start < 0) break
    let cursor = start + delimiter.length
    if (body[cursor] === 45 && body[cursor + 1] === 45) break
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd < 0) throw new Error('Malformed multipart upload')
    const headerText = body.subarray(cursor, headerEnd).toString('utf8')
    const nextBoundary = body.indexOf(delimiter, headerEnd + 4)
    if (nextBoundary < 0) throw new Error('Malformed multipart upload: missing boundary')

    let dataEnd = nextBoundary
    if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2
    const data = body.subarray(headerEnd + 4, dataEnd)
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)
    const filenameMatch = disposition && /filename="([^"]*)"/i.exec(disposition[1])
    if (filenameMatch) {
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)
      return {
        filename: filenameMatch[1],
        contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
        data
      }
    }
    pos = nextBoundary + delimiter.length
  }
  throw new Error('No file field found in upload')
}

module.exports = function (app) {
  let rawListener = null
  let reassembler = null
  let mapping = null
  let config = {}
  let running = false
  let restartPlugin = null
  let startedAt = null
  const circuitStatus = new Map()
  const runtimeState = new Map()
  const publishedCircuitValues = new Map()
  let configTransfer = null
  let configTransferTimer = null
  let configFastPacket = null
  let lastNetworkConfig = null

  const stats = {
    rawFrames: 0,
    packetsDecoded: 0,
    valuesPublished: 0,
    dcPackets: 0,
    acPackets: 0,
    unmapped: 0,
    unmappedDc: 0,
    unmappedAc: 0,
    invalidCzone: 0,
    parseErrors: 0,
    decodeErrors: 0,
    lastError: null,
    lastPacket: null,
    lastDcPacket: null,
    lastAcPacket: null,
    lastRawFrame: null,
    lastPublished: null
  }

  function log (message) {
    if (typeof app.debug === 'function') app.debug(message)
    else if (typeof app.setPluginStatus === 'function') app.setPluginStatus(message)
  }

  function setStatus (message) {
    if (typeof app.setPluginStatus === 'function') app.setPluginStatus(message)
  }

  function decodeDcLevel (valueRaw) {
    if (valueRaw === DC_LEVEL_OFF) return { state: 'OFF', percent: 0 }
    if (valueRaw >= DC_LEVEL_DIMMED_MIN && valueRaw < DC_LEVEL_ON_100) {
      return { state: 'DIMMED', percent: Number(((valueRaw - 1024) / 10).toFixed(1)) }
    }
    if (valueRaw >= DC_LEVEL_ON_100 && valueRaw <= DC_LEVEL_ON_MAX) {
      return { state: 'ON', percent: 100 }
    }
    return { state: 'UNKNOWN', percent: null }
  }

  function initialiseCircuitState () {
    runtimeState.clear()
    publishedCircuitValues.clear()
    if (!mapping || !Array.isArray(mapping.circuits)) return

    for (const circuit of mapping.circuits) {
      runtimeState.set(circuit.name, {
        state: null,
        percent: null,
        lastObservedPercent: null,
        statusObserved: false,
        lastObserved: null,
        zcfCircuitId: circuit.zcfCircuitId,
        protocolCircuitId: circuit.protocolCircuitId,
        capabilities: circuit.capabilities
      })
    }
  }

  function emitNmea ({ pgn, data, description }) {
    if (config.allowCzoneWrite !== true) {
      throw new Error('CZone write control is disabled; enable "Enable CZone read/write control" in plugin configuration first')
    }
    const line = emitPgn(app, { src: 0, pgn, data })
    log(`NMEA 2000 OUT: PGN ${pgn}${description ? ` ${description}` : ''} ${czone.hex(data)}`)
    return line
  }

  function clearConfigTransfer () {
    if (configTransferTimer) clearTimeout(configTransferTimer)
    configTransferTimer = null
    configTransfer = null
  }

  function failConfigTransfer (message) {
    if (configTransfer) {
      configTransfer.status = 'failed'
      configTransfer.finishedAt = new Date().toISOString()
      configTransfer.message = message
      lastNetworkConfig = configTransfer
    }
    if (configTransferTimer) clearTimeout(configTransferTimer)
    configTransferTimer = null
    configFastPacket = null
    if (typeof message === 'string') stats.lastError = message
  }

  function finishConfigTransfer (buffer, target, source) {
    const state = configTransfer
    if (!state) return
    try {
      const parsed = zcf.parse(buffer)
      const vesselName = parsed.vesselName || 'CZone Network'
      state.status = 'complete'
      state.finishedAt = new Date().toISOString()
      state.bytes = buffer.length
      state.vesselName = vesselName
      state.circuits = parsed.circuits.length
      state.modes = parsed.modes.length
      state.target = target
      state.source = source
      state.buffer = buffer
      state.message = `Received CZone network configuration (${buffer.length} bytes, ${parsed.circuits.length} circuits, ${parsed.modes.length} modes)`
      lastNetworkConfig = state
      if (configTransferTimer) clearTimeout(configTransferTimer)
      configTransferTimer = null
      configTransfer = null
      log(`CZone network configuration read complete: ${state.message}`)
    } catch (error) {
      failConfigTransfer(`CZone network configuration could not be parsed: ${error.message}`)
    }
  }

  function handleConfigDataBlock (packet) {
    if (!configTransfer || configTransfer.status !== 'reading' || !packet || !Buffer.isBuffer(packet.payload)) return
    const payload = packet.payload
    if (payload.length < CZONE_CONFIG_BLOCK_HEADER || payload[0] !== 0x27 || payload[1] !== 0x99) return

    const blockIndex = payload.readUInt16LE(2)
    const target = payload[4]
    const chunk = payload.subarray(CZONE_CONFIG_BLOCK_HEADER)
    if (chunk.length > CZONE_CONFIG_BLOCK_SIZE) {
      failConfigTransfer(`CZone DataBlock ${blockIndex} contains ${chunk.length} bytes; maximum is ${CZONE_CONFIG_BLOCK_SIZE}`)
      return
    }

    if (configTransfer.target == null) configTransfer.target = target
    if (configTransfer.target !== target) return
    configTransfer.source = packet.source
    configTransfer.lastPacketAt = new Date().toISOString()

    if (chunk.length === 0) {
      const maxDataBlock = Math.max(-1, ...Array.from(configTransfer.blocks.keys()))
      for (let i = 0; i <= maxDataBlock; i++) {
        if (!configTransfer.blocks.has(i)) {
          failConfigTransfer(`Missing CZone configuration DataBlock ${i} before terminator ${blockIndex}`)
          return
        }
      }
      const parts = []
      for (let i = 0; i <= maxDataBlock; i++) parts.push(configTransfer.blocks.get(i))
      const buffer = Buffer.concat(parts)
      emitNmea({
        pgn: CZONE_DATABLOCK_ACK_PGN,
        data: czone.configDataBlockAck(target, blockIndex, 1),
        description: `CZone CONFIG ACK final block=${blockIndex}`
      })
      return finishConfigTransfer(buffer, target, packet.source)
    }

    if (!configTransfer.blocks.has(blockIndex)) {
      configTransfer.blocks.set(blockIndex, Buffer.from(chunk))
    }

    emitNmea({
      pgn: CZONE_DATABLOCK_ACK_PGN,
      data: czone.configDataBlockAck(target, blockIndex, 0),
      description: `CZone CONFIG ACK block=${blockIndex}`
    })

    configTransfer.receivedBytes = Array.from(configTransfer.blocks.values()).reduce((sum, part) => sum + part.length, 0)
    configTransfer.blockCount = configTransfer.blocks.size
  }

  function handleConfigFastPacket (frame) {
    if (!configTransfer || configTransfer.status !== 'reading') return
    if (!frame || frame.pgn !== CZONE_DATABLOCK_PGN || !frame.data || frame.data.length < 2) return

    const control = frame.data[0]
    const sequence = control >>> 5
    const frameNo = control & 0x1f
    const key = `${frame.source}:${sequence}`

    if (frameNo === 0) {
      const size = frame.data[1]
      if (size < CZONE_CONFIG_BLOCK_HEADER || size > 223) return
      configFastPacket = {
        key,
        source: frame.source,
        sequence,
        size,
        nextFrame: 1,
        payload: Buffer.from(frame.data.subarray(2)),
        timestamp: frame.timestamp
      }
    } else {
      if (!configFastPacket || configFastPacket.key !== key || frameNo !== configFastPacket.nextFrame) {
        configFastPacket = null
        return
      }
      configFastPacket.payload = Buffer.concat([configFastPacket.payload, frame.data.subarray(1)])
      configFastPacket.nextFrame = (configFastPacket.nextFrame + 1) & 0x1f
    }

    if (!configFastPacket || configFastPacket.payload.length < configFastPacket.size) return

    const packet = {
      pgn: CZONE_DATABLOCK_PGN,
      source: configFastPacket.source,
      timestamp: configFastPacket.timestamp,
      payload: configFastPacket.payload.subarray(0, configFastPacket.size)
    }
    configFastPacket = null
    handleConfigDataBlock(packet)
  }

  function readConfigurationFromNetwork () {
    if (config.allowCzoneWrite !== true) {
      throw new Error('CZone write control is disabled; enable "Enable CZone read/write control" before reading configuration from the network')
    }
    if (configTransfer && configTransfer.status === 'reading') {
      throw new Error('A CZone network configuration read is already in progress')
    }

    clearConfigTransfer()
    configFastPacket = null
    const startedAt = new Date().toISOString()
    configTransfer = {
      status: 'reading',
      startedAt,
      blocks: new Map(),
      receivedBytes: 0,
      blockCount: 0,
      target: null,
      source: null
    }
    lastNetworkConfig = configTransfer
    configTransferTimer = setTimeout(
      () => failConfigTransfer(`Timed out after ${CZONE_CONFIG_READ_TIMEOUT_MS / 1000}s waiting for the CZone configuration transfer`),
      CZONE_CONFIG_READ_TIMEOUT_MS
    )

    try {
      emitNmea({
        pgn: CZONE_CONFIG_CLAIM_PGN,
        data: czone.configReadRequest(),
        description: 'CZone READ CONFIGURATION DATA'
      })
    } catch (error) {
      failConfigTransfer(error.message)
      throw error
    }

    return configTransfer
  }

  function publishCircuitDelta (circuit, pathName, value, source) {
    const previous = publishedCircuitValues.get(pathName)
    if (previous !== undefined && Object.is(previous, value)) return false

    publishedCircuitValues.set(pathName, value)
    const delta = signalk.circuitDelta(pathName, value, circuit, source)
    if (typeof app.handleMessage === 'function') {
      app.handleMessage('signalk-czone', delta)
    } else if (typeof app.emit === 'function') {
      app.emit('delta', delta)
    }
    return true
  }

  function decodeCircuitStatus (frame) {
    if (!frame || frame.pgn !== STATUS_PGN || !Buffer.isBuffer(frame.data) || frame.data.length !== 8) return
    const status = circuitState.decodeCircuitStatus(frame.data)
    if (!status || !mapping) return

    const hasModule = mapping.circuits.some(c => Number(c.statusModule) === status.module)
    if (!hasModule) return

    for (const circuit of mapping.circuits) {
      if (Number(circuit.statusModule) !== status.module) continue

      const enabled = circuitState.circuitEnabled(status, circuit)
      if (enabled == null) continue

      const state = runtimeState.get(circuit.name)
      if (state) {
        state.statusObserved = true
        state.state = enabled ? 'ON' : 'OFF'
        state.lastObserved = {
          state: enabled ? 'ON' : 'OFF',
          source: { src: frame.source, pgn: frame.pgn }
        }
      }

      publishCircuitDelta(
        circuit,
        signalk.statePath(circuit),
        enabled,
        signalk.nmea2000Source(frame.source, frame.pgn)
      )

      circuitStatus.set(signalk.statePath(circuit), {
        pgn: frame.pgn,
        module: status.module,
        subtype: status.subtype,
        bitmap: status.bitmap,
        state: enabled ? 'ON' : 'OFF',
        path: signalk.statePath(circuit),
        source: frame.source,
        timestamp: new Date().toISOString()
      })
    }
  }

  function decodeDcLevelAndPublish (packet) {
    if (!mapping || !packet || packet.pgn !== CURRENT_PGN_DC || packet.payload.length !== CZONE_PAYLOAD_SIZE) return
    const header = decodeCzoneHeader(packet.payload, CURRENT_PGN_DC)
    if (!header) return

    for (let slot = 0; slot < RECORD_COUNT; slot++) {
      const i = 4 + slot * RECORD_SIZE
      const levelRaw = packet.payload[i + 1] | (packet.payload[i + 2] << 8)
      const level = circuitState.decodeDcLevel(levelRaw)

      const circuit = mapping.circuits.find(c =>
        Number(c.statusModule) === header.module &&
        Number.isInteger(c.statusBit) &&
        Math.floor(c.statusBit / 8) === header.page &&
        (c.statusBit % 8) === slot
      )
      if (!circuit || level.percent == null) continue

      const state = runtimeState.get(circuit.name)
      if (state) {
        state.percent = level.percent
        state.lastObservedPercent = level.percent
      }

      publishCircuitDelta(
        circuit,
        signalk.brightnessPath(circuit),
        Math.max(0, Math.min(100, level.percent)) / 100,
        signalk.nmea2000Source(packet.source, packet.pgn)
      )
    }
  }

  function decodeDc (packet) {
    const header = decodeCzoneHeader(packet.payload, CURRENT_PGN_DC)
    if (!header || packet.payload.length !== CZONE_PAYLOAD_SIZE) {
      stats.invalidCzone++
      return
    }
    stats.dcPackets++
    for (let slot = 0; slot < RECORD_COUNT; slot++) {
      const i = 4 + slot * RECORD_SIZE
      const currentRaw = packet.payload[i]
      const levelRaw = packet.payload[i + 1] | (packet.payload[i + 2] << 8)
      const current = Number((currentRaw * DC_CURRENT_SCALE).toFixed(3))
      const level = decodeDcLevel(levelRaw)
      const entry = lookupMapping(require('./lib/zcf'), mapping, header.module, header.page, slot, CURRENT_PGN_DC)
      if (!entry) {
        stats.unmapped++
        stats.unmappedDc++
        if (config.logUnmapped) {
          log(`[CZONE DC] unmapped module=${hex2(header.module)} page=${header.page} slot=${slot} currentRaw=${currentRaw} levelRaw=${levelRaw}`)
        }
        continue
      }
      const pathName = publishCurrent(app, entry, header.module, slot, current, CURRENT_PGN_DC, packet.source)
      stats.valuesPublished++
      const record = {
        pgn: CURRENT_PGN_DC,
        module: header.module,
        page: header.page,
        slot,
        current,
        currentRaw,
        levelRaw,
        levelState: level.state,
        levelPercent: level.percent,
        path: pathName,
        source: packet.source,
        timestamp: new Date().toISOString()
      }
      stats.lastPacket = record
      stats.lastDcPacket = record
      stats.lastPublished = record
      circuitStatus.set(pathName, record)
    }
  }

  function decodeAc (packet) {
    const header = decodeCzoneHeader(packet.payload, CURRENT_PGN_AC)
    if (!header || packet.payload.length !== CZONE_PAYLOAD_SIZE) {
      stats.invalidCzone++
      return
    }
    stats.acPackets++
    for (let slot = 0; slot < RECORD_COUNT; slot++) {
      const i = 4 + slot * RECORD_SIZE
      const rawCurrent = packet.payload[i]
      const current = Number((rawCurrent * AC_CURRENT_SCALE).toFixed(3))
      const entry = lookupMapping(require('./lib/zcf'), mapping, header.module, header.page, slot, CURRENT_PGN_AC)
      if (!entry) {
        stats.unmapped++
        stats.unmappedAc++
        if (config.logUnmapped) log(`[CZONE AC] unmapped module=${hex2(header.module)} page=${header.page} slot=${slot} raw=${rawCurrent}`)
        continue
      }
      const pathName = publishCurrent(app, entry, header.module, slot, current, CURRENT_PGN_AC, packet.source)
      stats.valuesPublished++
      const record = { pgn: CURRENT_PGN_AC, module: header.module, page: header.page, slot, current, path: pathName, source: packet.source, timestamp: new Date().toISOString() }
      stats.lastPacket = record
      stats.lastAcPacket = record
      stats.lastPublished = record
      circuitStatus.set(pathName, record)
    }
  }

  function handlePacket (packet) {
    stats.packetsDecoded++
    stats.lastRawFrame = { pgn: packet.pgn, source: packet.source, packetId: packet.packetId, timestamp: packet.timestamp, receivedAt: new Date().toISOString(), payloadBytes: packet.payload.length }
    if (config.debugRaw) log(`[CZONE FP] PGN=${packet.pgn} src=${hex2(packet.source)} seq=${hex2(packet.packetId)} payload=${packet.payload.toString('hex').match(/../g).join(' ')}`)
    if (packet.payload.length < CZONE_PAYLOAD_SIZE) {
      stats.invalidCzone++
      return
    }
    const header = decodeCzoneHeader(packet.payload, packet.pgn)
    if (!header) {
      stats.invalidCzone++
      return
    }
    if (packet.pgn === CURRENT_PGN_DC) {
      decodeDc(packet)
      decodeDcLevelAndPublish(packet)
    } else if (packet.pgn === CURRENT_PGN_AC) decodeAc(packet)
  }

  function pluginDataDir () {
    if (typeof app.getDataDirPath === 'function') return app.getDataDirPath()
    return path.join(process.env.SIGNALK_NODE_CONFIG_DIR || path.join(os.homedir(), '.signalk'), 'plugin-data', 'signalk-czone')
  }

  function load () {
    if (!config.zcfPath) {
      throw new Error('No CZone ZCF file configured. Upload a ZCF or set zcfPath in the plugin configuration.')
    }
    if (!fs.existsSync(config.zcfPath)) {
      throw new Error(`CZone ZCF file not found: ${config.zcfPath}`)
    }
    mapping = loadMapping(config.zcfPath)
    if (!mapping) throw new Error('ZCF parser returned no mapping')
    initialiseCircuitState()
    if (!Array.isArray(mapping.currentMappings)) {
      throw new Error('ZCF parser returned no currentMappings array')
    }
    return mapping.currentMappings.length
  }

  function installZcfBytes (bytes, filename) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Uploaded ZCF data is empty')
    if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`ZCF exceeds ${MAX_UPLOAD_BYTES} bytes`)

    const zcfDir = path.join(pluginDataDir(), 'zcf')
    fs.mkdirSync(zcfDir, { recursive: true })
    const target = path.join(zcfDir, safeFilename(filename))
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(temp, bytes)
    try {
      const validated = loadMapping(temp)
      if (!validated) throw new Error('ZCF parser returned no mapping')
      fs.renameSync(temp, target)
      return target
    } catch (error) {
      try { fs.unlinkSync(temp) } catch (_) {}
      throw new Error(`Uploaded ZCF could not be parsed: ${error.message}`)
    }
  }

  function persistPluginOptions (newConfig) {
    if (typeof app.savePluginOptions !== 'function') return Promise.resolve()
    return new Promise((resolve, reject) => {
      app.savePluginOptions(newConfig, error => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async function saveAndRestart (newConfig) {
    // Persist the new path first. This makes the uploaded ZCF the actual
    // configuration used by the next plugin start, rather than relying on
    // the restart callback to persist it as a side effect.
    await persistPluginOptions(newConfig)
    if (typeof restartPlugin === 'function') {
      restartPlugin(newConfig)
    }
  }

  const plugin = {
    id: 'signalk-czone',
    name: 'CZone',
    description: 'Standalone CZone NMEA2000 current decoder',

    schema: () => ({
      type: 'object',
      properties: {
        zcfPath: {
          type: 'string',
          title: 'Installed CZone ZCF file',
          description: 'Path to the active CZone configuration file. Normally populated automatically after upload.',
          default: ''
        },
        allowCzoneWrite: {
          type: 'boolean',
          title: 'Enable CZone read/write control',
          description: 'Allows this plugin to send commands to CZone devices. This can change circuit states, modes, and configuration. Enable only if you understand the risks.',
          default: false
        },
        logUnmapped: {
          type: 'boolean',
          title: 'Log unmapped circuits',
          default: false
        },
        debugRaw: {
          type: 'boolean',
          title: 'Log completed raw CZone packets',
          default: false
        }
      }
    }),

    registerWithRouter: router => {
      router.get('/diagnostics', (req, res) => {
        try {
          res.status(200).json(plugin.status())
        } catch (error) {
          stats.lastError = error.message
          res.status(500).json({ ok: false, error: error.message })
        }
      })

      router.get('/configuration/network/status', (_req, res) => {
        const read = lastNetworkConfig
          ? { ...lastNetworkConfig, blocks: undefined, buffer: undefined }
          : null
        res.json({
          writeEnabled: config.allowCzoneWrite === true,
          read
        })
      })

      router.post('/configuration/network/read', (_req, res) => {
        try {
          const state = readConfigurationFromNetwork()
          res.status(202).json({
            ok: true,
            status: 'reading',
            startedAt: state.startedAt,
            message: 'CZone configuration read started. The plugin will ACK received configuration blocks.'
          })
        } catch (error) {
          stats.lastError = error.message
          res.status(400).json({ ok: false, error: error.message })
        }
      })

      router.post('/zcf/upload', async (req, res) => {
        try {
          const body = await readRequestBody(req)
          const file = parseMultipartSingleFile(body, req.headers['content-type'])
          if (!/\.zcf$/i.test(file.filename || '')) throw new Error('Please upload a .zcf file')
          const target = installZcfBytes(file.data, file.filename)
          const newConfig = {
            zcfPath: target,
            logUnmapped: config.logUnmapped === true,
            debugRaw: config.debugRaw === true,
            allowCzoneWrite: config.allowCzoneWrite === true
          }
          await saveAndRestart(newConfig)
          res.status(200).json({
            ok: true,
            zcfPath: target,
            filename: path.basename(target),
            bytes: file.data.length,
            configuration: newConfig
          })
        } catch (error) {
          stats.lastError = error.message
          res.status(400).json({ ok: false, error: error.message })
        }
      })
    },

    start: function (options, restart) {
      if (running) return
      restartPlugin = restart
      config = getConfig(options)
      try {
        const count = load()
        startedAt = Date.now()
        circuitStatus.clear()
        stats.lastError = null
        reassembler = createFastPacketReassembler(handlePacket)
        rawListener = line => {
          stats.rawFrames++
          stats.lastRawFrame = { receivedAt: new Date().toISOString(), type: 'canboatjs:rawoutput' }
          const frame = parseRawLine(line)
          if (!frame) {
            stats.parseErrors++
            return
          }
          if (frame.pgn === STATUS_PGN) {
            decodeCircuitStatus(frame)
            return
          }
          if (configTransfer && frame.pgn === CZONE_DATABLOCK_PGN) {
            handleConfigFastPacket(frame)
            return
          }
          if (frame.pgn !== CURRENT_PGN_DC && frame.pgn !== CURRENT_PGN_AC) return
          reassembler.accept(frame)
        }
        app.on('canboatjs:rawoutput', rawListener)
        running = true
        setStatus(`Loaded ${mapping.circuits.length} CZone circuits, ${count} with current mappings; raw PGNs 130817/130822`)
      } catch (error) {
        stats.decodeErrors++
        stats.lastError = error.message
        setStatus(`CZone error: ${error.message}`)
        throw error
      }
    },

    stop: function () {
      if (rawListener) app.removeListener('canboatjs:rawoutput', rawListener)
      rawListener = null
      if (reassembler) reassembler.clear()
      reassembler = null
      clearConfigTransfer()
      configFastPacket = null
      running = false
      startedAt = null
      circuitStatus.clear()
      runtimeState.clear()
      publishedCircuitValues.clear()
      setStatus('CZone stopped')
    },

    status: function () {
      const now = Date.now()
      const currentMappings = mapping && Array.isArray(mapping.currentMappings) ? mapping.currentMappings : []
      const byPgn = currentMappings.reduce((acc, entry) => {
        const key = String(entry.pgn)
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
      return {
        running,
        uptimeSeconds: startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)),
        zcf: {
          filePath: config.zcfPath || null,
          fileName: config.zcfPath ? path.basename(config.zcfPath) : null,
          fileSize: mapping && mapping.fileSize != null ? mapping.fileSize : null,
          circuits: mapping && Array.isArray(mapping.circuits) ? mapping.circuits.length : 0,
          currentMappings: currentMappings.length,
          mappingsByPgn: byPgn,
          warnings: mapping && Array.isArray(mapping.warnings) ? mapping.warnings : []
        },
        counters: { ...stats },
        diagnostics: {
          reassemblyInProgress: reassembler ? reassembler.size() : 0,
          config: { logUnmapped: config.logUnmapped === true, debugRaw: config.debugRaw === true, allowCzoneWrite: config.allowCzoneWrite === true },
          lastDcPacket: stats.lastDcPacket,
          lastAcPacket: stats.lastAcPacket,
          lastPublished: stats.lastPublished,
          lastRawPacket: stats.lastRawFrame,
          trackedCircuits: circuitStatus.size
        },
        circuits: Array.from(circuitStatus.values()).sort((a, b) => a.path.localeCompare(b.path))
      }
    }
  }

  return plugin
}
