'use strict'

const assert = require('assert')
const signalk = require('../lib/signalk')

const circuit = {
  slug: 'Courtesy_Blue',
  source: 'CZone-DC'
}

assert.strictEqual(
  signalk.statePath(circuit),
  'electrical.czone.Courtesy_Blue.switch.state'
)

assert.strictEqual(
  signalk.brightnessPath(circuit),
  'electrical.czone.Courtesy_Blue.switch.brightness'
)

const delta = signalk.circuitDelta(
  signalk.statePath(circuit),
  true,
  circuit,
  signalk.nmea2000Source(42, 65284)
)

assert.strictEqual(delta.context, 'vessels.self')
assert.deepStrictEqual(delta.updates[0].source, {
  label: 'CZone-DC',
  type: 'NMEA2000',
  src: '42',
  pgn: 65284
})
assert.deepStrictEqual(delta.updates[0].values, [{
  path: 'electrical.czone.Courtesy_Blue.switch.state',
  value: true
}])

console.log('signalk path tests passed')
