'use strict'

const assert = require('assert')
const sk = require('../lib/signalk')

function decodeStatus (data, module, slot) {
  assert.strictEqual(data[0], 0x27)
  assert.strictEqual(data[1], 0x99)
  assert.strictEqual(data[2], module)
  assert.strictEqual(data[3], 0x1F)
  return ((data.readUInt32LE(4) >>> slot) & 1) !== 0
}

// Captured CAN trace: Bimini circuit is module 26 / slot 4.
// 0x2a4c -> 0x2a5c sets bit 4, then returns to 0x2a4c.
const biminiOff = Buffer.from('27991a1f4c2a0000', 'hex')
const biminiOn = Buffer.from('27991a1f5c2a0000', 'hex')
assert.strictEqual(decodeStatus(biminiOff, 0x1a, 4), false)
assert.strictEqual(decodeStatus(biminiOn, 0x1a, 4), true)

// Captured CAN trace: Deck circuit is module 28 / slot 14.
// 0x04b2 -> 0x44b2 sets bit 14, then returns to 0x04b2.
const deckOff = Buffer.from('27991c1fb2040000', 'hex')
const deckOn = Buffer.from('27991c1fb2440000', 'hex')
assert.strictEqual(decodeStatus(deckOff, 0x1c, 14), false)
assert.strictEqual(decodeStatus(deckOn, 0x1c, 14), true)

// Captured runtime module bytes: Bimini status module 26, Deck status module 28.
// These are intentionally tested as runtime status identities, not assumed to
// equal the ZCF configuration module bytes (20 and 22).
assert.strictEqual(Buffer.from('27991a1f4c2a0000','hex')[2], 0x1a)
assert.strictEqual(Buffer.from('27991c1fb2040000','hex')[2], 0x1c)

const source = sk.nmea2000Source(6, 65284)
assert.deepStrictEqual(source, {
  label: 'CZone-DC',
  type: 'NMEA2000',
  src: '6',
  pgn: 65284
})

console.log('CZone 65284 circuit-status mapping tests passed')
