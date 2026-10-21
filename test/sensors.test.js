'use strict'

// Tank, temperature, humidity and pressure senders (lib/sensors.js) and the
// candump reader (lib/candump.js), with frames recorded on the test bench.

const assert = require('assert')
const path = require('path')
const { EventEmitter } = require('events')
const zcf = require('../lib/zcf')
const sensors = require('../lib/sensors')
const { createCandump, parseCandumpLine, FILTERS } = require('../lib/candump')

const fixture = name => path.join(__dirname, 'fixtures', name)
const hex = s => Buffer.from(s.replace(/\s+/g, ''), 'hex')
const decode = (pgn, bytes) => sensors.decodeSensorFrame(pgn, hex(bytes))
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

// --- Decoding ---------------------------------------------------------------

// Bench, 1 Oct 2026: a Ruuvi tag (instance 102, Inside) and a Victron
// temperature sensor (101, Outside), sent by the Cerbo.
assert.deepStrictEqual(decode(130312, '00 66 02 4B 73 FF FF FF'), [{ kind: 'temperature', instance: 102, source: 2, field: 'temperature', value: 295.15 }])
assert.deepStrictEqual(decode(130316, '00 65 01 96 65 04 FF FF'), [{ kind: 'temperature', instance: 101, source: 1, field: 'temperature', value: 288.15 }])
// Humidity 55 % (13750 x 0.004), pressure 1013.25 hPa, tank 50 % of 200 L.
close(decode(130313, '00 03 00 B6 35 FF FF FF')[0].value, 0.55)
assert.deepStrictEqual(decode(130314, '00 64 00 02 76 0F 00 FF'), [{ kind: 'pressure', instance: 100, source: 0, field: 'pressure', value: 101325 }])
const tank = decode(127505, '21 D4 30 D0 07 00 00 FF')
assert.deepStrictEqual(tank.map(r => [r.instance, r.source, r.field]), [[1, 2, 'currentLevel'], [1, 2, 'capacity'], [1, 2, 'currentVolume']])
close(tank[0].value, 0.5); close(tank[1].value, 0.2); close(tank[2].value, 0.1)
// "No data" values are not readings.
assert.deepStrictEqual(decode(130312, '00 66 02 FF FF FF FF FF'), [])
assert.deepStrictEqual(decode(130312, '00 66 02 FE FF FF FF FF'), [], 'out of range')
assert.deepStrictEqual(decode(127505, '21 FF 7F FF FF FF FF FF'), [])
assert.deepStrictEqual(decode(127505, '21 D4 30 FF FF FF FF FF').length, 1, 'level without a capacity')
assert.deepStrictEqual(decode(130312, '00 66'), [], 'short frame')
assert.deepStrictEqual(decode(127508, '00 28 05 83 FF FF FF 01'), [], 'not a sender PGN')

// What the "Signal K to NMEA 2000" plugin (2.24.0) hands Signal K to send.
const json = m => sensors.decodeSensorJson(m)
assert.deepStrictEqual(json({ pgn: 130312, prio: 2, dst: 255, fields: { Instance: 102, Source: 'Inside Temperature', 'Actual Temperature': 295.15 } }),
  [{ kind: 'temperature', instance: 102, source: 2, field: 'temperature', value: 295.15 }])
assert.strictEqual(json({ pgn: 130316, fields: { Instance: 1, Source: 'Freezer Temperature', Temperature: 255.15 } })[0].source, 13)
assert.strictEqual(json({ pgn: 130312, fields: { instance: 0, source: 'Refridgeration Temperature', actualTemperature: 278 } })[0].source, 7, 'canboatjs spelling, new field names')
assert.strictEqual(json({ pgn: 130312, fields: { Instance: 4, Source: 4, 'Actual Temperature': 290 } })[0].source, 4, 'source as a number')
close(json({ pgn: 130313, Instance: 100, Source: 'Outside', 'Actual Humidity': 0.5 })[0].value, 0.5) // flat, as the plugin builds it
close(json({ pgn: 130313, fields: { Instance: 100, Source: 'Inside', 'Actual Humidity': 62 } })[0].value, 0.62)
assert.deepStrictEqual(json({ pgn: 130314, fields: { Instance: 0, Source: 'Atmospheric', Pressure: 101300 } }), [{ kind: 'pressure', instance: 0, source: 0, field: 'pressure', value: 101300 }])
const jsonTank = json({ pgn: 127505, fields: { Instance: 0, Type: 'Fuel', Level: 40, Capacity: 300 } })
assert.deepStrictEqual(jsonTank.map(r => [r.field, Math.round(r.value * 1000) / 1000]), [['currentLevel', 0.4], ['capacity', 0.3], ['currentVolume', 0.12]])
assert.deepStrictEqual(json({ pgn: 130312, fields: { Instance: 1, Source: 'Somewhere', 'Actual Temperature': 290 } }), [], 'unknown source')
assert.deepStrictEqual(json({ pgn: 127508, fields: { Instance: 0 } }), [])
assert.deepStrictEqual(json(null), [])

