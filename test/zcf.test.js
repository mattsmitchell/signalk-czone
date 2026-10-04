'use strict'

const assert = require('assert')
const zcf = require('../lib/zcf')

const circuits = [
  {
    name: 'Light 1',
    zcfCircuitId: 0x06,
    module: 1,
    channel: 5,
    page: 0,
    slot: 5,
    capabilities: { switch: true, dimmer: false }
  },
  {
    name: 'Water Heater Port',
    zcfCircuitId: 0x44,
    module: 0xF8,
    channel: 0,
    page: 0,
    slot: 0,
    capabilities: { switch: true, dimmer: false }
  }
]

assert.deepStrictEqual(zcf.classifyCurrentMapping(circuits[0]), {
  pgn: zcf.CURRENT_PGN_DC,
  scale_A_per_bit: 0.1
})
assert.deepStrictEqual(zcf.classifyCurrentMapping(circuits[1]), {
  pgn: zcf.CURRENT_PGN_AC,
  scale_A_per_bit: 0.2
})

const mapping = {
  circuits,
  currentMappings: circuits.map(c => {
    const current = zcf.classifyCurrentMapping(c)
    return current ? { ...c, ...current } : null
  }).filter(Boolean)
}

assert.strictEqual(mapping.currentMappings.length, 2)
assert.strictEqual(zcf.lookup(mapping, 1, 0, 5, zcf.CURRENT_PGN_DC).name, 'Light 1')
assert.strictEqual(zcf.lookup(mapping, 0xF8, 0, 0, zcf.CURRENT_PGN_AC).name, 'Water Heater Port')

console.log('Signal K runtime ZCF compatibility tests passed')
