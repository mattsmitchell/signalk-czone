'use strict'

// Switch inputs (lib/inputs.js and their wiring in index.js), with frames
// recorded on the test bench (Signal Interface), SugarShack (COI) and
// Compass Rose (Control X PLUS).

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const inputs = require('../lib/inputs')
const zcf = require('../lib/zcf')
const pluginFactory = require('../index')

const fixture = name => path.join(__dirname, 'fixtures', name)

// --- lib/inputs.js on its own ---------------------------------------------

assert.strictEqual(inputs.decodeFrame(Buffer.from('2799021f0a000000', 'hex')).bitmap, 0x0a)
assert.strictEqual(inputs.decodeFrame(Buffer.from('2799021f0a0000', 'hex')), null, 'short frame')
assert.strictEqual(inputs.decodeFrame(Buffer.from('2798021f0a000000', 'hex')), null, 'not 27 99')

// Signal Interface: input n at bit 2n+1, in 65284 and 65308.
assert.strictEqual(inputs.inputState(0x0d, 0x02, 0, 65284), true)
assert.strictEqual(inputs.inputState(0x0d, 0x01, 0, 65284), false, 'even bit is not the input')
assert.strictEqual(inputs.inputState(0x0d, 0x200, 4, 65308), true)
// COI: 65308 only, input i (from 16) at bit 2(i-16)+1.
assert.strictEqual(inputs.inputState(0x1f, 0x80, 19, 65308), true)
assert.strictEqual(inputs.inputState(0x1f, 0x80, 19, 65284), undefined, 'a COI 65284 carries its outputs')
assert.strictEqual(inputs.inputState(0x1f, 0xffffffff, 3, 65308), undefined, 'COI inputs are numbered from 16')
// Control X PLUS: 65284 only, bit i, or i+1 when it switches to negative.
assert.strictEqual(inputs.inputState(0x36, 1 << 17, 17, 65284, 'switchToPos'), true)
assert.strictEqual(inputs.inputState(0x36, 1 << 19, 18, 65284, 'switchToNeg'), true)
assert.strictEqual(inputs.inputState(0x36, 1 << 18, 18, 65284, 'switchToNeg'), false)
assert.strictEqual(inputs.inputState(0x36, 1 << 17, 17, 65308, 'switchToPos'), undefined, 'CXP 65308 is not read')
// Unknown kinds give no state rather than a guess.
assert.strictEqual(inputs.inputState(0x99, 0xffffffff, 1, 65284), undefined)
assert.strictEqual(inputs.inputState(null, 0xffffffff, 1, 65284), undefined)

// The switch inputs of each fixture, with their module kinds.
const bench = inputs.switchInputs(zcf.load(fixture('TestBench.zcf')))
assert.deepStrictEqual(bench.map(i => i.path), [1, 2, 3, 4, 5].map(n => `electrical.czone.inputs.Switch_${n}.state`))
assert(bench.every(i => i.module === 2 && i.moduleKind === 0x0d && i.decoded))
const compass = inputs.switchInputs(zcf.load(fixture('Compass-Rose-28.06.26.zcf')))
assert.deepStrictEqual(compass.map(i => [i.slug, i.module, i.input, i.moduleKind]), [
  ['BMS_Pre_Alarm', 1, 24, 0x36], ['Anchor_Up', 2, 17, 0x36], ['High_Bilge_Water_Alarm', 2, 18, 0x36], ['Ignition', 2, 24, 0x36]])
assert.strictEqual(compass.find(i => i.slug === 'High_Bilge_Water_Alarm').wiring, 'switchToNeg')
for (const name of ['SugarShack-20260927-01.zcf', 'Meitaki-07.04.25.zcf', 'Persevere-14.07.25.zcf', 'Sel-Citron-02.04.25.zcf']) {
  const list = inputs.switchInputs(zcf.load(fixture(name)))
  assert(list.length > 0, name)
  assert.strictEqual(new Set(list.map(i => i.path)).size, list.length, `${name}: paths are unique`)
}
assert.deepStrictEqual(inputs.switchInputs({}), [])
assert.deepStrictEqual(inputs.switchInputs({ signalInputs: { inputs: [{ type: 'switch', module: 0, input: 1, name: 'Unassigned' }] } }), [], 'module 0 is not wired')

// --- the plugin -------------------------------------------------------------

function startPlugin (zcfName) {
  const configPath = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-czone-inputs-'))
  const dir = path.join(configPath, 'plugin-config-data', 'signalk-czone')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(fixture(zcfName), path.join(dir, 'installation.zcf'))
  const listeners = new Map()
  const deltas = []
  const app = {
    config: { configPath },
    isNmea2000OutAvailable: true,
    on: (event, fn) => listeners.set(event, fn),
    removeListener: event => listeners.delete(event),
    emit: () => {},
    debug: () => {},
    registerPutHandler: () => {},
    handleMessage: (_id, delta) => deltas.push(delta),
    setPluginStatus: () => {},
    setPluginError: () => {}
  }
  const plugin = pluginFactory(app)
  plugin.start({})
  const routes = new Map()
  plugin.registerWithRouter({ get: (p, fn) => routes.set(p, fn), post: () => {}, put: () => {}, delete: () => {} })
  const send = line => listeners.get('canboatjs:rawoutput')(`2026-10-15T06:00:00.000Z R ${line}`)
  // Input values published since the last call, as [path, value].
  const taken = () => {
    const out = []
    for (const d of deltas.splice(0)) {
      for (const u of d.updates) for (const v of u.values) if (v.path.startsWith('electrical.czone.inputs.')) out.push([v.path, v.value])
    }
    return out
  }
  const route = () => { let body; routes.get('/inputs')({}, { json: b => { body = b } }); return body }
  return { plugin, send, taken, route }
}

