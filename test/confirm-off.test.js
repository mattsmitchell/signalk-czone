'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const confirmOff = require('../lib/confirm-off')
const pluginFactory = require('../index')

// --- the nomination list, no ZCF needed ---------------------------------------
const sample = [
  { name: 'Freezer', slug: 'Freezer' },
  { name: 'Instruments ', slug: 'Instruments' },
  { name: 'Hidden Relay', slug: 'Hidden_Relay', hidden: true },
  { name: 'Not Listed', slug: 'Not_Listed', showInCircuitList: false },
  { name: 'Cabin Lights', slug: 'Cabin_Lights' }
]

assert.deepStrictEqual(confirmOff.entries({}), [])
assert.deepStrictEqual(confirmOff.entries({ confirmOff: 'Freezer' }), [])
assert.deepStrictEqual(
  confirmOff.entries({ confirmOff: ['Freezer', { circuit: ' Instruments ' }, { circuit: '' }, null, {}] }),
  [{ circuit: 'Freezer' }, { circuit: 'Instruments' }]
)

let found = confirmOff.confirmOffFor({ confirmOff: [{ circuit: 'freezer' }, { circuit: 'Instruments' }, { circuit: 'Cabin_Lights' }, { circuit: 'Gone' }] }, sample)
// Matched without regard to case or outer spaces, by name or by slug; the set
// holds the circuit's own name exactly as the configuration has it.
assert.deepStrictEqual([...found.marked].sort(), ['Cabin Lights', 'Freezer', 'Instruments '])
assert.deepStrictEqual(found.unknown, ['Gone'])
const foundOn = confirmOff.confirmOnFor({ confirmOn: [{ circuit: 'freezer' }, { circuit: 'Cabin_Lights' }] }, sample)
assert.deepStrictEqual([...foundOn.marked].sort(), ['Cabin Lights', 'Freezer'])
assert.deepStrictEqual(confirmOff.confirmOnChoices({ confirmOn: [{ circuit: 'Old Pump' }] }, sample).slice(-1), [{ value: 'Old Pump', label: 'Old Pump (not in this configuration)' }])
found = confirmOff.confirmOffFor(undefined, sample)
assert.strictEqual(found.marked.size, 0)

// Offered: the circuits the webapp lists, sorted; a saved name that this
// configuration no longer has stays selectable so the form still saves.
assert.deepStrictEqual(
  confirmOff.choices({ confirmOff: [{ circuit: 'Freezer' }, { circuit: 'Old Fridge' }] }, sample),
  [
    { value: 'Cabin Lights', label: 'Cabin Lights' },
    { value: 'Freezer', label: 'Freezer' },
    { value: 'Instruments', label: 'Instruments' },
    { value: 'Old Fridge', label: 'Old Fridge (not in this configuration)' }
  ]
)

// --- the plugin, against the canonical Sugar Shack configuration ---------------
const fixtureName = 'SugarShack-20260927-01.zcf'
const fixtureUrl = 'https://raw.githubusercontent.com/mattsmitchell/signalk-czone-zcf/main/test/fixtures/' + fixtureName

async function fixture () {
  const local = path.join(__dirname, 'fixtures', fixtureName)
  if (fs.existsSync(local)) return fs.readFileSync(local)
  const response = await fetch(fixtureUrl)
  assert.strictEqual(response.ok, true, fixtureName + ': canonical fixture download failed (' + response.status + ')')
  return Buffer.from(await response.arrayBuffer())
}

function makePlugin (zcfBuffer) {
  const configPath = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-czone-confirm-'))
  const dir = path.join(configPath, 'plugin-config-data', 'signalk-czone')
  fs.mkdirSync(dir, { recursive: true })
  if (zcfBuffer) fs.writeFileSync(path.join(dir, 'installation.zcf'), zcfBuffer)
  const putHandlers = new Map()
  const emitted = []
  const app = {
    config: { configPath },
    isNmea2000OutAvailable: true,
    on: () => {},
    emit: (event, line) => { if (event === 'nmea2000out') emitted.push(line) },
    debug: () => {},
    registerPutHandler: (_context, pathName, handler) => putHandlers.set(pathName, handler),
    handleMessage: () => {},
    setPluginStatus: () => {}
  }
  const plugin = pluginFactory(app)
  const routes = { get: new Map(), post: new Map() }
  plugin.registerWithRouter({ get: (p, fn) => routes.get.set(p, fn), post: (p, fn) => routes.post.set(p, fn) })
  const call = (method, route, { params = {}, query = {}, body } = {}) => {
    const out = { status: 200, body: undefined }
    const res = { status (code) { out.status = code; return res }, json (value) { out.body = value; return res } }
    routes[method].get(route)({ params, query, body }, res)
    return out
  }
  const put = (pathName, value) => putHandlers.get(pathName)('vessels.self', pathName, value, () => {})
  // Compare commands without their timestamp.
  const sent = from => emitted.slice(from).map(line => line.split(',').slice(1).join(','))
  return { plugin, call, put, emitted, sent }
}

