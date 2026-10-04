'use strict'

const assert = require('assert')
const nmea = require('../lib/nmea2000')

const hex = s => Buffer.from(s.replace(/\s+/g, ''), 'hex')
const HEAD = (module, page) => `27 99 0${module} 0${page} `
const M2_P0_OFF = hex(HEAD(2, 0) + '00 00 40 1F 00 D0 17 00 00 00 00 00 00 00 40 00 D0 07 00 00 00 00 00')
const M2_P0_ON = hex(HEAD(2, 0) + '00 00 40 1F 00 D0 17 00 00 00 00 00 05 40 5F 00 D0 07 00 00 00 00 00')
const M2_P1 = hex(HEAD(2, 1) + '00 00 00 00 00 D0 07 00 F4 11 00 7D 00 00 00 00 D0 07 00 00 00 00 00')
const M1_P0 = hex(HEAD(1, 0) + '00 00 00 00 00 00 F0 01 F4 01 00 7D 00 00 00 00 00 00 00 00 00 00 00')

assert(nmea.CZONE_CURRENT_PGNS.has(130825))

{
  const off = nmea.decodeControlXPlusCurrentPacket(M2_P0_OFF)
  const on = nmea.decodeControlXPlusCurrentPacket(M2_P0_ON)

  assert.deepStrictEqual({ module: off.module, page: off.page }, { module: 2, page: 0 })
  assert.strictEqual(off.slots[4].level, 0)
  assert.strictEqual(off.slots[4].current, 0)
  assert.strictEqual(off.slots[4].off, true)

  assert.strictEqual(on.slots[4].level, 1000)
  assert.strictEqual(on.slots[4].current, 0.5)
  assert.strictEqual(on.slots[4].off, false)
  assert.deepStrictEqual(on.slots.filter(s => !s.off).map(s => s.channel), [0, 1, 4, 5])
}

{
  const packet = nmea.decodeControlXPlusCurrentPacket(M2_P1)
  assert.deepStrictEqual(packet.slots.filter(s => !s.off).map(s => s.channel), [9, 10, 11, 13])
  assert.strictEqual(packet.slots[3].current, 0.4)
}

{
  const packet = nmea.decodeControlXPlusCurrentPacket(M1_P0)
  assert.deepStrictEqual(packet.slots.filter(s => !s.off).map(s => s.channel), [2, 3])
  assert.strictEqual(packet.slots[2].current, 3.1)
}

assert.strictEqual(
  nmea.decodeControlXPlusCurrentPacket(
    hex('13 99 02 00 00 00 40 1F 00 D0 17 00 00 00 00 00 05 40 5F 00 D0 07 00 00 00 00 00')
  ),
  null
)

{
  const packets = []
  const reassembler = nmea.createFastPacketReassembler(packet => packets.push(packet))
  const frame = data => reassembler.accept({
    pgn: 130825,
    source: 2,
    canId: 0x1DFF0902,
    data: hex(data)
  })

  for (const data of [
    'A0 1B 27 99 02 00 00 00',
    'A1 40 1F 00 D0 17 00 00',
    'A2 00 00 00 05 40 5F 00',
    'A3 D0 07 00 00 00 00 00'
  ]) frame(data)

  assert.strictEqual(packets.length, 1)
  assert.strictEqual(packets[0].pgn, 130825)
  assert.deepStrictEqual(nmea.decodeControlXPlusCurrentPacket(packets[0].payload).slots[4], {
    channel: 4,
    rawCurrent: 5,
    current: 0.5,
    level: 1000,
    off: false
  })

  const before = packets.length
  frame('E0 1B 27 99 02 00 00 00')
  frame('E2 00 00 00 05 40 5F 00')
  frame('E3 D0 07 00 00 00 00 00')
  assert.strictEqual(packets.length, before)
}

console.log('Control X PLUS 130825 tests passed')
