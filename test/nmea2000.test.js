'use strict'

const assert = require('assert')
const nmea2000 = require('../lib/nmea2000')

assert.strictEqual(nmea2000.getPgnFromCanId(0x18ff042a), 65284)
assert.strictEqual(nmea2000.getPgnFromCanId(0x18ff4617), 130822)

const frame = nmea2000.parseRawLine(
  '2026-10-02T08:00:00.000Z R 18ff042a 27 99 0a 00 01 00 00 00'
)

assert(frame)
assert.strictEqual(frame.pgn, 65284)
assert.strictEqual(frame.source, 42)
assert.deepStrictEqual([...frame.data], [0x27, 0x99, 0x0a, 0x00, 0x01, 0x00, 0x00, 0x00])

console.log('nmea2000 passive parser tests passed')
