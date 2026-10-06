'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { findStorageMount, createTrendStore, bucketize, sanitizePath, HEARTBEAT_MS, BUCKET_MS } = require('../lib/trends/storage')
const { createTrends, validSeries, SAMPLE_MS, STALE_MS } = require('../lib/trends')
const pluginFactory = require('../index')

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const csv = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(l => l.split(',').map(Number))

// ============================ storage ==========================================

// --- Card detection: a Cerbo GX mount table. The eMMC is mmcblk1; the SD card
//     is mmcblk0p1 on /run/media/mmcblk0p1. System mounts are never used.
{
  const card = tmp('mnt-')
  const cerbo = [
    '/dev/mmcblk1p2 / ext4 rw 0 0',
    '/dev/mmcblk1p5 /data ext4 rw 0 0',
    `/dev/mmcblk0p1 ${card} vfat rw 0 0`
  ].join('\n')
  assert.strictEqual(findStorageMount(cerbo), card)
  assert.strictEqual(findStorageMount('/dev/mmcblk1p2 / ext4 rw 0 0\n/dev/mmcblk1p5 /data ext4 rw 0 0'), null)
  assert.strictEqual(findStorageMount(''), null)
}

// --- Batched write, read back, samples not yet written are visible.
{
  const dir = tmp('trend-')
  const store = createTrendStore({ directory: dir })
  const now = Math.floor(Date.now() / 600e3) * 600e3 + 300e3 // mid-bucket, so the three samples share one
  const series = 'electrical.czone.Freezer.current'
  store.record(series, 2.9, now - 120e3)
  store.record(series, 3.1, now - 60e3)
  store.record(series, 'n/a', now)
  store.record(series, NaN, now)
  assert.strictEqual(store.flush().written, 2)
  store.record(series, 3.0, now) // not flushed yet
  const r = store.read(series, '1h', now)
  assert.strictEqual(r.tier, 'raw')
  assert.deepStrictEqual(r.data.map(d => d[1]), [2.9, 3.1, 3.0])
  // One folder per series, one file per day: "timestamp_ms,value".
  const file = path.join(dir, sanitizePath(series), `${new Date(now - 60e3).toISOString().slice(0, 10)}.csv`)
  assert(fs.readFileSync(file, 'utf8').startsWith(`${now - 120e3},2.9\n`))
  // Nothing is deleted by age unless asked for.
  const oldDir = path.join(dir, 'electrical.czone.Old.current')
  fs.mkdirSync(path.join(oldDir, 'summary'), { recursive: true })
  fs.writeFileSync(path.join(oldDir, '2020-01-01.csv'), '1,0.5\n')
  fs.writeFileSync(path.join(oldDir, 'summary', '2020-01.csv'), '0,0.5,0.5,0.5\n')
  assert.strictEqual(store.purge(now), 0)
  assert(fs.existsSync(path.join(oldDir, '2020-01-01.csv')))
  // With a limit: old full detail goes, the summary stays.
  const limited = createTrendStore({ directory: dir, retentionDays: 31 })
  assert.strictEqual(limited.purge(now), 1)
  assert(!fs.existsSync(path.join(oldDir, '2020-01-01.csv')))
  assert(fs.existsSync(path.join(oldDir, 'summary', '2020-01.csv')))
}

