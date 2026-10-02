'use strict'

function byte (value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`Byte out of range: ${value}`)
  }
  return value
}

function levelByte (percent) {
  const value = Number(percent)
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('CZone level must be between 0 and 100 percent')
  }
  return Math.round(value)
}

function payload ({ circuitId, operation, value = 0, parameter = 0x08, trailer = 0x08 }) {
  return Buffer.from([
    0x27, 0x99, byte(circuitId), 0x00, byte(value), byte(parameter), byte(operation), byte(trailer)
  ])
}

function on (circuitId, parameter = 0x08, trailer = 0x08) {
  return payload({ circuitId, operation: 0xF1, parameter, trailer })
}

function off (circuitId, parameter = 0x08, trailer = 0x08) {
  return payload({ circuitId, operation: 0xF2, parameter, trailer })
}

function switchComplete (circuitId, parameter = 0x24, trailer = 0x08) {
  return payload({ circuitId, operation: 0x40, parameter, trailer })
}

function dimmerOn (circuitId, parameter = 0x24, trailer = 0x08) {
  return [
    payload({ circuitId, operation: 0xF5, parameter, trailer }),
    payload({ circuitId, operation: 0x95, parameter, trailer }),
    payload({ circuitId, operation: 0x43, parameter, trailer })
  ]
}

function dimmerOff (circuitId, parameter = 0x24, trailer = 0x08) {
  return [
    payload({ circuitId, operation: 0xF5, parameter, trailer }),
    payload({ circuitId, operation: 0x95, parameter, trailer }),
    payload({ circuitId, operation: 0x42, parameter, trailer })
  ]
}

function level (circuitId, percent, parameter = 0x08, trailer = 0x08) {
  return payload({ circuitId, value: levelByte(percent), operation: 0xFC, parameter, trailer })
}

function modeActivate (runtimeId, parameter = 0x24, trailer = 0x08) {
  return payload({ circuitId: runtimeId, value: 0x00, parameter, operation: 0xF1, trailer })
}

function configReadRequest () {
  return Buffer.from([0x27, 0x99, 0x00, 0x00, 0x00, 0x00, 0xC0, 0xFF])
}

function configDataBlockAck (target, blockIndex, status = 0) {
  if (!Number.isInteger(target) || target < 0 || target > 255) throw new Error('Invalid CZone config target')
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 0xffff) throw new Error('Invalid CZone config block index')
  if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error('Invalid CZone config ACK status')
  return Buffer.from([0x27, 0x99, target, status, blockIndex & 0xff, (blockIndex >>> 8) & 0xff, 0xff, 0x03])
}

function hex (buf) {
  return Buffer.from(buf).toString('hex').match(/../g)?.join(' ') || ''
}

const OPERATIONS = Object.freeze({
  on: 0xF1, off: 0xF2, level: 0xFC, modeActivate: 0xF1,
  switchComplete: 0x40, dimmerOn: 0x43, dimmerOff: 0x42,
  dimmerPrepare: 0xF5, dimmerStop: 0x95
})

module.exports = { payload, on, off, switchComplete, dimmerOn, dimmerOff, level, modeActivate, configReadRequest, configDataBlockAck, levelByte, hex, OPERATIONS }
