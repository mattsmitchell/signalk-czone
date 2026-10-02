'use strict'

// Small, transport-independent NMEA 2000 helper layer.
// The plugin accepts either the traditional YDWG02 text line emitted by
// canboatjs or the JSON/object representation used by some Signal K/NMEA2000
// providers (including Victron Cerbo GX environments).

const CZONE_PGNS = new Set([130817, 130822])
const CZONE_SIGNATURE = [0x27, 0x99]
const MAX_FAST_PACKET_SIZE = 223

function parseRawLine (input) {
  // Format 1: traditional YDWG02 text line
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return null

    // Format 2: JSON string representation of the parsed NMEA2000 frame.
    if (trimmed[0] === '{') {
      try {
        return parseJsonFrame(JSON.parse(trimmed))
      } catch (error) {
        return null
      }
    }

    const parts = trimmed.split(/\s+/)
    if (parts.length < 4) return null

    const direction = parts[1]
    const canIdText = parts[2]
    if (!canIdText || !/^[0-9a-fA-F]{8}$/.test(canIdText)) return null
    if (direction && direction !== 'R') return null

    const data = parseDataBytes(parts.slice(3))
    if (!data) return null

    const canId = Number.parseInt(canIdText, 16) >>> 0
    const pgn = getPgnFromCanId(canId)

    return {
      timestamp: parts[0],
      direction,
      canId,
      source: canId & 0xff,
      pgn,
      data: Buffer.from(data)
    }
  }

  // Format 3: already-parsed JSON/object representation.
  if (input && typeof input === 'object') {
    return parseJsonFrame(input)
  }

  return null
}

function parseJsonFrame (frame) {
  if (!frame || typeof frame !== 'object') return null

  const pgnInfo = frame.pgn && typeof frame.pgn === 'object' ? frame.pgn : frame
  const canId = parseCanId(pgnInfo.canId != null ? pgnInfo.canId : frame.canId)
  const pgn = parseInteger(pgnInfo.pgn != null ? pgnInfo.pgn : frame.pgn)
  const source = parseInteger(pgnInfo.src != null ? pgnInfo.src : (frame.source != null ? frame.source : (canId != null ? canId & 0xff : null)))
  const data = parseDataBytes(frame.data)

  if (canId == null || pgn == null || source == null || !data) return null
  if (data.length < 1 || data.length > 8) return null
  if (frame.length != null && parseInteger(frame.length) !== data.length) return null

  return {
    timestamp: frame.timestamp || null,
    direction: frame.direction || null,
    canId,
    source,
    pgn,
    data: Buffer.from(data)
  }
}

function parseCanId (value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0x1fffffff) {
    return value >>> 0
  }
  if (typeof value === 'string' && /^(?:0x)?[0-9a-fA-F]+$/.test(value.trim())) {
    const parsed = Number.parseInt(value, 16)
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x1fffffff) return parsed >>> 0
  }
  return null
}

function parseInteger (value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value, 10)
  return null
}

function parseDataBytes (values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) return null

  const bytes = values.map(value => {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 && value <= 255 ? value : NaN
    }
    if (typeof value === 'string' && /^[0-9a-fA-F]{1,2}$/.test(value.trim())) {
      return Number.parseInt(value, 16)
    }
    return NaN
  })

  if (bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null
  return bytes
}

function getPgnFromCanId (canId) {
  const pf = (canId >>> 16) & 0xff
  const ps = (canId >>> 8) & 0xff

  // These CZone PGNs are PDU2 (PF >= 240), so PS is part of the PGN.
  if (pf >= 240) {
    return (canId >>> 8) & 0x3ffff
  }

  // General PDU1 form, included so the helper remains reusable.
  return pf << 8
}

function isCzonePgn (pgn) {
  return CZONE_PGNS.has(pgn)
}