// --- Write on change: an unchanged value is stored at the start, just before
//     a change, and every 10 minutes; every sample still feeds the summary.
{
  const dir = tmp('trend-')
  const store = createTrendStore({ directory: dir })
  const t0 = Date.UTC(2026, 8, 1, 12, 0, 0)
  // One hour at 10 s: constant 3.0 A, except one sample of 14 at 30 minutes.
  for (let i = 0; i < 360; i++) store.record('v', i === 180 ? 14 : 3, t0 + i * 10e3)
  store.close()
  const raw = csv(path.join(dir, 'v', '2026-09-01.csv'))
  assert(raw.length <= 12, `write-on-change stored ${raw.length} rows for 360 samples`)
  assert.deepStrictEqual(raw[0], [t0, 3])
  // The step keeps its shape: last 3 before, the 14, the 3 after.
  const at = raw.findIndex(r => r[1] === 14)
  assert.deepStrictEqual([raw[at - 1], raw[at], raw[at + 1]], [[t0 + 179 * 10e3, 3], [t0 + 180 * 10e3, 14], [t0 + 181 * 10e3, 3]])
  // Unchanged stretches are never more than the heartbeat apart.
  for (let i = 1; i < raw.length; i++) assert(raw[i][0] - raw[i - 1][0] <= HEARTBEAT_MS)
  // The last sample is stored on close.
  assert.deepStrictEqual(raw[raw.length - 1], [t0 + 359 * 10e3, 3])
  // Summary: six 10-minute buckets, "bucket,min,avg,max" from all 60 samples each.
  const sum = csv(path.join(dir, 'v', 'summary', '2026-09.csv'))
  assert.strictEqual(sum.length, 6)
  assert.deepStrictEqual(sum[0], [t0, 3, 3, 3])
  assert.deepStrictEqual(sum[3], [t0 + 3 * BUCKET_MS, 3, 3.183, 14])
  // Long ranges read the summaries as [t, avg, min, max]; short ranges full detail.
  const now = t0 + 3600e3
  const week = store.read('v', '7d', now)
  assert.strictEqual(week.tier, 'summary')
  assert.deepStrictEqual(week.data[3], [t0 + 3 * BUCKET_MS, 3.183, 3, 14])
  assert.strictEqual(store.read('v', '24h', now).tier, 'raw')
  assert(week.gapMs >= BUCKET_MS)
  // An unknown range means 24 h.
  assert.strictEqual(store.read('v', 'forever', now).range, '24h')
}

// --- Custom period: any from/to; full detail up to 48 h, summaries beyond,
//     and summaries for an old period whose full detail has been removed.
{
  const dir = tmp('trend-')
  const store = createTrendStore({ directory: dir })
  const t0 = Date.UTC(2026, 7, 1)
  for (let t = t0; t < t0 + 10 * 86400e3; t += 300e3) store.record('v', (t - t0) / 86400e3, t) // value = days since t0
  store.close()
  const now = t0 + 30 * 86400e3
  const day3 = store.read('v', { from: t0 + 3 * 86400e3, to: t0 + 4 * 86400e3 }, now)
  assert.strictEqual(day3.tier, 'raw')
  assert.strictEqual(day3.range, 'custom')
  assert.deepStrictEqual([day3.start, day3.end], [t0 + 3 * 86400e3, t0 + 4 * 86400e3])
  assert(day3.data.length > 100 && day3.data.every(r => r[0] >= day3.start && r[0] <= day3.end && r[1] >= 3 && r[1] <= 4))
  const week = store.read('v', { from: t0 + 2 * 86400e3, to: t0 + 9 * 86400e3 }, now)
  assert.strictEqual(week.tier, 'summary')
  assert(week.data.every(r => r[0] >= week.start && r[0] <= week.end && r[2] >= 2 && r[3] <= 9.01))
  assert.strictEqual(store.read('v', { from: t0 + 20 * 86400e3, to: t0 + 21 * 86400e3 }, now).data.length, 0) // nothing recorded then
  assert.strictEqual(store.read('v', { from: t0 + 2, to: t0 + 1 }, now).error, 'bad_range')
  assert.strictEqual(store.read('v', { from: 'x', to: t0 }, now).error, 'bad_range')
  // Full detail for day 3 removed (space guard): the same period still charts from summaries.
  fs.unlinkSync(path.join(dir, 'v', '2026-08-04.csv'))
  const again = store.read('v', { from: t0 + 3 * 86400e3, to: t0 + 4 * 86400e3 }, now)
  assert.strictEqual(again.tier, 'summary')
  assert(again.data.length >= 140)
}

// --- A year of summaries comes back as a few hundred points with the extremes kept.
{
  const dir = tmp('trend-')
  const store = createTrendStore({ directory: dir })
  const now = Date.UTC(2026, 8, 1)
  for (let t = now - 60 * 86400e3; t < now; t += 600e3) store.record('v', t === now - 30 * 86400e3 ? 99 : 12, t)
  store.close()
  const r = store.read('v', '1y', now)
  assert.strictEqual(r.tier, 'summary')
  assert(r.points <= 400 && r.points > 20)
  assert.strictEqual(Math.max(...r.data.map(d => d[3])), 99)
}

