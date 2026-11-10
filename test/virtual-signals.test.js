'use strict'

const assert = require('assert')
const nmea = require('../lib/nmea2000')
const virtual = require('../lib/virtual-signals')

function circuit (name, module, channel, show = true) {
  return {
    name, slug: name.replace(/\s+/g, '_'),
    showInCircuitList: show,
    virtual: { virtualOnly: true, outputs: [{ module, channel }] },
    outputs: [{ module, channel }]
  }
}
const marina = circuit('In Marina', 0x1c, 32)
const shower = circuit('Shower Time', 0x1c, 33)
const elsewhere = circuit('Other module', 0x28, 32)
const hidden = circuit('Hidden virtual', 0x1c, 34, false)
const physical = {
  ...circuit('Physical', 0x1c, 0), virtual: { virtualOnly: false }
}
const mapping = { circuits: [marina, shower, elsewhere, hidden, physical] }

function read (line) { return virtual.decodeVirtualSignalStatus(nmea.parseRawLine(line)) }
function frame (module, subtype, value, canId = '1CFF1507') {
  return `20:46:19.721 R ${canId} 27 99 ${module.toString(16).padStart(2, '0')} ${subtype.toString(16).padStart(2, '0')} ${value.toString(16).padStart(2, '0')} 00 00 00`
}

// Observed Yacht Devices status values, preserving their actual order
// from SugarShack-20261111-01-VirtualSwitches.CAN. Duplicate periodic
// advertisements are omitted because the publishing cache deduplicates them.
const observed = [
  ['20:46:19.721', 0x00, false, false],
  ['20:46:21.410', 0x01, true, false],
  ['20:46:27.140', 0x00, false, false],
  ['20:46:32.818', 0x01, true, false],
  ['20:46:38.365', 0x00, false, false],
  ['20:46:48.923', 0x02, false, true],
  ['20:46:56.892', 0x00, false, false],
  ['20:47:01.664', 0x02, false, true],
  ['20:47:06.944', 0x00, false, false],
  ['20:47:12.787', 0x02, false, true],
  ['20:47:19.232', 0x03, true, true]
]
for (const [timestamp, value, marinaOn, showerOn] of observed) {
  const status = read(`${timestamp} R 1CFF1507 27 99 1C 9F ${value.toString(16).padStart(2, '0')} 00 00 00`)
  assert(status, 'captured PGN 65301 decoded at ' + timestamp)
  assert.strictEqual(status.module, 0x1c)
  assert.strictEqual(status.bitmap, value)
  const states = virtual.virtualSignalStates(mapping, status)
  assert.deepStrictEqual(states.map(s => [s.circuit.name, s.enabled]), [
    ['In Marina', marinaOn], ['Shower Time', showerOn]
  ], timestamp)
}

// The module address is in the CZone payload, NOT the CAN source address.
// Switches from another ZCF module must decode independently.
assert.deepStrictEqual(virtual.virtualSignalStates(mapping, read(frame(0x28, 0x9f, 1))),
  [{ circuit: elsewhere, enabled: true }])
assert.deepStrictEqual(virtual.virtualSignalStates(mapping, read(frame(0x1c, 0x9f, 1, '1CFF1542')))
  .map(s => s.enabled), [true, false])

// ZCF channels 32-63 are Configuration Tool virtual signals 1-32.
assert.strictEqual(virtual.virtualSignalBit(marina, 0x1c), 0)
assert.strictEqual(virtual.virtualSignalBit(shower, 0x1c), 1)
assert.strictEqual(virtual.virtualSignalBit(circuit('Last', 0x1c, 63), 0x1c), 31)
assert.strictEqual(virtual.virtualSignalBit(circuit('Not virtual', 0x1c, 64), 0x1c), null)
assert.strictEqual(virtual.virtualSignalBit(hidden, 0x1c), null)
assert.strictEqual(virtual.virtualSignalBit(physical, 0x1c), null)

// A virtual signal in channel 32 occupies bit 31 (the fourth payload byte).
const lastSignal = circuit('Last signal', 0x28, 63)
const highBitFrame = nmea.parseRawLine('20:46:19.721 R 1CFF1507 27 99 28 9F 00 00 00 80')
assert.deepStrictEqual(virtual.virtualSignalStates({ circuits: [lastSignal] },
  virtual.decodeVirtualSignalStatus(highBitFrame)), [{ circuit: lastSignal, enabled: true }])

// The existing PGN 65284 and other 65301 subtypes remain untouched.
assert.strictEqual(read('20:46:19.721 R 1CFF0407 27 99 1C 9F 03 00 00 00'), null)
assert.strictEqual(read(frame(0x1c, 0xbf, 3)), null)
assert.strictEqual(read('20:46:19.721 R 1CFF1507 00 99 1C 9F 03 00 00 00'), null)
assert.strictEqual(virtual.decodeVirtualSignalStatus(null), null)

// Ambiguous ZCF module/channel identity must not invent a Signal K state.
const duplicate = circuit('Duplicate', 0x1c, 32)
assert.deepStrictEqual(
  virtual.virtualSignalStates({ circuits: [marina, duplicate, shower] }, { module: 0x1c, bitmap: 3 }),
  [{ circuit: shower, enabled: true }]
)

console.log('CZone virtual signal status capture and module mapping tests passed')
