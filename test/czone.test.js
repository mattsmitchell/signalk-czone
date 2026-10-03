'use strict'

const assert = require('assert')
const czone = require('../lib/czone')

assert.deepStrictEqual(
  [...czone.configReadRequest()],
  [0x27, 0x99, 0x00, 0x00, 0x00, 0x00, 0xC0, 0xFF]
)

assert.deepStrictEqual(
  [...czone.configDataBlockAck(0x12, 0x1234, 0)],
  [0x27, 0x99, 0x12, 0x00, 0x34, 0x12, 0xFF, 0x03]
)

assert.deepStrictEqual(
  [...czone.configDataBlockAck(0x12, 0x1234, 1)],
  [0x27, 0x99, 0x12, 0x01, 0x34, 0x12, 0xFF, 0x03]
)

assert.throws(() => czone.configDataBlockAck(0x100, 0, 0), /Invalid CZone config target/)
assert.throws(() => czone.configDataBlockAck(0, -1, 0), /Invalid CZone config block index/)

console.log('CZone configuration command tests passed')