// --- A restart in the middle of a ten-minute bucket leaves two summary rows
//     for it; they are read back as one.
{
  const dir = tmp('trend-')
  const t0 = Date.UTC(2026, 8, 1, 12)
  const first = createTrendStore({ directory: dir })
  first.record('v', 2, t0 + 60e3)
  first.close()
  const second = createTrendStore({ directory: dir })
  second.record('v', 6, t0 + 300e3)
  second.close()
  assert.strictEqual(csv(path.join(dir, 'v', 'summary', '2026-09.csv')).length, 2)
  const r = second.read('v', { from: t0 - 5 * 86400e3, to: t0 + 86400e3 }, t0 + 86400e3)
  assert.strictEqual(r.tier, 'raw') // too little summarised yet: full detail is used
  const s = second.read('v', '90d', t0 + 86400e3)
  assert.deepStrictEqual(s.data.filter(d => d[0] === t0), [[t0, 4, 2, 6]])
}

// --- Space guard: when the volume is low, oldest full-detail days go first,
//     summaries only when no old full detail is left; today's data is kept.
{
  const dir = tmp('trend-')
  const now = Date.UTC(2026, 8, 10, 12)
  const s = path.join(dir, 'v')
  fs.mkdirSync(path.join(s, 'summary'), { recursive: true })
  for (const day of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']) fs.writeFileSync(path.join(s, `${day}.csv`), '1,1\n')
  for (const month of ['2026-07', '2026-08', '2026-09']) fs.writeFileSync(path.join(s, 'summary', `${month}.csv`), '1,1,1,1\n')
  const total = 16e9
  let free = 0
  const files = () => fs.readdirSync(s).filter(f => f.endsWith('.csv')).concat(fs.readdirSync(path.join(s, 'summary')).map(f => `summary/${f}`)).sort()
  // Each deleted file "frees" 100 MB; the shared-disk reserve is 10% = 1.6 GB.
  const store = createTrendStore({ directory: dir, spaceProvider: () => ({ free: free + (7 - files().length) * 100e6, total }) })
  free = 1.7e9
  assert.strictEqual(store.purge(now), 0) // enough room: nothing touched
  free = 1.45e9 // 150 MB short: two oldest days
  assert.strictEqual(store.purge(now), 2)
  assert.deepStrictEqual(files(), ['2026-09-09.csv', '2026-09-10.csv', 'summary/2026-07.csv', 'summary/2026-08.csv', 'summary/2026-09.csv'])
  free = 1.2e9 // still short after all old full detail: one summary month too
  store.purge(now)
  assert.deepStrictEqual(files(), ['2026-09-10.csv', 'summary/2026-08.csv', 'summary/2026-09.csv'])
  free = 0 // hopeless: current day and month still survive
  store.purge(now)
  assert.deepStrictEqual(files(), ['2026-09-10.csv', 'summary/2026-09.csv'])
}

// --- Storage by platform: off a GX, trends default to the plugin data folder;
//     on a GX internal flash is never used, card or no card.
{
  const data = tmp('skdata-')
  const noCard = () => '/dev/mmcblk1p2 / ext4 rw 0 0\n/dev/mmcblk1p5 /data ext4 rw 0 0'
  const pi = createTrendStore({ fallbackDir: data, isVenus: false, mountsProvider: noCard })
  pi.record('x', 1)
  assert.strictEqual(pi.flush().written, 1)
  assert.strictEqual(pi.status().location, 'data_dir')
  assert(fs.existsSync(path.join(data, 'trends', 'x')))

  const gxData = tmp('gxdata-')
  const gx = createTrendStore({ fallbackDir: gxData, isVenus: true, mountsProvider: noCard })
  assert.strictEqual(gx.status().available, false)
  assert.strictEqual(gx.status().reason, 'no_sd_card')
  for (let i = 0; i < 100; i++) gx.record('x', i, 1e12 + i * 10e3)
  assert.strictEqual(gx.status().pendingPaths, 1)
  const f = gx.flush()
  assert.deepStrictEqual([f.available, f.reason, f.written], [false, 'no_sd_card', 0])
  assert.strictEqual(gx.status().pendingPaths, 0) // nothing piles up in memory
  assert.strictEqual(gx.read('x').available, false)
  assert.deepStrictEqual(fs.readdirSync(gxData), []) // internal flash untouched

  // With a card: <card>/signalk-czone/trends, and the card may run nearly full.
  const card = tmp('card-')
  const withCard = createTrendStore({ fallbackDir: gxData, isVenus: true, mountsProvider: () => `${noCard()}\n/dev/mmcblk0p1 ${card} vfat rw 0 0` })
  assert.deepStrictEqual([withCard.status().available, withCard.status().location, withCard.status().dir], [true, 'removable', path.join(card, 'signalk-czone', 'trends')])
  withCard.record('x', 1)
  assert.strictEqual(withCard.flush().written, 1)
  assert.deepStrictEqual(fs.readdirSync(gxData), [])

  // A folder that cannot be written is reported, not thrown.
  const blocked = path.join(tmp('blocked-'), 'file')
  fs.writeFileSync(blocked, 'x')
  const bad = createTrendStore({ directory: path.join(blocked, 'trends') })
  assert.deepStrictEqual([bad.status().available, bad.status().reason], [false, 'write_failed'])
}

// --- Bucketing keeps long ranges to a few hundred points.
{
  const data = Array.from({ length: 2880 }, (_, i) => [i * 30e3, i])
  const b = bucketize(data, 0, 2880 * 30e3)
  assert(b.data.length <= 400)
  assert.deepStrictEqual(b.data[0].slice(1), [3.5, 0, 7]) // avg, min, max of the first 8 samples
}

// ============================ recorder =========================================

// --- Series names become folder names: plain Signal K paths only.
{
  assert.strictEqual(validSeries('electrical.czone.Galley_Lights.current'), true)
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.hidden', 'a..b', 'a b', 'x'.repeat(201), null, undefined]) assert.strictEqual(validSeries(bad), false, String(bad))
}

// --- The latest value of each series is stored on the sample beat; a series
//     that has gone quiet is dropped; stop() stores what is in hand.
{
  const dir = tmp('rec-')
  const t = createTrends({ directory: dir })
  const t0 = Date.UTC(2026, 8, 1, 12)
  assert.strictEqual(t.status().available, true)
  assert.deepStrictEqual([t.status().enabled, t.status().sampleSeconds, t.status().trending], [true, SAMPLE_MS / 1000, 0])

  // CZone repeats itself many times between two samples: one row per beat.
  for (let i = 0; i < 50; i++) t.observe('a', 1 + i / 100, t0 + i * 100)
  t.observe('b', 7, t0)
  t.observe('c', 'x', t0); t.observe('c', Infinity, t0) // not numbers: ignored
  assert.strictEqual(t.status().trending, 2)
  assert.strictEqual(t.sample(t0 + 5000), 2)
  t.observe('a', 2, t0 + 14e3)
  assert.strictEqual(t.sample(t0 + 15e3), 2)
  // "b" is not heard again: after STALE_MS it is no longer recorded.
  t.observe('a', 2.5, t0 + STALE_MS + 4e3)
  assert.strictEqual(t.sample(t0 + STALE_MS + 5e3), 1)
  assert.strictEqual(t.status().trending, 1)
  t.flush()
  assert.deepStrictEqual(csv(path.join(dir, 'a', '2026-09-01.csv')), [[t0 + 5000, 1.49], [t0 + 15e3, 2], [t0 + STALE_MS + 5e3, 2.5]])
  assert.deepStrictEqual(csv(path.join(dir, 'b', '2026-09-01.csv')), [[t0 + 5000, 7]])

  assert.deepStrictEqual(t.read('a', { from: t0, to: t0 + 3600e3 }).data.map(r => r[1]), [1.49, 2, 2.5])
  // A live series reports its latest value beside the rows; a quiet one does not.
  assert.strictEqual(t.read('a').latest, undefined) // last heard in 2026: not live now
  t.observe('live', 9.9)
  assert.deepStrictEqual([t.read('live').latest.value, t.read('live', '1y').latest.value], [9.9, 9.9])
  assert.strictEqual(t.read('b').latest, undefined)
  assert.strictEqual(t.read('../a').error, 'bad_path')
  assert.strictEqual(t.read('a', 'nonsense').range, '24h')
  t.stop()
  assert.strictEqual(t.status().trending, 0)
}

// --- stop() takes a last sample and closes the open summaries.
{
  const dir = tmp('rec-')
  const t = createTrends({ directory: dir })
  t.start()
  t.start() // twice is harmless
  t.observe('a', 4.2)
  t.stop()
  const day = new Date().toISOString().slice(0, 10)
  assert.deepStrictEqual(csv(path.join(dir, 'a', `${day}.csv`)).map(r => r[1]), [4.2])
  assert.deepStrictEqual(csv(path.join(dir, 'a', 'summary', `${day.slice(0, 7)}.csv`)).map(r => r.slice(1)), [[4.2, 4.2, 4.2]])
}

// --- Switched off: nothing is kept, nothing is written, and it says why.
{
  const dir = tmp('rec-')
  const t = createTrends({ enabled: false, directory: dir })
  t.start()
  t.observe('a', 1)
  assert.strictEqual(t.sample(), 0)
  t.stop()
  assert.deepStrictEqual(fs.readdirSync(dir), [])
  assert.deepStrictEqual([t.status().available, t.status().reason, t.status().enabled], [false, 'disabled', false])
  assert.deepStrictEqual([t.read('a').available, t.read('a').data], [false, []])
}

// ============================ the plugin ======================================
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
  const configPath = tmp('signalk-czone-trends-')
  const dir = path.join(configPath, 'plugin-config-data', 'signalk-czone')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'installation.zcf'), zcfBuffer)
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
    setPluginStatus: () => {}
  }
  const plugin = pluginFactory(app)
  const routes = new Map()
  plugin.registerWithRouter({ get: (p, fn) => routes.set(p, fn), post: () => {} })
  const get = (route, query = {}) => {
    const out = { status: 200, body: undefined }
    const res = { status (code) { out.status = code; return res }, json (value) { out.body = value; return res } }
    routes.get(route)({ params: {}, query }, res)
    return out
  }
  const frame = line => listeners.get('canboatjs:rawoutput')(line)
  return { plugin, get, frame, deltas, dataDir: dir }
}

