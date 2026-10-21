'use strict'

// Monitoring through the whole plugin: meters, tanks, temperatures, humidity
// and pressure from a real ZCF, read from Signal K's raw frames, from what
// Signal K itself sends (nmea2000JsonOut) and from candump; the Monitoring
// tab's data; trends; a circuit's temperature in the switch pane.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { EventEmitter } = require('events')

// A stand-in D-Bus for the switch pane (as in switch-pane-plugin.test.js).
const objects = {}
const fakeBus = {
  exportInterface: (obj, p) => { objects[p] = obj },
  requestName: (name, flags, cb) => cb(null, 1),
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

function startPlugin (zcfName, settings = {}, appExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'czone-monitor-'))
  const dataDir = path.join(dir, 'plugin-config-data', 'signalk-czone')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fixtures', zcfName), path.join(dataDir, 'installation.zcf'))
  const listeners = new Map()
  const deltas = []
  const app = {
    config: { configPath: dir },
    debug () {}, error () {}, setPluginStatus () {}, setPluginError () {},
    on: (e, fn) => listeners.set(e, fn), removeListener: e => listeners.delete(e),
    emit () {}, registerPutHandler () {},
    handleMessage: (_id, d) => deltas.push(d),
    isNmea2000OutAvailable: true,
    getSelfPath: () => undefined,
    getDataDirPath: () => dataDir,
    ...appExtra
  }
  delete require.cache[require.resolve('../index')]
  const plugin = require('../index')(app)
  plugin.start({ trendDirectory: path.join(dir, 'trends'), monitoringEnabled: true, ...settings })
  const routes = {}
  plugin.registerWithRouter({ get: (p, fn) => { routes[p] = fn }, post () {}, put () {}, delete () {} })
  const get = (route, query = {}) => { let v; routes[route]({ query }, { json: x => { v = x }, status: () => ({ json: x => { v = x } }) }); return v }
  // A frame as Signal K hands it to plugins: priority 6, PGN, source address.
  const raw = (pgn, src, bytes) => listeners.get('canboatjs:rawoutput')(`2026-10-21T00:00:00.000Z R ${((6 << 26 | pgn << 8 | src) >>> 0).toString(16).padStart(8, '0')} ${bytes}`)
  const line = l => listeners.get('canboatjs:rawoutput')(`2026-10-21T00:00:00.000Z R ${l}`)
  const jsonOut = m => listeners.get('nmea2000JsonOut')(m)
  // Values published to Signal K since the last call, by path.
  const published = () => {
    const out = {}
    for (const d of deltas.splice(0)) for (const u of d.updates) for (const v of u.values) out[v.path] = v.value
    return out
  }
  const live = () => get('/monitoring/live')
  const item = name => live().items.find(i => i.name === name)
  const values = name => Object.fromEntries(item(name).readings.map(r => [r.field, Math.round(r.value * 1000) / 1000]))
  return { plugin, raw, line, jsonOut, published, live, item, values, get, listeners, trendDir: path.join(dir, 'trends') }
}

const M = 'electrical.czone.monitoring.'

