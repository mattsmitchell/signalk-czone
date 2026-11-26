'use strict'

// Saved trend views: the store (lib/trend-views.js) and the plugin routes.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tv = require('../lib/trend-views')
const pluginFactory = require('../index')

// --- sanitize -----------------------------------------------------------------
assert.strictEqual(tv.sanitize(null), null)
assert.strictEqual(tv.sanitize({ name: '', series: ['a'] }), null, 'no name')
assert.strictEqual(tv.sanitize({ name: 'x', series: [] }), null, 'no value')
// Name trimmed; paths trimmed, de-duplicated, capped; a bad mode falls back.
assert.deepStrictEqual(
  tv.sanitize({ name: '  My View  ', series: ['a', { path: ' b ' }, { path: 'a' }, {}, 5], mode: 'bogus', range: '7d' }),
  { name: 'My View', series: [{ path: 'a' }, { path: 'b' }], mode: 'overlay', range: '7d' }
)
assert.strictEqual(tv.sanitize({ name: 'x', series: ['a', 'b', 'c', 'd', 'e', 'f'] }).series.length, 5)
assert.strictEqual(tv.sanitize({ name: 'x', series: ['a'] }).range, '24h', 'range default')

// --- the store ----------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'))
let store = tv.createTrendViews({ dir })
assert.deepStrictEqual(store.list(), [])
const saved = store.save({ name: 'House + Solar', series: ['p1', 'p2'], mode: 'overlay', range: '24h' })
assert(saved.id && saved.updatedAt && saved.series.length === 2)
assert.strictEqual(store.list().length, 1)
// Saving with an id replaces that view (a rename / update), not a second one.
const renamed = store.save({ id: saved.id, name: 'Energy', series: ['p1', 'p2', 'p3'], mode: 'stacked', range: '7d' })
assert.strictEqual(renamed.id, saved.id)
assert.strictEqual(store.list().length, 1)
assert.strictEqual(store.list()[0].name, 'Energy')
assert.strictEqual(store.list()[0].mode, 'stacked')
// Stored on disk: a fresh store reads the same file back.
store = tv.createTrendViews({ dir })
assert.strictEqual(store.list().length, 1)
assert.strictEqual(store.list()[0].name, 'Energy')
// A bad save throws and changes nothing.
assert.throws(() => store.save({ name: '', series: ['p'] }))
assert.strictEqual(store.list().length, 1)
// Remove: unknown id is false, the real one is true.
assert.strictEqual(store.remove('nope'), false)
assert.strictEqual(store.remove(saved.id), true)
assert.strictEqual(store.list().length, 0)
// A corrupt file is ignored, not fatal.
fs.writeFileSync(path.join(dir, 'trend-views.json'), 'not json')
assert.deepStrictEqual(tv.createTrendViews({ dir }).list(), [])

// A custom range keeps its from/to; a custom range with no valid window falls
// back to a rolling 24 h.
assert.deepStrictEqual(tv.sanitize({ name: 'x', series: ['p'], range: 'custom', from: 1000, to: 5000 }), { name: 'x', series: [{ path: 'p' }], mode: 'overlay', range: 'custom', from: 1000, to: 5000 })
assert.strictEqual(tv.sanitize({ name: 'x', series: ['p'], range: 'custom', from: 5000, to: 1000 }).range, '24h', 'to must be after from')
assert.strictEqual(tv.sanitize({ name: 'x', series: ['p'], range: 'custom' }).range, '24h', 'custom with no window')
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tv2-'))
let s2 = tv.createTrendViews({ dir: dir2 })
const cv = s2.save({ name: 'Window', series: ['p'], range: 'custom', from: 10, to: 20 })
assert.deepStrictEqual([cv.range, cv.from, cv.to], ['custom', 10, 20])
assert.deepStrictEqual((tv.createTrendViews({ dir: dir2 }).list()[0]), cv, 'custom window persists verbatim')

