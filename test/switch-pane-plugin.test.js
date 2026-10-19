'use strict'

// The Victron switch pane inside the plugin: TestBench.zcf, a stand-in D-Bus
// in place of the GX's, and CZone frames as the test bench sends them.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const objects = {}
const names = []
const fakeBus = {
  exportInterface: (obj, p) => { objects[p] = obj },
  requestName: (name, flags, cb) => { names.push(name); cb(null, 1) },
  releaseName: (name, cb) => cb && cb(null),
  sendSignal: () => {},
  invoke: (msg, cb) => cb(new Error('no localsettings')),
  connection: { on () {}, end () {} }
}
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'dbus-native') return { systemBus: () => fakeBus }
  return realLoad.call(this, request, ...rest)
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function startPlugin (settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'czone-pane-'))
  const dataDir = path.join(dir, 'plugin-config-data', 'signalk-czone')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'TestBench.zcf'), path.join(dataDir, 'installation.zcf'))
  const listeners = new Map()
  const out = []
  const app = {
    config: { configPath: dir },
    debug () {}, error () {}, setPluginStatus () {}, setPluginError () {},
    on: (e, fn) => listeners.set(e, fn), removeListener: e => listeners.delete(e),
    emit: (e, line) => { if (e === 'nmea2000out') out.push(line) },
    handleMessage () {}, registerPutHandler () {},
    isNmea2000OutAvailable: true,
    getSelfPath: () => undefined,
    getDataDirPath: () => dataDir
  }
  delete require.cache[require.resolve('../index')]
  const plugin = require('../index')(app)
  plugin.start(settings)
  const frame = f => listeners.get('canboatjs:rawoutput')(`2026-10-18T05:00:00.000Z R ${f}`)
  const routes = {}
  plugin.registerWithRouter({ get: (p, fn) => { routes[p] = fn }, post () {}, put () {}, delete () {} })
  const paneStatus = () => { let v; routes['/victron/status']({}, { json: x => { v = x } }); return v }
  return { plugin, frame, out, paneStatus }
}

const get = p => objects[p] && objects[p].GetValue()[1]
const tap = (slug, on) => objects[`/SwitchableOutput/${slug}/State`].SetValue([[{ type: 'i' }], [on ? 1 : 0]])