;(async () => {
  // --- Compass Rose: meters reach the decoder (the parser's meter table is an
  //     object, so before this no meter was ever read), DC watts, fast-packet
  //     meters, third-party senders.
  {
    const t = startPlugin('Compass-Rose-03.10.26.zcf')
    // 127508, House Battery (instance 0): 13.20 V, -12.5 A.
    t.raw(0x1F214, 0x22, '00 28 05 83 FF FF FF 01')
    let p = t.published()
    assert.strictEqual(p[`${M}House_Battery.voltage`], 13.2)
    assert.strictEqual(p[`${M}House_Battery.current`], -12.5)
    assert.strictEqual(p[`${M}House_Battery.power`], -165)
    assert(!(`${M}House_Battery.temperature` in p), 'no temperature: "not available" is not a reading')
    // Solar (instance 1): 13.60 V, 8.0 A = 108.8 W.
    t.raw(0x1F214, 0x23, '01 50 05 50 00 FF FF 02')
    assert.strictEqual(t.published()[`${M}Solar.power`], 108.8)
    // 127506 is a fast packet: state of charge once both frames are in.
    t.raw(0x1F212, 0x22, '40 0B 00 00 00 57 64 FF')
    assert.deepStrictEqual(t.published(), {}, 'first frame only')
    t.raw(0x1F212, 0x22, '41 FF FF FF FF FF FF FF')
    p = t.published()
    assert.strictEqual(p[`${M}House_Battery.capacity.stateOfCharge`], 0.87)
    assert(!(`${M}House_Battery.timeRemaining` in p), 'time remaining not available')
    // 127503, AC Input (instance 1), line 1: 230.00 V, 5.2 A, 50.00 Hz, 1196 W.
    t.raw(0x1F20F, 0x30, '40 14 01 01 00 D8 59 34')
    t.raw(0x1F20F, 0x30, '41 00 88 13 FF FF AC 04')
    t.raw(0x1F20F, 0x30, '42 00 00 FF FF FF FF FF')
    assert.deepStrictEqual(t.values('AC Input'), { voltage: 230, current: 5.2, power: 1196, frequency: 50 })
    // Senders: fridge (Refrigeration 7, instance 0), cabin with humidity,
    // fuel tank, atmospheric pressure (instance 100).
    t.raw(0x1FD08, 0x65, '00 00 07 A7 6C FF FF FF')
    t.raw(0x1FD0C, 0x65, '00 03 04 EE 80 04 FF FF')
    t.raw(0x1FD09, 0x65, '00 03 00 B6 35 FF FF FF')
    t.raw(0x1F211, 0x41, '00 D4 30 D0 07 00 00 FF')
    t.raw(0x1FD0A, 0x65, '00 64 00 02 76 0F 00 FF')
    p = t.published()
    assert.strictEqual(p[`${M}Fridge_Temperature.temperature`], 278.15)
    assert.deepStrictEqual(t.values('Cabin Temperature'), { temperature: 295.15, relativeHumidity: 0.55 })
    assert.deepStrictEqual(t.values('Fuel Level'), { currentLevel: 0.5, currentVolume: 0.1, capacity: 0.2 })
    assert.deepStrictEqual(t.values('Atmospheric Pressure'), { pressure: 101325 })
    // The Monitoring tab: groups, live or not, instance.
    const l = t.live()
    const row = name => l.items.find(i => i.name === name)
    assert.deepStrictEqual([row('House Battery').group, row('Solar').group, row('Alternator').group, row('AC Input').group, row('Fuel Level').group, row('Fridge Temperature').group, row('Atmospheric Pressure').group, row('Anchor Up').group],
      ['Batteries', 'Solar', 'Alternators', 'AC Power', 'Tanks', 'Temperatures', 'Environment', 'Inputs'])
    assert.strictEqual(row('Solar').live, true)
    assert.deepStrictEqual([row('Engine Room Temperature').live, row('Engine Room Temperature').instance, row('Engine Room Temperature').readings], [false, 2, []])
    assert.strictEqual(row('Fridge Temperature').thirdParty, true)
    assert.deepStrictEqual([row('Atmospheric Pressure').source, row('Fridge Temperature').source], [0, 7], 'the page shows atmospheric pressure in hPa')
    assert.strictEqual(l.trendsEnabled, false)
    assert.strictEqual(l.candump, null, 'not a GX')
    // A circuit's temperature: Fridge and Freezer pair with their senders.
    assert.deepStrictEqual(Object.keys(l.temperatures), ['Fridge'])
    assert.strictEqual(l.temperatures.Fridge.kelvin, 278.15)
    // A reading older than five minutes is no longer the circuit's temperature,
    // and after three minutes the sender is not live; its last value stays,
    // with its age, for the page to show dimmed.
    const realNow = Date.now
    Date.now = () => realNow() + 179e3
    assert.strictEqual(t.item('Fridge Temperature').live, true)
    Date.now = () => realNow() + 181e3
    const fridge = t.item('Fridge Temperature')
    assert.strictEqual(fridge.live, false)
    assert.strictEqual(fridge.readings[0].value, 278.15)
    assert.strictEqual(fridge.readings[0].live, false)
    assert(fridge.readings[0].ageMs >= 181e3 && fridge.readings[0].ageMs < 190e3, String(fridge.readings[0].ageMs))
    assert(t.live().temperatures.Fridge)
    Date.now = () => realNow() + 301e3
    assert.strictEqual(t.live().temperatures.Fridge, undefined)
    Date.now = realNow

    // What Signal K itself sends (the "Signal K to NMEA 2000" plugin): a Ruuvi
    // tag in the freezer, bridged by a Bluetooth plugin.
    t.jsonOut({ pgn: 130312, prio: 2, dst: 255, fields: { Instance: 1, Source: 'Freezer Temperature', 'Actual Temperature': 255.15 } })
    assert.strictEqual(t.published()[`${M}Freezer_Temperature.temperature`], 255.15)
    assert.strictEqual(t.live().temperatures.Freezer.kelvin, 255.15)
    t.plugin.stop()
    assert.deepStrictEqual(t.live().items, [], 'stop clears monitoring')
  }

  // --- Test bench, 1 Oct 2026: real frames. The Cerbo (0x65) sends the
  //     Victron shunt and the Ruuvi tag; the Meter Interface (0x09) the AC.
  //     Trends on: every monitored value is recorded.
  {
    const t = startPlugin('TestBench-2026-10-01.zcf', { trendsEnabled: true })
    t.line('0DF21465 02 2F 05 E7 FF FF FF 00')
    t.line('15FD08E0 00 66 02 4B 73 FF FF FF')
    t.line('15FD0CE0 00 65 01 96 65 04 FF FF')
    // The Meter Interface (module 4) is wired: its meters are read only from
    // its own address, learned from its status message (bench: 0x09).
    t.line('19F30309 08 00 3F 09 FF FF F4 01')
    assert.deepStrictEqual(t.item('Power In').readings, [], 'not before the module\'s address is known')
    t.line('1CFF0409 27 99 04 0E 00 00 00 00')
    t.line('19F30309 08 00 3F 09 FF FF F4 01')
    t.line('19F30009 08 00 00 00 09 00 00 00')
    // Another device on instance 0 is not the Meter Interface.
    t.line('19F303E0 08 00 10 27 FF FF F4 01')
    assert.deepStrictEqual(t.values('Victron Shunt'), { voltage: 13.27, current: -2.5, power: -33.2 })
    assert.deepStrictEqual(t.values('Ruuvi Tag'), { temperature: 295.15 })
    assert.deepStrictEqual(t.values('Victron Temp Sensor'), { temperature: 288.15 })
    assert.deepStrictEqual(t.values('Power In'), { voltage: 236.7, current: 0, power: 9, frequency: 50 })
    // A third-party sender is never a CZone module's broadcast.
    t.line('15FD0809 00 66 02 00 6D FF FF FF')
    assert.deepStrictEqual(t.values('Ruuvi Tag'), { temperature: 295.15 })
    assert.strictEqual(t.live().trendsEnabled, true)
    const trend = t.get('/trend', { path: `${M}Ruuvi_Tag.temperature`, range: '1h' })
    assert.strictEqual(trend.latest && trend.latest.value, 295.15, JSON.stringify(trend))
    assert.strictEqual(t.get('/trend', { path: `${M}Victron_Shunt.power`, range: '1h' }).latest.value, -33.2)
    // Power history before power was recorded: the shunt's volts and amps were
    // already in the trend folder (as an earlier version would have left them).
    {
      const { sanitizePath } = require('../lib/trends/storage')
      const now = Date.now()
      const day = ms => new Date(ms).toISOString().slice(0, 10)
      const write = (series, rows) => {
        const d = path.join(t.trendDir, sanitizePath(series))
        fs.mkdirSync(d, { recursive: true })
        for (const [ts, v] of rows) fs.appendFileSync(path.join(d, `${day(ts)}.csv`), `${ts},${v}\n`)
      }
      const h = now - 3600e3
      write(`${M}Victron_Shunt.voltage`, [[h, 13.2], [h + 600e3, 13.4]])
      write(`${M}Victron_Shunt.current`, [[h + 2000, -5], [h + 600e3 + 2000, 10]])
      const p = t.get('/trend', { path: `${M}Victron_Shunt.power`, range: '24h' })
      assert.deepStrictEqual(p.data.slice(0, 3).map(r => r[1]), [-66, -67, 134], JSON.stringify(p.data))
      assert(p.computedUntil >= h && p.computedUntil < now)
      // Volts and amps themselves are read as before.
      assert.strictEqual(t.get('/trend', { path: `${M}Victron_Shunt.voltage`, range: '24h' }).computedUntil, undefined)
      // Not a DC meter's power: as before.
      assert.strictEqual(t.get('/trend', { path: `${M}Power_In.power`, range: '24h' }).computedUntil, undefined)
    }
    t.plugin.stop()
  }

  // --- Shunt and charger on one battery instance. The Cerbo (0x65) sends the
  //     Victron shunt (instance 2, with a state of charge); a charger (0x20,
  //     a lower address) also sends a battery status on instance 2, and a
  //     127506 without one. The shunt keeps the reading, whichever is first.
  {
    const t = startPlugin('TestBench-2026-10-01.zcf')
    const shunt = () => { t.line('0DF21465 02 2F 05 E7 FF FF FF 00') }
    const charger = () => { t.line('0DF21420 02 64 05 64 00 FF FF 00') } // 13.80 V, +10.0 A
    // The charger is heard first, before anyone has said what it is.
    charger()
    assert.deepStrictEqual(t.values('Victron Shunt'), { voltage: 13.8, current: 10, power: 138 })
    // Both say they are a battery on instance 2; only the shunt has a SoC.
    t.line('0DF21220 40 0B 00 02 00 FF 64 FF'); t.line('0DF21220 41 FF FF FF FF FF FF FF')
    t.line('0DF21265 20 0B 00 02 00 57 64 FF'); t.line('0DF21265 21 FF FF FF FF FF FF FF')
    shunt(); charger()
    assert.deepStrictEqual(t.values('Victron Shunt'), { voltage: 13.27, current: -2.5, power: -33.2, stateOfCharge: 0.87 })
    charger(); charger()
    assert.deepStrictEqual(t.values('Victron Shunt'), { voltage: 13.27, current: -2.5, power: -33.2, stateOfCharge: 0.87 }, 'the charger never takes it back')
    // A device declaring another DC type on the instance is not used either,
    // even with a lower address and a state of charge.
    t.line('0DF21210 40 0B 00 02 01 50 FF FF'); t.line('0DF21210 41 FF FF FF FF FF FF FF')
    t.line('0DF21410 02 70 05 0A 00 FF FF 00')
    assert.strictEqual(t.values('Victron Shunt').voltage, 13.27)
    t.plugin.stop()
  }

  // --- A third-party sender is never read from a CZone module's address,
  //     even when it is the first heard.
  {
    const t = startPlugin('TestBench-2026-10-01.zcf')
    t.line('1CFF0409 27 99 04 0E 00 00 00 00')
    t.line('15FD0809 00 66 02 00 6D FF FF FF')
    assert.deepStrictEqual(t.item('Ruuvi Tag').readings, [])
    t.line('15FD08E0 00 66 02 4B 73 FF FF FF')
    assert.deepStrictEqual(t.values('Ruuvi Tag'), { temperature: 295.15 })
    t.plugin.stop()
  }

  // --- SugarShack: wired tanks (module 0x1A) read only from that module.
  {
    const t = startPlugin('SugarShack-20260927-01.zcf')
    t.line('1CFF1C06 27 99 1A 03 80 00 00 00') // the COI's input message, from 0x06
    t.line('19F21130 12 D4 30 A0 0F 00 00 FF') // instance 2 water, 50 %, but from 0x30
    assert.deepStrictEqual(t.item('Port Water Tank').readings, [])
    t.line('19F21106 12 D4 30 A0 0F 00 00 FF')
    assert.deepStrictEqual(t.values('Port Water Tank'), { currentLevel: 0.5, currentVolume: 0.2, capacity: 0.4 })
    t.plugin.stop()
  }

  // --- On a GX: candump. Its frames are read; while it delivers, Signal K's
  //     copies and what Signal K sends are left alone (they are on the wire
  //     too), so nothing is counted twice or from two places.
  {
    let child
    const spawn = () => {
      child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.pid = 4242; child.kill = () => { child.killed = true }
      setImmediate(() => child.emit('spawn'))
      return child
    }
    const t = startPlugin('TestBench-2026-10-01.zcf', {}, { _czoneSpawn: spawn })
    await wait(5)
    assert.strictEqual(t.live().candump.running, true)
    // Before candump has delivered anything, Signal K's frames are used.
    t.line('15FD08E0 00 66 02 4B 73 FF FF FF')
    assert.deepStrictEqual(t.values('Ruuvi Tag'), { temperature: 295.15 })
    // Bench candump lines from the Cerbo: the Ruuvi tag first. From then on
    // what Signal K sends is on the wire too, and its own copy is not used.
    child.stdout.emit('data', '  vecan0  09FD0C65   [8]  FF 66 02 C4 96 04 FF FF\n')
    t.jsonOut({ pgn: 130312, fields: { Instance: 101, Source: 'Outside Temperature', 'Actual Temperature': 250 } })
    assert.deepStrictEqual(t.item('Victron Temp Sensor').readings, [], 'Signal K output ignored while candump delivers')
    child.stdout.emit('data', '  vecan0  09FD0865   [8]  FF 65 01 AB 74 FF FF FF\n')
    assert.deepStrictEqual(t.values('Victron Temp Sensor'), { temperature: 298.67 })
    // The Ruuvi tag now has two devices on its instance: the first (0xE0)
    // keeps it while it reports.
    assert.deepStrictEqual(t.values('Ruuvi Tag'), { temperature: 295.15 })
    t.line('15FD08E0 00 66 02 00 6D FF FF FF')
    t.jsonOut({ pgn: 130312, fields: { Instance: 101, Source: 'Outside Temperature', 'Actual Temperature': 250 } })
    assert.deepStrictEqual(t.values('Ruuvi Tag'), { temperature: 295.15 }, 'Signal K copy ignored while candump delivers')
    assert.deepStrictEqual(t.values('Victron Temp Sensor'), { temperature: 298.67 }, 'Signal K output ignored while candump delivers')
    t.plugin.stop()
    assert.strictEqual(child.killed, true)
  }

  // --- Monitoring not ticked (the default): meters are still published, but
  //     no senders, no tab data, no circuit temperature, no candump, and what
  //     Signal K sends is not read.
  {
    let spawned = false
    const t = startPlugin('Compass-Rose-03.10.26.zcf', { monitoringEnabled: undefined, victronSwitches: true }, { _czoneSpawn: () => { spawned = true } })
    t.raw(0x1F214, 0x22, '00 28 05 83 FF FF FF 01')
    t.raw(0x1FD08, 0x65, '00 00 07 A7 6C FF FF FF')
    t.jsonOut({ pgn: 130312, fields: { Instance: 1, Source: 'Freezer Temperature', 'Actual Temperature': 255.15 } })
    const p = t.published()
    assert.strictEqual(p[`${M}House_Battery.voltage`], 13.2, 'meters published either way')
    assert.deepStrictEqual(Object.keys(p).filter(k => /Temperature/.test(k)), [])
    assert.deepStrictEqual(t.live(), { enabled: false, file: 'installation.zcf', trendsEnabled: false, candump: null, items: [], temperatures: {} })
    assert.strictEqual(spawned, false)
    for (let i = 0; i < 50 && !objects['/SwitchableOutput/Freezer/Settings/CustomName']; i++) await wait(20)
    t.plugin._switchPane._resync()
    assert.strictEqual(objects['/SwitchableOutput/Freezer/Settings/CustomName'].GetValue()[1], 'Freezer')
    t.plugin.stop()
  }

  // --- Not started where it is not wanted: off in the settings.
  {
    let spawned = false
    const t = startPlugin('TestBench-2026-10-01.zcf', { monitorCandump: false }, { _czoneSpawn: () => { spawned = true } })
    assert.strictEqual(spawned, false)
    assert.strictEqual(t.live().candump, null)
    t.plugin.stop()
  }

  // --- The switch pane label carries the circuit's temperature.
  {
    for (const k of Object.keys(objects)) delete objects[k] // a fresh pane, not the one above
    const t = startPlugin('Compass-Rose-03.10.26.zcf', { victronSwitches: true })
    for (let i = 0; i < 50 && !objects['/SwitchableOutput/Freezer/Settings/CustomName']; i++) await wait(20)
    t.jsonOut({ pgn: 130312, fields: { Instance: 1, Source: 'Freezer Temperature', 'Actual Temperature': 255.15 } })
    t.plugin._switchPane._resync()
    assert.strictEqual(objects['/SwitchableOutput/Freezer/Settings/CustomName'].GetValue()[1], 'Freezer (-18.0 °C)')
    assert.strictEqual(objects['/SwitchableOutput/Fresh_Water_Pump/Settings/CustomName'].GetValue()[1], 'Fresh Water Pump')
    t.plugin.stop()
  }

  console.log('Monitoring plugin tests passed')
})().catch(err => { console.error(err); process.exit(1) })