const pianoState = 'electrical.czone.Piano_Light.switch.state'
const galleyState = 'electrical.czone.Galley_Lights.switch.state'
const galleyBrightness = 'electrical.czone.Galley_Lights.switch.brightness'
const fridgeState = 'electrical.czone.100L_Fridge.switch.state'
const modeActive = 'electrical.czone.mode.active'
const ok = { state: 'COMPLETED', statusCode: 200 }

async function main () {
  const zcf = await fixture()

  // What an off looks like with nothing nominated: the reference.
  const plain = makePlugin(zcf)
  plain.plugin.start({ allowCzoneWrite: true })
  assert.deepStrictEqual(plain.put(pianoState, false), ok)
  const pianoOff = plain.sent(0)
  assert(pianoOff.length >= 1)
  let mark = plain.emitted.length
  assert.deepStrictEqual(plain.put(galleyState, false), ok)
  const galleyOff = plain.sent(mark)
  assert.strictEqual(plain.call('post', '/circuits/:name/off', { params: { name: 'Piano_Light' } }).status, 200)
  assert(plain.call('get', '/circuits').body.circuits.every(c => c.confirmOff === undefined))
  plain.plugin.stop()

  // Piano Light (a switch) and Galley Lights (a dimmer) nominated.
  const p = makePlugin(zcf)
  p.plugin.start({ allowCzoneWrite: true, confirmOff: [{ circuit: 'piano light' }, 'Galley_Lights', { circuit: 'No Such Circuit' }] })

  const listed = p.call('get', '/circuits').body.circuits
  assert.deepStrictEqual(listed.filter(c => c.confirmOff === true).map(c => c.name).sort(), ['Galley Lights', 'Piano Light'])

  const names = p.call('get', '/configuration').body.circuitNames
  assert(names.includes('Piano Light') && names.includes('100L Fridge'))
  assert.strictEqual(names.length, listed.filter(c => !c.hidden && c.showInCircuitList !== false).length)

  const schema = p.plugin.schema().properties
  assert(schema.confirmOff.items.properties.circuit.enum.includes('Piano Light'))
  // A saved name that is not in this configuration is still a valid choice.
  assert(schema.confirmOff.items.properties.circuit.enum.includes('No Such Circuit'))
  assert.strictEqual(schema.confirmOffAllowElsewhere.default, false)

  // ON is never held up.
  mark = p.emitted.length
  assert.deepStrictEqual(p.put(pianoState, true), ok)
  assert(p.emitted.length > mark)
  assert.strictEqual(p.call('post', '/circuits/:name/on', { params: { name: 'Piano_Light' } }).status, 200)

  // An off by PUT cannot say "confirmed": refused, and nothing goes on the bus.
  mark = p.emitted.length
  let result = p.put(pianoState, false)
  assert.strictEqual(result.statusCode, 400)
  assert(/confirm before turning off/.test(result.message))
  result = p.put(galleyState, false)
  assert.strictEqual(result.statusCode, 400)
  result = p.put(galleyBrightness, 0)
  assert.strictEqual(result.statusCode, 400)
  assert.strictEqual(p.emitted.length, mark)

  // Dimming a nominated circuit is not an off.
  assert.deepStrictEqual(p.put(galleyBrightness, 0.5), ok)

  // A circuit that is not nominated is untouched.
  assert.deepStrictEqual(p.put(fridgeState, false), ok)

  // The plugin's off route: asks first (409), then sends exactly what an
  // ordinary off sends.
  mark = p.emitted.length
  let reply = p.call('post', '/circuits/:name/off', { params: { name: 'Piano_Light' } })
  assert.strictEqual(reply.status, 409)
  assert.strictEqual(reply.body.needsConfirm, true)
  assert.strictEqual(reply.body.circuit, 'Piano Light')
  assert.strictEqual(p.emitted.length, mark)
  reply = p.call('post', '/circuits/:name/off', { params: { name: 'Piano_Light' }, query: { confirm: '1' } })
  assert.strictEqual(reply.status, 200)
  assert.deepStrictEqual(p.sent(mark), pianoOff)

  mark = p.emitted.length
  reply = p.call('post', '/circuits/:name/off', { params: { name: 'Galley Lights' }, body: { confirm: true } })
  assert.strictEqual(reply.status, 200)
  assert.deepStrictEqual(p.sent(mark), galleyOff)

  // Level 0 through the level route is an off too.
  mark = p.emitted.length
  reply = p.call('post', '/circuits/:name/level', { params: { name: 'Galley_Lights' }, body: { percent: 0 } })
  assert.strictEqual(reply.status, 409)
  assert.strictEqual(p.emitted.length, mark)
  assert.strictEqual(p.call('post', '/circuits/:name/level', { params: { name: 'Galley_Lights' }, body: { percent: 0, confirm: true } }).status, 200)
  assert.strictEqual(p.call('post', '/circuits/:name/level', { params: { name: 'Galley_Lights' }, body: { percent: 40 } }).status, 200)

  // Modes are not held up, whatever they switch.
  mark = p.emitted.length
  assert.deepStrictEqual(p.put(modeActive, 'nightCruising'), ok)
  assert.strictEqual(p.call('post', '/modes/:name/activate', { params: { name: 'nightCruising' } }).status, 200)
  assert(p.emitted.length > mark)

  // The nominations follow the settings across a plugin restart.
  p.plugin.stop()
  p.plugin.start({ allowCzoneWrite: true, confirmOff: [{ circuit: 'Piano Light' }], confirmOffAllowElsewhere: true })
  // Allowed elsewhere: a PUT off goes through...
  mark = p.emitted.length
  assert.deepStrictEqual(p.put(pianoState, false), ok)
  assert.deepStrictEqual(p.sent(mark), pianoOff)
  // ...Galley Lights is no longer nominated...
  assert.deepStrictEqual(p.put(galleyState, false), ok)
  // ...and the webapp still asks.
  assert.strictEqual(p.call('post', '/circuits/:name/off', { params: { name: 'Piano_Light' } }).status, 409)
  assert.deepStrictEqual(p.call('get', '/circuits').body.circuits.filter(c => c.confirmOff).map(c => c.name), ['Piano Light'])
  p.plugin.stop()

  // With no configuration loaded there is nothing to choose from: the schema
  // falls back to a free-text name, and nothing breaks.
  const empty = makePlugin(null)
  empty.plugin.start({ confirmOff: [{ circuit: 'Freezer' }] })
  assert.deepStrictEqual(empty.call('get', '/configuration').body.circuitNames, [])
  const emptySchema = empty.plugin.schema().properties.confirmOff.items.properties.circuit
  assert.deepStrictEqual(emptySchema.enum, ['Freezer'])
  empty.plugin.stop()
  const fresh = makePlugin(null)
  assert.strictEqual(fresh.plugin.schema().properties.confirmOff.items.properties.circuit.enum, undefined)

  // Confirm-before-ON is independent of the tested OFF behaviour above.
  // 100L Fridge exercises a normal switch; Galley Lights exercises the
  // implicit ON performed by a positive dimmer level while its state is OFF
  // or has not yet been observed.
  const onp = makePlugin(zcf)
  onp.plugin.start({
    allowCzoneWrite: true,
    confirmOn: [{ circuit: '100L Fridge' }, { circuit: 'Galley_Lights' }]
  })
  const onListed = onp.call('get', '/circuits').body.circuits
  assert.deepStrictEqual(onListed.filter(c => c.confirmOn === true).map(c => c.name).sort(), ['100L Fridge', 'Galley Lights'])
  assert(onp.plugin.schema().properties.confirmOn.items.properties.circuit.enum.includes('100L Fridge'))
  assert.strictEqual(onp.plugin.schema().properties.confirmOnAllowElsewhere.default, false)

  mark = onp.emitted.length
  result = onp.put(fridgeState, true)
  assert.strictEqual(result.statusCode, 400)
  assert(/confirm before turning on/.test(result.message))
  assert.strictEqual(onp.emitted.length, mark)

  reply = onp.call('post', '/circuits/:name/on', { params: { name: '100L_Fridge' } })
  assert.strictEqual(reply.status, 409)
  assert.strictEqual(reply.body.needsConfirm, true)
  assert.strictEqual(reply.body.action, 'on')
  assert.strictEqual(onp.emitted.length, mark)
  assert.strictEqual(onp.call('post', '/circuits/:name/on', { params: { name: '100L_Fridge' }, query: { confirm: '1' } }).status, 200)
  assert(onp.emitted.length > mark)

  mark = onp.emitted.length
  result = onp.put(galleyBrightness, 0.5)
  assert.strictEqual(result.statusCode, 400)
  assert(/confirm before turning on/.test(result.message))
  assert.strictEqual(onp.emitted.length, mark)
  reply = onp.call('post', '/circuits/:name/level', { params: { name: 'Galley_Lights' }, body: { percent: 40 } })
  assert.strictEqual(reply.status, 409)
  assert.strictEqual(reply.body.action, 'on')
  assert.strictEqual(onp.call('post', '/circuits/:name/level', { params: { name: 'Galley_Lights' }, body: { percent: 40, confirm: true } }).status, 200)
  onp.plugin.stop()

  // The ON bypass is independent too.
  const bypass = makePlugin(zcf)
  bypass.plugin.start({ allowCzoneWrite: true, confirmOn: [{ circuit: '100L Fridge' }], confirmOnAllowElsewhere: true })
  assert.deepStrictEqual(bypass.put(fridgeState, true), ok)
  bypass.plugin.stop()

  console.log('Confirm before ON/OFF tests passed')
}

main().catch(err => { console.error(err); process.exit(1) })
