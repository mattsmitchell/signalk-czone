'use strict'

// The switch label is held steady. Every change of a switch's name makes the
// GX re-sort its lists and jump to the selected row (seen on the CZone
// device's Outputs page on Compass Rose, 4 Oct 2026: "Instruments (1.9 A)" and
// "(2.0 A)" alternating, "Freezer (-4.3 °C, 3.0 A)" and "3.1 A"). A wobble of
// 0.1 must not change the name; a real step, on and off must, at once.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createVictronSwitches, labelWith } = require('../lib/victron/switches')

// A metered circuit (its load measured by a Shelly) leads the pane label with
// power; a plain CZone load shows current. gui-v2 does not render the dbus
// /Current field, so the plugin composes the value into the name itself.
assert.strictEqual(labelWith('HWC', null, 3.1, 'C'), 'HWC (3.1 A)')
assert.strictEqual(labelWith('HWC', null, 3.1, 'C', 688.2), 'HWC (688 W)', 'watts preferred over amps when metered')
assert.strictEqual(labelWith('HWC', null, null, 'C', 688.2), 'HWC (688 W)')
assert.strictEqual(labelWith('Fridge', 273.15 - 4.3, null, 'C', 120.6), 'Fridge (-4.3 °C, 121 W)', 'temperature then power')

const objects = {}
const bus = {
  exportInterface: (obj, p) => { objects[p] = obj },
  requestName: (name, flags, cb) => cb(null, 1),
  sendSignal: () => {},
  invoke: (msg, cb) => cb(new Error('no localsettings'))
}
const sk = { 'electrical.czone.Light_2.switch.state': { value: true } }
let deltaListener = null
const app = {
  getDataDirPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'vsl-')),
  putSelfPath: () => {},
  getSelfPath: p => sk[p],
  streambundle: { getSelfBus: () => ({ onValue: fn => { deltaListener = fn; return () => {} } }) }
}
let amps = 1.9
let celsius = -4.3
let clock = 1e12
const K = c => c + 273.15
let watts = null
let volts = null
const sw = createVictronSwitches(app, {
  getCurrent: p => (p === 'electrical.czone.Light_2.current' ? amps : null),
  getPower: p => (p === 'electrical.czone.Light_2.power' ? watts : null),
  getVoltage: slug => (slug === 'Light_2' ? volts : null),
  getTemperature: slug => (slug === 'Light_2' ? K(celsius) : null),
  now: () => clock,
  version: 'test'
})

sw.start({ victronSwitches: true }, path.join(__dirname, 'fixtures', 'TestBench.zcf'), { bus }).then(() => {
  const name = () => objects['/SwitchableOutput/Light_2/Settings/CustomName'].GetValue()[1]
  const current = () => objects['/SwitchableOutput/Light_2/Current'].GetValue()[1]
  const read = (a, c, seconds = 2) => { amps = a; celsius = c; clock += seconds * 1000; sw._resync() }

  assert.strictEqual(name(), 'Light 2 (-4.3 °C, 1.9 A)')

  // Wobbling by 0.1 for ten minutes: the name never changes, /Current always does.
  for (let i = 0; i < 150; i++) {
    read(i % 2 ? 1.9 : 2.0, -4.3)
    assert.strictEqual(name(), 'Light 2 (-4.3 °C, 1.9 A)')
    assert.strictEqual(current(), i % 2 ? 1.9 : 2.0)
  }

  // Settling 0.1 away: taken up once it has stayed there for two minutes.
  read(1.9, -4.3); read(2.0, -4.3); read(2.0, -4.3, 100)
  assert.strictEqual(name(), 'Light 2 (-4.3 °C, 1.9 A)')
  read(2.0, -4.3, 30)
  assert.strictEqual(name(), 'Light 2 (-4.3 °C, 2.0 A)')

  // A real step shows at once.
  read(2.3, -4.3)
  assert.strictEqual(name(), 'Light 2 (-4.3 °C, 2.3 A)')
  read(2.1, -4.3)
  assert.strictEqual(name(), 'Light 2 (-4.3 °C, 2.1 A)')

  // Off and on show at once.
  sk['electrical.czone.Light_2.switch.state'] = { value: false }
  deltaListener({ path: 'electrical.czone.Light_2.switch.state', value: false })
  assert.strictEqual(name(), 'Light 2 (-4.3 °C)')
  sk['electrical.czone.Light_2.switch.state'] = { value: true }
  deltaListener({ path: 'electrical.czone.Light_2.switch.state', value: true })
  assert.strictEqual(name(), 'Light 2 (-4.3 °C, 2.1 A)')

  // Temperature: 0.1 ° is held, half a degree shows at once, a slow drift after five minutes.
  read(2.1, -4.2); assert.strictEqual(name(), 'Light 2 (-4.3 °C, 2.1 A)')
  read(2.1, -4.4); assert.strictEqual(name(), 'Light 2 (-4.3 °C, 2.1 A)')
  read(2.1, -3.7); assert.strictEqual(name(), 'Light 2 (-3.7 °C, 2.1 A)')
  read(2.1, -3.5); read(2.1, -3.5, 290); assert.strictEqual(name(), 'Light 2 (-3.7 °C, 2.1 A)')
  read(2.1, -3.5, 20); assert.strictEqual(name(), 'Light 2 (-3.5 °C, 2.1 A)')

  // Metering: an AC load (its Shelly reads mains voltage) is labelled in watts,
  // not amps; a DC load (bank voltage) stays in amps. Light_2 is on at -3.5 °C.
  watts = 688.2; volts = 229.4; read(2.1, -3.5)
  assert.strictEqual(name(), 'Light 2 (-3.5 °C, 688 W)', 'AC load: watts, not amps')
  volts = 27.4; read(2.1, -3.5) // a DC bank voltage instead
  assert.strictEqual(name(), 'Light 2 (-3.5 °C, 2.1 A)', 'DC load: amps, not watts')
  watts = null; volts = null

  sw.stop()
  console.log('Switch label steadiness tests passed')
}).catch(err => { console.error(err); process.exit(1) })
