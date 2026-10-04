'use strict'

const assert = require('assert')
const nmea2000 = require('../lib/nmea2000')

assert.strictEqual(nmea2000.getPgnFromCanId(0x18ff042a), 65284)
assert.strictEqual(nmea2000.getPgnFromCanId(0x18ff0617), 130822)
assert.strictEqual(nmea2000.getPgnFromCanId(0x09fd0865), 130312)
assert.strictEqual(nmea2000.getPgnFromCanId(0x19f21409), 127508)
assert.strictEqual(nmea2000.getPgnFromCanId(0x19f30309), 127747)
assert.deepStrictEqual(
  nmea2000.decodeCzoneHeader(
    Buffer.from('2799000100000000000000000000000000000000000000000000', 'hex'),
    130817
  ),
  { page: 0x00, module: 0x01 }
)

const frame = nmea2000.parseRawLine(
  '2026-10-02T08:00:00.000Z R 18ff042a 27 99 0a 00 01 00 00 00'
)

assert(frame)
assert.strictEqual(frame.pgn, 65284)
assert.strictEqual(frame.source, 42)
assert.deepStrictEqual([...frame.data], [0x27, 0x99, 0x0a, 0x00, 0x01, 0x00, 0x00, 0x00])

console.log('nmea2000 passive parser tests passed')


const output = []
const app = { emit: (event, line) => output.push({ event, line }) }
const emitted = nmea2000.emitPgn(app, {
  pgn: 65290,
  src: 0,
  data: Buffer.from([0x27, 0x99, 0x00, 0x00, 0x00, 0x00, 0xC0, 0xFF])
})
assert.strictEqual(output[0].event, 'nmea2000out')
assert.strictEqual(emitted, output[0].line)
assert(emitted.includes(',65290,0,255,8,27,99,00,00,00,00,c0,ff'))
