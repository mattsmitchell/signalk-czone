'use strict'

const assert = require('assert')
const zcf = require('../lib/zcf')

function makeRecord ({ channel, module, id, name, categoryBits = 0, categoryWord = 0 }) {
  const nameBuf = Buffer.from(name, 'ascii')
  const buf = Buffer.alloc(17 + nameBuf.length)
  buf[4] = channel
  buf[5] = module
  buf[6] = 0xE8
  buf[7] = 0x03
  buf[9] = id
  buf.writeUInt32LE(categoryBits >>> 0, 10)
  buf.writeUInt16LE(categoryWord, 14)
  buf[16] = nameBuf.length
  nameBuf.copy(buf, 17)
  return buf
}

const records = Buffer.concat([
  Buffer.alloc(32),
  makeRecord({ channel: 5, module: 1, id: 0x06, name: 'Light 1', categoryBits: 0x04000000, categoryWord: 0x20 }),
  makeRecord({ channel: 0, module: 0xF8, id: 0x44, name: 'Water Heater Port', categoryWord: 0x40 })
])

const circuits = zcf.parseCircuitRecords(records)
assert.strictEqual(circuits.length, 2)
assert.deepStrictEqual(
  circuits.map(c => [c.name, c.module, c.channel, c.zcfCircuitId, c.page, c.slot]),
  [
    ['Light 1', 1, 5, 0x06, 0, 5],
    ['Water Heater Port', 0xF8, 0, 0x44, 0, 0]
  ]
)
assert.deepStrictEqual(circuits[0].subCategories, ['Lighting'])
assert.strictEqual(circuits[0].masterCategory, 'DC')
assert.strictEqual(circuits[1].masterCategory, 'AC')

const mapping = {
  circuits,
  currentMappings: circuits.map(c => {
    const current = zcf.classifyCurrentMapping(c)
    return current ? { ...c, ...current } : null
  }).filter(Boolean)
}

assert.strictEqual(mapping.currentMappings.length, 2)
assert.strictEqual(mapping.currentMappings[0].pgn, zcf.CURRENT_PGN_DC)
assert.strictEqual(mapping.currentMappings[0].scale_A_per_bit, 0.1)
assert.strictEqual(mapping.currentMappings[1].pgn, zcf.CURRENT_PGN_AC)
assert.strictEqual(mapping.currentMappings[1].scale_A_per_bit, 0.2)
assert.strictEqual(zcf.lookup(mapping, 1, 0, 5, zcf.CURRENT_PGN_DC).name, 'Light 1')
assert.strictEqual(zcf.lookup(mapping, 0xF8, 0, 0, zcf.CURRENT_PGN_AC).name, 'Water Heater Port')

console.log('Beta.12 ZCF parser compatibility tests passed')
