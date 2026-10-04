'use strict'

function decodeDcLevel (raw) {
  if (raw === 0x0400) return { state: 'OFF', percent: 0 }
  if (raw >= 0x0401 && raw < 0x07E8) return { state: 'DIMMED', percent: (raw - 0x0400) / 10 }
  if (raw >= 0x07E8 && raw <= 0x0800) return { state: 'ON', percent: 100 }
  return { state: 'UNKNOWN', percent: null }
}

function decodeDcPacket (payload) {
  if (!Buffer.isBuffer(payload) || payload.length !== 28) return null
  if (payload[0] !== 0x27 || payload[1] !== 0x99) return null
  const module = payload[2]
  const page = payload[3]
  const values = []
  for (let slot = 0; slot < 8; slot++) {
    const i = 4 + slot * 3
    const levelRaw = payload[i + 1] | (payload[i + 2] << 8)
    const level = decodeDcLevel(levelRaw)
    values.push({
      slot,
      currentRaw: payload[i],
      levelRaw,
      state: level.state,
      percent: level.percent
    })
  }
  return { module, page, values }
}

function decodeCircuitStatus (data) {
  if (!Buffer.isBuffer(data) || data.length !== 8) return null
  if (data[0] !== 0x27 || data[1] !== 0x99) return null
  return {
    module: data[2],
    subtype: data[3],
    bitmap: data.readUInt32LE(4)
  }
}

function circuitEnabled (status, circuit) {
  if (!status || !circuit || Number(circuit.statusModule) !== status.module) return null
  if (Number.isInteger(circuit.statusMask) && circuit.statusMask > 0) {
    return (status.bitmap & (circuit.statusMask >>> 0)) !== 0
  }
  if (Number.isInteger(circuit.statusBit) && circuit.statusBit >= 0 && circuit.statusBit <= 31) {
    return ((status.bitmap >>> circuit.statusBit) & 1) !== 0
  }
  return null
}

module.exports = { decodeDcLevel, decodeDcPacket, decodeCircuitStatus, circuitEnabled }
