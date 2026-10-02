'use strict'

const assert = require('assert')
const czone = require('../lib/czone')
const nmea = require('../lib/nmea2000')

assert.strictEqual(czone.hex(czone.on(0x35, 0x01, 0x08)), '27 99 35 00 00 01 f1 08')
assert.strictEqual(czone.hex(czone.off(0x35, 0x01, 0x08)), '27 99 35 00 00 01 f2 08')
assert.deepStrictEqual(czone.dimmerOn(0x1b, 0x24, 0x08).map(x => czone.hex(x)), [
  '27 99 1b 00 00 24 f5 08',
  '27 99 1b 00 00 24 95 08',
  '27 99 1b 00 00 24 43 08'
])
assert.strictEqual(czone.hex(czone.level(0x1b, 50, 0x08, 0x08)), '27 99 1b 00 32 08 fc 08')
assert.strictEqual(czone.hex(czone.modeActivate(0x4d, 0x24, 0x08)), '27 99 4d 00 00 24 f1 08')
assert.strictEqual(czone.hex(czone.configReadRequest()), '27 99 00 00 00 00 c0 ff')
assert.strictEqual(czone.hex(czone.configDataBlockAck(0xf8, 3, 0)), '27 99 f8 00 03 00 ff 03')
assert.strictEqual(nmea.CZONE_CONFIG_CLAIM_PGN, 65290)
assert.strictEqual(nmea.CZONE_DATABLOCK_ACK_PGN, 65291)
assert.strictEqual(nmea.CZONE_DATABLOCK_PGN, 130816)
console.log('CZone control protocol tests passed')