// A PGN 130822 current/level table for one module page, as Fast Packet frames
// (CAN ID 1DFF06xx: the data-page bit is part of the PGN).
function dcFrames (module, page, slots, sequence) {
  const payload = Buffer.alloc(28)
  payload[0] = 0x27; payload[1] = 0x99; payload[2] = module; payload[3] = page
  for (const [slot, currentRaw] of slots) { payload[4 + slot * 3] = currentRaw; payload[5 + slot * 3] = 0xe8; payload[6 + slot * 3] = 0x07 }
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ')
  const frames = [`2026-09-27T06:00:00.000Z R 1DFF0629 ${hex([(sequence << 5) | 0, payload.length])} ${hex(payload.subarray(0, 6))}`]
  for (let offset = 6, n = 1; offset < payload.length; offset += 7, n++) frames.push(`2026-09-27T06:00:00.000Z R 1DFF0629 ${hex([(sequence << 5) | n])} ${hex(payload.subarray(offset, offset + 7))}`)
  return frames
}

async function main () {
  const zcf = await fixture()
  const galleyPath = 'electrical.czone.Galley_Lights.current'
  const pianoPath = 'electrical.czone.Piano_Light.current'
  const day = new Date().toISOString().slice(0, 10)

  // Default settings, not a GX: trends go to the plugin data folder.
  const p = makePlugin(zcf)
  p.plugin.start({})
  const trendDir = path.join(p.dataDir, 'trends')
  let status = p.get('/trend/status').body
  assert.deepStrictEqual([status.available, status.enabled, status.location, status.dir, status.trending], [true, true, 'data_dir', trendDir, 0])

  // Galley Lights is module 20, page 0, slot 1; Piano Light module 18, page 0,
  // slot 4. The table is repeated, as CZone does; the last value is 6.2 A.
  let sequence = 0
  for (const raw of [60, 61, 62]) for (const f of dcFrames(20, 0, [[1, raw]], sequence++ % 8)) p.frame(f)
  for (const f of dcFrames(18, 0, [[4, 3]], sequence++ % 8)) p.frame(f)
  const published = p.deltas.flatMap(d => d.updates[0].values).filter(v => v.path === galleyPath).map(v => v.value)
  assert.deepStrictEqual(published, [6, 6.1, 6.2]) // every packet is still published
  assert(p.get('/trend/status').body.trending >= 2)

  // Nothing is on disk before the first sample; stopping stores what is in hand.
  assert.strictEqual(fs.existsSync(path.join(trendDir, galleyPath)), false)
  assert.strictEqual(p.get('/trend').status, 400)
  assert.strictEqual(p.get('/trend', { path: '../../etc/passwd' }).body.error, 'bad_path')
  p.plugin.stop()
  assert.deepStrictEqual(csv(path.join(trendDir, galleyPath, `${day}.csv`)).map(r => r[1]), [6.2])
  assert.deepStrictEqual(csv(path.join(trendDir, pianoPath, `${day}.csv`)).map(r => r[1]), [0.3])
  assert.strictEqual(p.get('/trend/status').body.reason, 'not_started')
  assert.strictEqual(p.get('/trend', { path: galleyPath }).body.available, false)

  // After a restart the history is there, by range and by custom period.
  p.plugin.start({})
  let read = p.get('/trend', { path: galleyPath, range: '1h' }).body
  assert.deepStrictEqual([read.available, read.tier, read.range, read.data.map(r => r[1])], [true, 'raw', '1h', [6.2]])
  assert.strictEqual(read.latest, undefined) // nothing heard since the restart
  for (const f of dcFrames(20, 0, [[1, 70]], 1)) p.frame(f)
  assert.strictEqual(p.get('/trend', { path: galleyPath, range: '7d' }).body.latest.value, 7)
  read = p.get('/trend', { path: galleyPath, from: String(Date.now() - 3600e3), to: String(Date.now() + 60e3) }).body
  assert.deepStrictEqual([read.range, read.data.length], ['custom', 1])
  assert.strictEqual(p.get('/trend', { path: galleyPath, from: '5', to: '4' }).body.error, 'bad_range')
  assert.deepStrictEqual(p.get('/trend', { path: 'electrical.czone.Nothing.current' }).body.data, [])
  p.plugin.stop()

  // A chosen folder, and a limit on full detail, are passed through.
  const custom = tmp('custom-trends-')
  const q = makePlugin(zcf)
  q.plugin.start({ trendDirectory: ` ${custom} `, trendRetentionDays: 31 })
  status = q.get('/trend/status').body
  assert.deepStrictEqual([status.location, status.dir, status.retentionDays], ['custom', custom, 31])
  for (const f of dcFrames(20, 0, [[1, 45]], 0)) q.frame(f)
  q.plugin.stop()
  assert.deepStrictEqual(csv(path.join(custom, galleyPath, `${day}.csv`)).map(r => r[1]), [4.5])
  assert.strictEqual(fs.existsSync(path.join(q.dataDir, 'trends')), false)

  // Switched off in the settings: current is still published, nothing is stored.
  const off = makePlugin(zcf)
  off.plugin.start({ trendsEnabled: false })
  for (const f of dcFrames(20, 0, [[1, 60]], 0)) off.frame(f)
  assert(off.deltas.some(d => d.updates[0].values.some(v => v.path === galleyPath && v.value === 6)))
  status = off.get('/trend/status').body
  assert.deepStrictEqual([status.available, status.reason, status.enabled], [false, 'disabled', false])
  assert.strictEqual(off.get('/trend', { path: galleyPath }).body.reason, 'disabled')
  off.plugin.stop()
  assert.strictEqual(fs.existsSync(path.join(off.dataDir, 'trends')), false)

  // While the plugin runs, the beat is armed: a sample every SAMPLE_MS and a
  // write every minute put the values on disk without waiting for a stop.
  {
    const live = makePlugin(zcf)
    const liveDir = tmp('live-trends-')
    const real = { setInterval: global.setInterval, setTimeout: global.setTimeout }
    const armed = []
    const idle = () => { const t = real.setTimeout(() => {}, 1e9); t.unref(); return t }
    global.setInterval = (fn, ms) => { armed.push({ fn, ms }); return idle() }
    global.setTimeout = (fn, ms) => { armed.push({ fn, ms, once: true }); return idle() }
    try { live.plugin.start({ trendDirectory: liveDir }) } finally { Object.assign(global, real) }
    const beat = ms => armed.filter(t => !t.once && t.ms === ms)
    assert.strictEqual(beat(SAMPLE_MS).length, 1)
    assert.strictEqual(beat(60e3).length, 1)
    assert.strictEqual(beat(3600e3).length, 1)
    for (const f of dcFrames(20, 0, [[1, 52]], 0)) live.frame(f)
    beat(SAMPLE_MS)[0].fn()
    assert.strictEqual(fs.existsSync(path.join(liveDir, galleyPath)), false) // buffered until the write
    assert.deepStrictEqual(live.get('/trend', { path: galleyPath, range: '1h' }).body.data.map(r => r[1]), [5.2]) // but already on the chart
    beat(60e3)[0].fn()
    assert.deepStrictEqual(csv(path.join(liveDir, galleyPath, `${day}.csv`)).map(r => r[1]), [5.2])
    live.plugin.stop()
  }

  // The settings are there for the generic configuration form too.
  const schema = off.plugin.schema().properties
  assert.deepStrictEqual([schema.trendsEnabled.default, schema.trendDirectory.default, schema.trendRetentionDays.default], [true, '', 0])
  assert.deepStrictEqual(schema.trendRetentionDays.enum, [0, 31, 90, 365])

  console.log('Trend storage, recorder and plugin tests passed')
}

main().catch(err => { console.error(err); process.exit(1) })