const P = 'electrical.czone.inputs.'

// Test bench, 6 Oct 2026: Signal Interface module 2, Switch 1 to 5 closed in
// turn. The first status gives every input; later ones only what changed.
{
  const t = startPlugin('TestBench.zcf')
  assert.deepStrictEqual(t.route().inputs.map(i => i.state), [null, null, null, null, null])
  t.send('18FF0402 27 99 02 0D 00 00 00 00')
  assert.deepStrictEqual(t.taken(), [1, 2, 3, 4, 5].map(n => [`${P}Switch_${n}.state`, false]))
  t.send('18FF0402 27 99 02 0D 00 00 00 00')
  assert.deepStrictEqual(t.taken(), [], 'repeated status publishes nothing')
  t.send('18FF0402 27 99 02 0D 02 00 00 00')
  assert.deepStrictEqual(t.taken(), [[`${P}Switch_1.state`, true]])
  t.send('1CFF1C02 27 99 02 00 0A 00 00 00')
  assert.deepStrictEqual(t.taken(), [[`${P}Switch_2.state`, true]], '65308 is read for a Signal Interface')
  t.send('18FF0402 27 99 02 0D AA 02 00 00')
  assert.deepStrictEqual(t.taken(), [[`${P}Switch_3.state`, true], [`${P}Switch_4.state`, true], [`${P}Switch_5.state`, true]])
  t.send('18FF0402 27 99 03 0D 00 00 00 00')
  assert.deepStrictEqual(t.taken(), [], 'another module')
  const body = t.route()
  assert.strictEqual(body.inputs[0].moduleType, 'Signal Interface')
  assert.strictEqual(body.inputs[0].state, true)
  assert(body.inputs[0].since)
  t.plugin.stop()
}

// SugarShack, 27 Sep 2026: COI inputs come in 65308 variant 03.
{
  const t = startPlugin('SugarShack-20260927-01.zcf')
  t.send('1CFF1C06 27 99 1A 03 80 00 00 00')
  const first = t.taken()
  assert.deepStrictEqual(first.filter(([, v]) => v), [[`${P}Bimini_Lights_Switch.state`, true]])
  assert(first.some(([p, v]) => p === `${P}Master_Cabin_Lights_Switch.state` && v === false))
  t.send('1CFF1C06 27 99 1A 03 00 02 00 00')
  assert.deepStrictEqual(t.taken(), [[`${P}Bimini_Lights_Switch.state`, false], [`${P}Salon_Lights_Switch.state`, true]])
  t.send('1CFF1C06 27 99 1C 03 08 00 00 00')
  assert(t.taken().some(([p, v]) => p === `${P}Port_Gway_Lights_Switch.state` && v === true))
  // The COI's 65284 is its outputs: it must not move an input.
  t.send('18FF0406 27 99 1A 1F FF FF FF FF')
  assert.deepStrictEqual(t.taken(), [])
  t.plugin.stop()
}

// Compass Rose, 15 Oct 2026: Control X PLUS module 2, from its 65284. The
// resting status was 13 24 01 00; High Bilge Water Alarm (input 18, to
// negative) set bit 19, Anchor Up (17) bit 17, Ignition (24) bit 24.
{
  const t = startPlugin('Compass-Rose-28.06.26.zcf')
  t.send('18FF0402 27 99 02 08 13 24 01 00')
  assert.deepStrictEqual(t.taken(), [[`${P}Anchor_Up.state`, false], [`${P}High_Bilge_Water_Alarm.state`, false], [`${P}Ignition.state`, false]])
  t.send('18FF0402 27 99 02 08 13 24 09 00')
  assert.deepStrictEqual(t.taken(), [[`${P}High_Bilge_Water_Alarm.state`, true]])
  t.send('18FF0402 27 99 02 08 13 24 01 00')
  assert.deepStrictEqual(t.taken(), [[`${P}High_Bilge_Water_Alarm.state`, false]])
  t.send('18FF0402 27 99 02 08 13 24 03 00')
  assert.deepStrictEqual(t.taken(), [[`${P}Anchor_Up.state`, true]])
  t.send('18FF0402 27 99 02 08 13 24 01 01')
  assert.deepStrictEqual(t.taken(), [[`${P}Anchor_Up.state`, false], [`${P}Ignition.state`, true]])
  // Its 65308 messages are not read.
  t.send('1CFF1C02 27 99 02 03 00 00 00 00')
  assert.deepStrictEqual(t.taken(), [])
  assert.strictEqual(t.route().inputs.find(i => i.name === 'Ignition').state, true)
  t.plugin.stop()
  assert.deepStrictEqual(t.route().inputs, [], 'stop clears the inputs')
}

console.log('inputs tests passed')
