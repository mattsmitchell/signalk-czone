'use strict'

const assert = require('assert')
const path = require('path')
const zcf = require('../lib/zcf')

const cases = [
  ['SugarShack-20260927-01.zcf', 'Sugar Shack-20260927-01', 108],
  ['TestBench.zcf', 'Test Bench', 5],
  ['Compass-Rose-28.06.26.zcf', 'Compass Rose 28.06.26', 21],
  ['Persevere-14.07.25.zcf', 'Persevere 14.07.25', 59],
  ['Sel-Citron-02.04.25.zcf', 'Sel Citron 02.04.25', 100],
  ['Meitaki-07.04.25.zcf', 'Meitaki 07.04.25', 103]
]

for (const [filename, vesselName, expectedCount] of cases) {
  const mapping = zcf.load(path.join(__dirname, 'fixtures', filename))
  assert.strictEqual(mapping.vesselName, vesselName, `${filename}: vessel/config name`)
  assert.strictEqual(mapping.circuits.length, expectedCount, `${filename}: circuit count`)
  assert(mapping.circuits.every(c => c.module > 0), `${filename}: no primary circuit may use module 0`)
  assert(mapping.circuits.every(c => c.channel >= 0 && c.channel <= 32), `${filename}: channel range`)
  assert(mapping.circuits.every(c => c.name.length > 0), `${filename}: circuit names`)
}

const testBench = zcf.load(path.join(__dirname, 'fixtures', 'TestBench.zcf'))
assert.deepStrictEqual(
  testBench.circuits.map(c => [c.name, c.module, c.channel, c.zcfCircuitId]),
  [
    ['Light 1', 1, 5, 0x06],
    ['Light 2', 1, 0, 0x07],
    ['Light 3', 1, 1, 0x08],
    ['Light 4', 1, 2, 0x09],
    ['Light 5', 1, 3, 0x0A]
  ]
)

console.log('Real-world ZCF fixture parser tests passed')