;(async () => {
  // Off unless ticked.
  {
    const p = startPlugin({ allowCzoneWrite: true })
    await wait(50)
    assert.strictEqual(p.paneStatus().running, false)
    assert.strictEqual(Object.keys(objects).length, 0)
    p.plugin.stop()
  }

  {
    const p = startPlugin({
      allowCzoneWrite: true,
      victronSwitches: true,
      confirmOff: [{ circuit: 'Light 2' }],
      bridges: [{ circuit: 'Light 3', target: 'shelly', host: '127.0.0.1', channel: 0 }]
    })
    for (let i = 0; i < 50 && !p.paneStatus().running; i++) await wait(20)
    const st = p.paneStatus()
    assert.strictEqual(st.running, true, JSON.stringify(st))
    // The webapp's circuits, less the one linked to a third-party switch.
    assert.strictEqual(st.channels, 5)
    assert.strictEqual(objects['/SwitchableOutput/Light_3/State'], undefined)
    assert.strictEqual(get('/SwitchableOutput/Light_1/Settings/Group'), 'Lighting')
    assert.strictEqual(get('/SwitchableOutput/Buzzer/Settings/Group'), 'Pumps')
    assert.strictEqual(get('/SwitchableOutput/Light_1/Name'), 'CZone')
    assert.strictEqual(get('/Mgmt/ProcessName'), 'signalk-czone')
    assert(names.includes('com.victronenergy.switch.czone'), names.join(','))

    // CZone -> pane: the plugin's decoded 65284 state (module 1 bit 0 = Light 1).
    p.frame('1CFF0401 27 99 01 0F 01 00 00 00')
    p.plugin._switchPane._resync()
    assert.strictEqual(get('/SwitchableOutput/Light_1/State'), 1)
    assert.strictEqual(get('/SwitchableOutput/Light_2/State'), 0)

    // Pane -> CZone: a tap sends the command (Light 1 is circuit 6).
    const before = p.out.length
    assert.strictEqual(tap('Light_1', false), 0)
    assert(p.out.length > before && p.out.slice(before).some(l => /,27,99,06,00,00,/i.test(l)), p.out.slice(before).join('\n'))

    // A circuit set to confirm before turning off is not turned off from the
    // pane (it cannot ask); turning it on is fine.
    const n = p.out.length
    assert.strictEqual(tap('Light_2', false), 1)
    assert.strictEqual(p.out.length, n)
    assert.match(p.paneStatus().recent[0].result, /confirm before turning off/)
    assert.strictEqual(tap('Light_2', true), 0)
    assert(p.out.length > n)
    // Choosing momentary would reset (turn off) the output: refused for a
    // circuit that asks before turning off, and nothing is sent.
    const m = p.out.length
    assert.strictEqual(get('/SwitchableOutput/Light_2/State'), 1)
    assert.strictEqual(objects['/SwitchableOutput/Light_2/Settings/Type'].SetValue([[{ type: 'i' }], [0]]), 1)
    assert.strictEqual(get('/SwitchableOutput/Light_2/Settings/Type'), 1)
    assert.strictEqual(p.out.length, m)

    // Momentary on a circuit that is on, with the state the plugin itself
    // decodes (the path the pane uses on a boat). The off is sent; until CZone
    // reports it off, momentary is provisional.
    const realNow = Date.now
    const later = ms => { Date.now = () => realNow() + ms; p.plugin._switchPane._resync(); Date.now = realNow }
    p.frame('1CFF0401 27 99 01 0F 01 00 00 00') // Light 1 on
    later(6000) // past the grace of the tap above
    assert.strictEqual(get('/SwitchableOutput/Light_1/State'), 1)
    let k = p.out.length
    assert.strictEqual(objects['/SwitchableOutput/Light_1/Settings/Type'].SetValue([[{ type: 'i' }], [0]]), 0)
    assert(p.out.slice(k).some(l => /,27,99,06,00,00,/i.test(l)), 'off sent')
    later(1000) // within the grace period: nothing undone
    assert.strictEqual(get('/SwitchableOutput/Light_1/Settings/Type'), 0)
    // CZone never reports it off: toggle comes back, and the pane shows it on.
    later(12000)
    assert.strictEqual(get('/SwitchableOutput/Light_1/Settings/Type'), 1)
    assert.strictEqual(get('/SwitchableOutput/Light_1/State'), 1)
    assert(p.paneStatus().recent.some(r => /did not confirm the off/.test(r.refused || '')))
    // CZone does report it off: momentary stands.
    k = p.out.length
    assert.strictEqual(objects['/SwitchableOutput/Light_1/Settings/Type'].SetValue([[{ type: 'i' }], [0]]), 0)
    assert(p.out.length > k)
    p.frame('1CFF0401 27 99 01 0F 00 00 00 00') // Light 1 off
    later(18000)
    assert.strictEqual(get('/SwitchableOutput/Light_1/Settings/Type'), 0)
    assert.strictEqual(get('/SwitchableOutput/Light_1/State'), 0)
    later(30000)
    assert.strictEqual(get('/SwitchableOutput/Light_1/Settings/Type'), 0)
    p.plugin.stop()
    assert.strictEqual(p.paneStatus().running, false)
  }

  // Sending not enabled: the tap is refused and nothing goes on the bus.
  {
    const p = startPlugin({ allowCzoneWrite: false, victronSwitches: true })
    for (let i = 0; i < 50 && !p.paneStatus().running; i++) await wait(20)
    const n = p.out.length
    assert.strictEqual(tap('Light_4', true), 1)
    assert.strictEqual(p.out.length, n)
    p.plugin.stop()
  }

  console.log('Victron switch pane plugin tests passed')
})().catch(err => { console.error(err); process.exit(1) })