// --- Senders from the ZCF ---------------------------------------------------

// Compass Rose, 3 Oct 2026: four temperatures, a tank and a pressure, all
// third-party (the temperatures are Ruuvi tags bridged by the Cerbo).
const compass = zcf.load(fixture('Compass-Rose-03.10.26.zcf'))
const list = sensors.senders(compass, new Set(['Solar']))
assert.deepStrictEqual(list.map(s => [s.name, s.kind, s.instance, s.source, s.thirdParty]), [
  ['Fridge Temperature', 'temperature', 0, 7, true],
  ['Freezer Temperature', 'temperature', 1, 13, true],
  ['Engine Room Temperature', 'temperature', 2, 3, true],
  ['Cabin Temperature', 'temperature', 3, 4, true],
  ['Fuel Level', 'tank', 0, 0, true],
  ['Atmospheric Pressure', 'pressure', 100, 0, true]
])
assert.strictEqual(list[0].signalK.temperature, 'electrical.czone.monitoring.Fridge_Temperature.temperature')
assert.strictEqual(list[0].signalK.relativeHumidity, 'electrical.czone.monitoring.Fridge_Temperature.relativeHumidity')
assert.strictEqual(list[4].signalK.currentLevel, 'electrical.czone.monitoring.Fuel_Level.currentLevel')
// A slug already taken by a meter is not reused.
assert.strictEqual(sensors.senders({ signalInputs: { inputs: [{ type: 'pressure', name: 'Solar', a: 0, b: 1, module: 0 }] } }, new Set(['Solar']))[0].slug, 'Solar2')
// Wired tanks take their capacity from the tank table (SugarShack: 400 L each).
const sugar = sensors.senders(zcf.load(fixture('SugarShack-20260927-01.zcf')))
assert.deepStrictEqual(sugar.map(s => [s.name, s.instance, s.source, s.module, s.capacity]), [
  ['Port Water Tank', 2, 1, 26, 0.4], ['Stbd Water Tank', 3, 1, 26, 0.4], ['Port Fuel Tank', 0, 0, 28, 0.4], ['Stbd Fuel Tank', 1, 0, 28, 0.4]])
// Switches and analog inputs are not senders.
assert.deepStrictEqual(sensors.senders(zcf.load(fixture('TestBench.zcf'))), [])
assert.deepStrictEqual(sensors.senders({}), [])

// --- Matching ---------------------------------------------------------------

{
  const rt = sensors.createSensorRuntime(list)
  const t0 = 1e12
  // Fridge: Refrigeration (7), instance 0.
  const fridge = rt.accept(decode(130312, '00 00 07 A7 6C FF FF FF'), 'n2k:101', t0)
  assert.deepStrictEqual(fridge.map(r => [r.sender.name, r.path, r.value]), [['Fridge Temperature', 'electrical.czone.monitoring.Fridge_Temperature.temperature', 278.15]])
  // Same instance, another source: not the fridge.
  assert.deepStrictEqual(rt.accept(decode(130312, '00 00 02 A7 6C FF FF FF'), 'n2k:101', t0), [])
  // Humidity on the cabin's instance goes with the cabin temperature.
  assert.deepStrictEqual(rt.accept(decode(130313, '00 03 00 B6 35 FF FF FF'), 'n2k:101', t0).map(r => r.path), ['electrical.czone.monitoring.Cabin_Temperature.relativeHumidity'])
  // One device per sender: a second device on the fridge's instance is
  // ignored while the first reports, and takes over once it has been quiet.
  assert.deepStrictEqual(rt.accept(decode(130312, '00 00 07 00 6D FF FF FF'), 'n2k:7', t0 + 1000), [])
  assert.strictEqual(rt.accept(decode(130312, '00 00 07 A8 6C FF FF FF'), 'n2k:101', t0 + 2000).length, 1)
  assert.strictEqual(rt.accept(decode(130312, '00 00 07 00 6D FF FF FF'), 'n2k:7', t0 + 2000 + sensors.QUIET_MS).length, 1)
  assert.deepStrictEqual(rt.accept(decode(130312, '00 00 07 A8 6C FF FF FF'), 'n2k:101', t0 + 3000 + sensors.QUIET_MS), [])
  // The temperature and humidity of one sender are owned separately.
  assert.strictEqual(rt.accept(decode(130313, '00 00 00 B6 35 FF FF FF'), 'n2k:101', t0 + 3000 + sensors.QUIET_MS).length, 1)
}

// --- A circuit's temperature --------------------------------------------------

{
  const pairs = sensors.circuitTemperatures(compass.circuits, list)
  assert.deepStrictEqual([...pairs].map(([slug, s]) => [slug, s.name]).sort(), [['Freezer', 'Freezer Temperature'], ['Fridge', 'Fridge Temperature']])
  const twice = [{ kind: 'temperature', name: 'Freezer Temp' }, { kind: 'temperature', name: 'FREEZER temperature' }]
  assert.strictEqual(sensors.circuitTemperatures([{ name: 'Freezer', slug: 'Freezer' }], twice).size, 0, 'a shared name pairs with nothing')
  assert.strictEqual(sensors.pairName('Freezer Temp.'), 'freezer')
  assert.strictEqual(sensors.circuitTemperatures([{ name: 'Fresh Water Pump', slug: 'P' }], list).size, 0)
}

