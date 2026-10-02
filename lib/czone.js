'use strict'

function byte (value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`Byte out of range: ${value}`)
  return value
}

function payload ({ circuitId, operation, value = 0, parameter = 0x08, trailer = 0x08 }) {
  return Buffer.from([0x27, 0x99, byte(circuitId), 0x00, byte(value), byte(parameter), byte(operation), byte(trailer)])
}

// CZone configuration transfer control.
// A read request is a single-frame PGN 65290 command with broadcast module target FF.
function configReadRequest () {
  return Buffer.from([0x27, 0x99, 0x00, 0x00, 0x00, 0x00, 0xC0, 0xFF])
}

// PGN 65291 acknowledgement for a received ZCF DataBlock.
// target is the CZone configuration-transfer identity from DataBlock byte 4.
function configDataBlockAck (target, blockIndex, status = 0) {
  if (!Number.isInteger(target) || target < 0 || target > 0xff) throw new Error('Invalid CZone config target')
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 0xffff) throw new Error('Invalid CZone config block index')
  if (!Number.isInteger(status) || status < 0 || status > 0xff) throw new Error('Invalid CZone config ACK status')
  return Buffer.from([
    0x27, 0x99, target, status,
    blockIndex & 0xff, (blockIndex >>> 8) & 0xff,
    0xff, 0x03
  ])
}

function hex (buffer) {
  return Buffer.from(buffer).toString('hex').match(/../g)?.join(' ') || ''
}

module.exports = { configReadRequest, configDataBlockAck, hex }
