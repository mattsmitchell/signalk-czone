'use strict'

function hexByte (value) {
  return Number(value).toString(16).padStart(2, '0')
}

// CZone circuit commands are transmitted on raw NMEA 2000 PGN 65280
// (0xFF00). Some CZone/Canboat tooling labels the proprietary DP-space
// equivalent as 130816, so accept that alias on input, but outbound Actisense
// frames must use the actual on-wire PGN observed in captures: 65280.
const CZONE_PGN = 65280
const CZONE_PGN_ALIAS = 130816
const CURRENT_PGN_DC = 130822
const CURRENT_PGN_AC = 130817
const CURRENT_PGN_CONTROL_X_PLUS = 130825
const CIRCUIT_STATUS_PGN = 65284
const CZONE_CONFIG_CLAIM_PGN = 65290
const CZONE_DATABLOCK_ACK_PGN = 65291
const CZONE_DATABLOCK_PGN = 130816
const CZONE_CURRENT_PGNS = new Set([CURRENT_PGN_DC, CURRENT_PGN_AC, CURRENT_PGN_CONTROL_X_PLUS])
const CZONE_PGNS = new Set([CZONE_PGN, CZONE_PGN_ALIAS, CURRENT_PGN_DC, CURRENT_PGN_AC, CIRCUIT_STATUS_PGN, CZONE_CONFIG_CLAIM_PGN, CZONE_DATABLOCK_ACK_PGN, CZONE_DATABLOCK_PGN])
const CZONE_SIGNATURE = [0x27, 0x99]
const MAX_FAST_PACKET_SIZE = 223

function actisenseLine ({ timestamp = new Date(), priority = 7, pgn, src, dst = 255, data }) {
  if (!Number.isInteger(pgn)) throw new Error('PGN is required')
  if (!Number.isInteger(src)) throw new Error('NMEA 2000 source placeholder is required')
  const bytes = Buffer.from(data || [])
  return [
    new Date(timestamp).toISOString(),
    priority,
    pgn,
    src,
    dst,
    bytes.length,
    ...Array.from(bytes, hexByte)
  ].join(',')
}

function parseInteger (value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value, 10)
  return null
}

function parseCanId (value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0x1fffffff) return value >>> 0
  if (typeof value === 'string' && /^(?:0x)?[0-9a-fA-F]+$/.test(value.trim())) return Number.parseInt(value, 16) >>> 0
  return null
}

function parseDataBytes (values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) return null
  const bytes = values.map(value => {
    if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 255 ? value : NaN
    if (typeof value === 'string' && /^[0-9a-fA-F]{1,2}$/.test(value.trim())) return Number.parseInt(value, 16)
    return NaN
  })
  return bytes.some(v => !Number.isInteger(v)) ? null : bytes
}

function getPgnFromCanId (canId) {
  const pf = (canId >>> 16) & 0xff
  const base = pf >= 240 ? ((canId >>> 8) & 0xffff) : (pf << 8)
  // CZone uses two encodings in the captured NMEA-2000 stream. The
  // proprietary CZone traffic (130816+) uses the DP bit, while the
  // circuit-status frame at CAN PGN 0xFF04 is exposed by Signal K as
  // PGN 65284. Preserve that distinction so the 27 99 1F status frames
  // reach the 65284 decoder instead of being misidentified as 130820.
  if (pf === 0xFF && ((canId >>> 8) & 0xFF) === 0x04) {
    return 65284
  }
  return pf === 0xFF ? base + 0x10000 : base
}

function parseJsonFrame (frame) {
  if (!frame || typeof frame !== 'object') return null
  const pgnInfo = frame.pgn && typeof frame.pgn === 'object' ? frame.pgn : frame
  const canId = parseCanId(pgnInfo.canId != null ? pgnInfo.canId : frame.canId)
  const pgn = parseInteger(pgnInfo.pgn != null ? pgnInfo.pgn : frame.pgn)
  const source = parseInteger(pgnInfo.src != null ? pgnInfo.src : (frame.source != null ? frame.source : (canId != null ? canId & 0xff : null)))
  const data = parseDataBytes(frame.data)
  if (canId == null || pgn == null || source == null || !data) return null
  return { timestamp: frame.timestamp || null, direction: frame.direction || null, canId, source, pgn, data: Buffer.from(data) }
}

function parseRawLine (input) {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return null
    if (trimmed[0] === '{') {
      try { return parseJsonFrame(JSON.parse(trimmed)) } catch (_) { return null }
    }
    const parts = trimmed.split(/\s+/)
    if (parts.length < 4) return null
    const direction = parts[1]
    const canIdText = parts[2]
    if (direction && direction !== 'R') return null
    if (!/^[0-9a-fA-F]{8}$/.test(canIdText || '')) return null
    const data = parseDataBytes(parts.slice(3))
    if (!data) return null
    const canId = Number.parseInt(canIdText, 16) >>> 0
    return { timestamp: parts[0], direction, canId, source: canId & 0xff, pgn: getPgnFromCanId(canId), data: Buffer.from(data) }
  }
  if (input && typeof input === 'object') return parseJsonFrame(input)
  return null
}