// --- Which device (lib/sources) ---------------------------------------------

{
  const { createSourcePicker } = require('../lib/sources')
  const pick = createSourcePicker()
  const t0 = 1e12
  const battery = { key: 'meter:House', module: 0, instance: 0, dcType: 'battery' }
  // Two devices that both report a state of charge: the lower address, so the
  // choice does not depend on which is heard first (or on a restart).
  pick.noteDcDetailed(0, 0x40, 0, true, t0)
  pick.noteDcDetailed(0, 0x30, 0, true, t0)
  assert.strictEqual(pick.allowed(battery, 0x40, t0), false)
  assert.strictEqual(pick.allowed(battery, 0x30, t0), true)
  // Declarations go stale after the quiet time; then the first heard keeps it.
  assert.strictEqual(pick.allowed(battery, 0x40, t0 + 121e3), true)
  assert.strictEqual(pick.allowed(battery, 0x30, t0 + 122e3), false)
  // Wired: only the module's learned address; nothing until it is learned.
  const wired = { key: 'meter:MI', module: 4, instance: 0 }
  assert.strictEqual(pick.allowed(wired, 9, t0), false)
  pick.learn({ pgn: 65284, source: 9, data: hex('27 99 04 0E 00 00 00 00') })
  assert.strictEqual(pick.allowed(wired, 9, t0), true)
  assert.strictEqual(pick.allowed(wired, 0xE0, t0), false)
  pick.learn({ pgn: 65284, source: 7, data: hex('26 99 05 0E 00 00 00 00') }) // not a CZone status
  assert.strictEqual(pick.isCzone(7), false)
  // Signal K's own output counts as a third-party device.
  assert.strictEqual(pick.allowed({ key: 'cabin', module: 0, instance: 3 }, 'signalk', t0), true)
}

// --- candump ------------------------------------------------------------------

assert.strictEqual(parseCandumpLine('  vecan0  09FD0C65   [8]  FF 66 02 C4 96 04 FF FF'), '0 R 09FD0C65 FF 66 02 C4 96 04 FF FF')
assert.strictEqual(parseCandumpLine('garbage'), null)
for (const f of ['01FD0800:01FFFF00', '01FD0900:01FFFF00', '01FD0A00:01FFFF00', '01FD0C00:01FFFF00', '01F21100:01FFFF00', '01F21200:01FFFF00', '01F21400:01FFFF00', '01F20F00:01FFFF00', '01F21000:01FFFF00', '01F30000:01FFFF00', '01F30300:01FFFF00']) {
  assert(FILTERS.includes(f), f)
}

{
  const spawned = []
  const fakeSpawn = (cmd, args) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.pid = 4242; child.killed = false; child.kill = () => { child.killed = true }
    spawned.push({ cmd, args, child })
    return child
  }
  const lines = []
  const reader = createCandump({ device: 'vecan0', onLine: l => lines.push(l), spawnFn: fakeSpawn })
  assert.strictEqual(reader.delivering(), false)
  reader.start()
  const { cmd, args, child } = spawned[0]
  assert.strictEqual(cmd, 'candump')
  assert(args[0].startsWith('vecan0,01FD0800:01FFFF00,'))
  child.emit('spawn')
  assert.strictEqual(reader.delivering(), false, 'running but nothing seen yet')
  // Bench lines, split across chunks as a pipe delivers them.
  child.stdout.emit('data', '  vecan0  09FD0C65   [8]  FF 66 02 C4 96 04 FF FF\n  vecan0  09FD08')
  child.stdout.emit('data', '65   [8]  FF 65 01 AB 74 FF FF FF\nnoise\n')
  assert.deepStrictEqual(lines, ['0 R 09FD0C65 FF 66 02 C4 96 04 FF FF', '0 R 09FD0865 FF 65 01 AB 74 FF FF FF'])
  assert.strictEqual(reader.delivering(), true)
  assert.strictEqual(reader.delivering(Date.now() + 61e3), false, 'quiet for a minute')
  assert.strictEqual(reader.status().lines, 2)
  reader.stop()
  assert.strictEqual(child.killed, true)
  assert.strictEqual(reader.delivering(), false)
  // No candump: says so and does not retry.
  const missing = createCandump({ onLine: () => {}, spawnFn: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.pid = 0; setImmediate(() => c.emit('error', Object.assign(new Error('spawn candump ENOENT'), { code: 'ENOENT' }))); return c } })
  missing.start()
  setImmediate(() => {
    assert.strictEqual(missing.status().error, 'candump not installed')
    missing.stop()
    console.log('Sensor and candump tests passed')
  })
}