function createFastPacketReassembler (onPacket, options = {}) {
  const packets = new Map()
  const timeoutMs = options.timeoutMs || 2000

  function expire () {
    const now = Date.now()
    for (const [key, packet] of packets) {
      if (now - packet.updatedAt > timeoutMs) packets.delete(key)
    }
  }

  function accept (frame) {
    if (!frame || !isCzonePgn(frame.pgn) || !frame.data || frame.data.length < 2) return

    const control = frame.data[0]
    const packetId = control >>> 4
    const frameNo = control & 0x0f
    const baseKey = `${frame.pgn}:${frame.source}:${packetId}`

    expire()

    if (frameNo === 0) {
      const size = frame.data[1]
      if (size < 2 || size > MAX_FAST_PACKET_SIZE) return

      const payload = Buffer.from(frame.data.subarray(2))
      const packet = {
        pgn: frame.pgn,
        source: frame.source,
        canId: frame.canId,
        packetId,
        size,
        nextFrame: 1,
        payload,
        timestamp: frame.timestamp,
        updatedAt: Date.now()
      }

      packets.set(baseKey, packet)
      finishIfComplete(packet, baseKey)
      return
    }

    const packet = packets.get(baseKey)
    if (!packet) return

    // A restarted/interleaved packet must not silently corrupt the payload.
    if (frameNo !== packet.nextFrame) {
      packets.delete(baseKey)
      return
    }

    packet.payload = Buffer.concat([packet.payload, frame.data.subarray(1)])
    packet.nextFrame = (packet.nextFrame + 1) & 0x0f
    packet.updatedAt = Date.now()
    finishIfComplete(packet, baseKey)
  }

  function finishIfComplete (packet, key) {
    if (packet.payload.length < packet.size) return

    const payload = packet.payload.subarray(0, packet.size)
    packets.delete(key)

    if (typeof onPacket === 'function') {
      onPacket({
        pgn: packet.pgn,
        source: packet.source,
        canId: packet.canId,
        packetId: packet.packetId,
        timestamp: packet.timestamp,
        payload
      })
    }
  }

  return {
    accept,
    clear: () => packets.clear(),
    size: () => packets.size
  }
}

function decodeCzoneHeader (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 4) return null
  if (payload[0] !== CZONE_SIGNATURE[0] || payload[1] !== CZONE_SIGNATURE[1]) return null

  // The observed CZone wire layouts differ between these two PGNs:
  // 130817: 27 99 [page] [module]
  // 130822: 27 99 [module] [page]
  if (pgn === 130817) {
    return { page: payload[2], module: payload[3] }
  }
  if (pgn === 130822) {
    return { module: payload[2], page: payload[3] }
  }
  return null
}

module.exports = {
  CZONE_PGNS,
  parseRawLine,
  getPgnFromCanId,
  isCzonePgn,
  createFastPacketReassembler,
  decodeCzoneHeader
}


module.exports.CZONE_PGN = 65280
module.exports.CZONE_PGN_ALIAS = 130816
module.exports.CIRCUIT_STATUS_PGN = 65284
module.exports.CZONE_CONFIG_CLAIM_PGN = 65290
module.exports.CZONE_DATABLOCK_ACK_PGN = 65291
module.exports.CZONE_DATABLOCK_PGN = 130816
module.exports.CZONE_CURRENT_PGNS = new Set([130817, 130822])
module.exports.CZONE_PGNS = new Set([65280, 130816, 130817, 130822, 65284, 65290, 65291])
module.exports.isCzoneCurrentPgn = pgn => module.exports.CZONE_CURRENT_PGNS.has(pgn)
module.exports.isCzoneCommandFrame = frame => Boolean(frame && (frame.pgn === 65280 || frame.pgn === 130816) && frame.data && frame.data.length === 8 && frame.data[0] === 0x27 && frame.data[1] === 0x99)
module.exports.actisenseLine = ({ timestamp = new Date(), priority = 7, pgn, src, dst = 255, data }) => {
  if (!Number.isInteger(pgn)) throw new Error('PGN is required')
  if (!Number.isInteger(src)) throw new Error('NMEA 2000 source placeholder is required')
  const bytes = Buffer.from(data || [])
  return [new Date(timestamp).toISOString(), priority, pgn, src, dst, bytes.length, ...Array.from(bytes, value => Number(value).toString(16).padStart(2, '0'))].join(',')
}
module.exports.czoneLine = ({ src, data, timestamp, priority = 7, dst = 255 }) => module.exports.actisenseLine({ timestamp, priority, pgn: 65280, src, dst, data })
module.exports.pgnLine = ({ pgn, src, data, timestamp, priority = 7, dst = 255 }) => module.exports.actisenseLine({ timestamp, priority, pgn, src, dst, data })
module.exports.emitPgn = (app, options) => {
  const line = module.exports.pgnLine(options)
  if (typeof app.emit !== 'function') throw new Error('Signal K app.emit() is unavailable')
  app.emit('nmea2000out', line)
  return line
}
module.exports.emitCzone = (app, options) => {
  const line = module.exports.czoneLine(options)
  if (typeof app.emit !== 'function') throw new Error('Signal K app.emit() is unavailable')
  app.emit('nmea2000out', line)
  return line
}