function isCzonePgn (pgn) { return CZONE_PGNS.has(pgn) }
function isCzoneCurrentPgn (pgn) { return CZONE_CURRENT_PGNS.has(pgn) }
function isCzoneCommandFrame (frame) {
  return Boolean(frame && (frame.pgn === CZONE_PGN || frame.pgn === CZONE_PGN_ALIAS) && frame.data && frame.data.length === 8 && frame.data[0] === 0x27 && frame.data[1] === 0x99)
}

function createFastPacketReassembler (onPacket, options = {}) {
  const packets = new Map()
  const timeoutMs = options.timeoutMs || 2000

  function expire () {
    const now = Date.now()
    for (const [key, packet] of packets) if (now - packet.updatedAt > timeoutMs) packets.delete(key)
  }

  function accept (frame) {
    if (!frame || !isCzoneCurrentPgn(frame.pgn) || !frame.data || frame.data.length < 2) return
    expire()
    const control = frame.data[0]
    const packetId = control >>> 4
    const frameNo = control & 0x0f
    const key = `${frame.pgn}:${frame.source}:${packetId}`
    if (frameNo === 0) {
      const size = frame.data[1]
      if (size < 2 || size > MAX_FAST_PACKET_SIZE) return
      const packet = { pgn: frame.pgn, source: frame.source, canId: frame.canId, packetId, size, nextFrame: 1, payload: Buffer.from(frame.data.subarray(2)), timestamp: frame.timestamp, updatedAt: Date.now() }
      packets.set(key, packet)
      finish(packet, key)
      return
    }
    const packet = packets.get(key)
    if (!packet || frameNo !== packet.nextFrame) { packets.delete(key); return }
    packet.payload = Buffer.concat([packet.payload, frame.data.subarray(1)])
    packet.nextFrame = (packet.nextFrame + 1) & 0x0f
    packet.updatedAt = Date.now()
    finish(packet, key)
  }

  function finish (packet, key) {
    if (packet.payload.length < packet.size) return
    const payload = packet.payload.subarray(0, packet.size)
    packets.delete(key)
    if (typeof onPacket === 'function') onPacket({ pgn: packet.pgn, source: packet.source, canId: packet.canId, packetId: packet.packetId, timestamp: packet.timestamp, payload })
  }

  return { accept, clear: () => packets.clear(), size: () => packets.size }
}

function decodeCzoneHeader (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 4) return null
  if (payload[0] !== CZONE_SIGNATURE[0] || payload[1] !== CZONE_SIGNATURE[1]) return null
  if (pgn === CURRENT_PGN_AC) return { page: payload[2], module: payload[3] }
  if (pgn === CURRENT_PGN_DC || pgn === CURRENT_PGN_CONTROL_X_PLUS) return { module: payload[2], page: payload[3] }
  return null
}

function decodeControlXPlusCurrentPacket (payload) {
  if (!Buffer.isBuffer(payload) || payload.length !== 27) return null
  if (payload[0] !== CZONE_SIGNATURE[0] || payload[1] !== CZONE_SIGNATURE[1]) return null
  const header = decodeCzoneHeader(payload, CURRENT_PGN_CONTROL_X_PLUS)
  if (!header) return null
  const slots = []
  const readBits = (start, width) => {
    let value = 0
    for (let bit = 0; bit < width; bit++) {
      const absolute = start + bit
      if ((payload[absolute >> 3] & (1 << (absolute & 7))) !== 0) value |= 1 << bit
    }
    return value
  }
  for (let slot = 0; slot < 8; slot++) {
    const start = 40 + slot * 22
    const rawCurrent = readBits(start, 11)
    const level = readBits(start + 11, 11)
    slots.push({
      channel: header.page * 8 + slot,
      rawCurrent,
      current: level === 0 ? 0 : rawCurrent / 10,
      level,
      off: level === 0
    })
  }
  return { module: header.module, page: header.page, slots }
}

function czoneLine ({ src, data, timestamp, priority = 7, dst = 255 }) {
  return actisenseLine({ timestamp, priority, pgn: CZONE_PGN, src, dst, data })
}

function pgnLine ({ pgn, src, data, timestamp, priority = 7, dst = 255 }) {
  return actisenseLine({ timestamp, priority, pgn, src, dst, data })
}

function emitPgn (app, options) {
  const line = pgnLine(options)
  if (typeof app.emit !== 'function') throw new Error('Signal K app.emit() is unavailable')
  app.emit('nmea2000out', line)
  return line
}

function emitCzone (app, options) {
  const line = czoneLine(options)
  if (typeof app.emit !== 'function') throw new Error('Signal K app.emit() is unavailable')
  app.emit('nmea2000out', line)
  return line
}

module.exports = { CZONE_PGN, CZONE_PGN_ALIAS, CZONE_PGNS, CZONE_CURRENT_PGNS, CURRENT_PGN_DC, CURRENT_PGN_AC, CIRCUIT_STATUS_PGN, CZONE_CONFIG_CLAIM_PGN, CZONE_DATABLOCK_ACK_PGN, CZONE_DATABLOCK_PGN, actisenseLine, czoneLine, pgnLine, emitPgn, emitCzone, parseRawLine, getPgnFromCanId, isCzonePgn, isCzoneCurrentPgn, decodeControlXPlusCurrentPacket, isCzoneCommandFrame, createFastPacketReassembler, decodeCzoneHeader }