// A failed write is NOT reported as a save: save/remove throw, nothing commits,
// and the existing file on disk is untouched (atomic temp+rename).
const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'tv3-'))
const viewsFile = path.join(dir3, 'trend-views.json')
let s3 = tv.createTrendViews({ dir: dir3 })
s3.save({ name: 'One', series: ['p'] })
const okList = s3.list()
const goodBytes = fs.readFileSync(viewsFile, 'utf8')
const origRename = fs.renameSync
fs.renameSync = () => { throw new Error('simulated rename failure') }
let threw = false
try { s3.save({ name: 'Two', series: ['q'] }) } catch (e) { threw = true; assert.strictEqual(e.status, 500); assert(/could not save/i.test(e.message)) }
assert(threw, 'save throws when the write fails')
assert.deepStrictEqual(s3.list(), okList, 'in-memory list unchanged after a failed save')
assert.strictEqual(fs.readFileSync(viewsFile, 'utf8'), goodBytes, 'existing file left intact')
assert.strictEqual(fs.readdirSync(dir3).filter(f => f.endsWith('.tmp')).length, 0, 'temp file cleaned up on failure')
threw = false
try { s3.remove(okList[0].id) } catch (e) { threw = true; assert.strictEqual(e.status, 500) }
assert(threw, 'remove throws when the write fails')
assert.deepStrictEqual(s3.list(), okList, 'in-memory list unchanged after a failed remove')
fs.renameSync = origRename
// With writing restored, the last good content is still what loads.
assert.deepStrictEqual(tv.createTrendViews({ dir: dir3 }).list(), okList, 'disk still holds the last good save')

// --- the plugin routes --------------------------------------------------------
function makePlugin () {
  const configPath = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-czone-views-'))
  const app = {
    config: { configPath },
    isNmea2000OutAvailable: true,
    on: () => {},
    emit: () => {},
    debug: () => {},
    registerPutHandler: () => {},
    handleMessage: () => {},
    setPluginStatus: () => {}
  }
  const plugin = pluginFactory(app)
  const routes = { get: new Map(), post: new Map(), delete: new Map() }
  plugin.registerWithRouter({ get: (p, fn) => routes.get.set(p, fn), post: (p, fn) => routes.post.set(p, fn), delete: (p, fn) => routes.delete.set(p, fn) })
  const call = (method, route, { params = {}, body } = {}) => {
    const out = { status: 200, body: undefined }
    const res = { status (code) { out.status = code; return res }, json (value) { out.body = value; return res } }
    routes[method].get(route)({ params, body }, res)
    return out
  }
  return { plugin, call }
}

const p = makePlugin()
p.plugin.start({})

// Empty to begin with.
assert.deepStrictEqual(p.call('get', '/trend/views').body.views, [])

// Save two, list them.
let r = p.call('post', '/trend/views', { body: { name: 'Energy', series: [{ path: 'a' }, { path: 'b' }], mode: 'stacked', range: '7d' } })
assert.strictEqual(r.status, 200)
assert.strictEqual(r.body.ok, true)
const id = r.body.view.id
p.call('post', '/trend/views', { body: { name: 'Water', series: ['c'], mode: 'overlay', range: '24h' } })
assert.deepStrictEqual(p.call('get', '/trend/views').body.views.map(v => v.name).sort(), ['Energy', 'Water'])

// A view with no name is refused.
r = p.call('post', '/trend/views', { body: { name: '', series: ['a'] } })
assert.strictEqual(r.status, 400)
assert.strictEqual(r.body.ok, false)
assert.strictEqual(p.call('get', '/trend/views').body.views.length, 2)

// Saved across a restart (stored in the plugin data folder).
p.plugin.stop()
p.plugin.start({})
assert.strictEqual(p.call('get', '/trend/views').body.views.length, 2)

// A failed disk write surfaces as HTTP 500 with ok:false, not a false success.
const origRenameRoute = fs.renameSync
fs.renameSync = () => { throw new Error('simulated rename failure') }
const failed = p.call('post', '/trend/views', { body: { name: 'Wont Save', series: ['z'] } })
fs.renameSync = origRenameRoute
assert.strictEqual(failed.status, 500, 'write failure is 500, not 400 or 200')
assert.strictEqual(failed.body.ok, false)
assert(!p.call('get', '/trend/views').body.views.some(v => v.name === 'Wont Save'), 'nothing saved when the write failed')

// Delete by id.
assert.deepStrictEqual(p.call('delete', '/trend/views/:id', { params: { id } }).body, { ok: true })
assert.deepStrictEqual(p.call('get', '/trend/views').body.views.map(v => v.name), ['Water'])
assert.deepStrictEqual(p.call('delete', '/trend/views/:id', { params: { id: 'gone' } }).body, { ok: false })
p.plugin.stop()

console.log('trend views tests passed')
