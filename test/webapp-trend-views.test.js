'use strict'

// Saved views and CSV export in the webapp (public/index.html): resolving a
// saved view back onto the chart, saving the current one, and the CSV text.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
const section = (start, end) => {
  assert(html.includes(start) && html.includes(end), `markers: ${start}`)
  return html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)))
}

const els = {}
const classes = () => {
  const set = new Set()
  return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c) } }
}
const el = id => (els[id] = els[id] || { id, textContent: '', innerHTML: '', value: '', style: {}, disabled: false, title: '', attrs: {}, classList: classes(), setAttribute (k, v) { this.attrs[k] = v }, focus () {}, select () {} })

// A stand-in server: views kept in memory, POST and DELETE recorded.
let serverViews = []
const posted = []
let dl = {}
function fakeFetch (url, opts) {
  opts = opts || {}
  if (url.indexOf('/trend/views') >= 0 && opts.method === 'POST') {
    const body = JSON.parse(opts.body); posted.push(body)
    const view = { id: 'srv' + (serverViews.length + 1), ...body, updatedAt: 'now' }
    serverViews.push(view)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, view }) })
  }
  if (url.indexOf('/trend/views/') >= 0 && opts.method === 'DELETE') {
    const id = decodeURIComponent(url.split('/trend/views/')[1])
    serverViews = serverViews.filter(v => v.id !== id)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
  }
  if (url.indexOf('/trend/views') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ views: serverViews.map(v => ({ ...v })) }) })
  if (url.indexOf('/monitoring/live') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) })
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}

const context = vm.createContext({
  console, Math, Promise, Object, Number, String, Array, Date, Set, JSON, setTimeout,
  API: '/plugins/signalk-czone',
  MONITOR_GROUPS: ['Batteries', 'Solar', 'Alternators', 'Converters', 'Wind Generators', 'DC', 'AC Power', 'Tanks', 'Temperatures', 'Environment', 'Inputs'],
  TREND_RGB: '56,169,255',
  TREND_RANGES: [['1h', '1 h'], ['24h', '24 h']],
  TREND_RANGE_MS: { '1h': 3600e3, '24h': 86400e3 },
  circuits: [{ slug: 'Bilge_Pump', name: 'Bilge Pump ' }],
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  alert: () => {},
  Blob: function (parts) { this.text = parts.join('') },
  URL: { createObjectURL: b => { dl.text = b.text; return 'blob:x' }, revokeObjectURL () {} },
  localStorage: { getItem: () => null, setItem () {} },
  fetch: fakeFetch,
  setInterval: () => 0,
  clearInterval: () => {}
})
context.window = context
context.document = {
  querySelector: sel => el(sel.replace(/^#/, '')),
  body: { classList: classes(), appendChild () {} },
  createElement: () => ({ set href (v) {}, set download (v) { dl.name = v }, click () {}, remove () {} })
}
const code = 'let monitor = { items: [], temperatures: {}, trendsEnabled: true };\n' +
  section('  // How each kind of reading is shown', '  async function loadTrend()') +
  section('  const trendLow =', '  function trendTicks(') +
  section('  function trendScale(', '  function drawTrendMulti()') +
  section('  function trendTicks(', '  function trendTimeLabel(') +
  'function loadTrend () { loadCount() }\nfunction drawTrend () {}\n'
let loads = 0
context.loadCount = () => { loads++ }
vm.runInContext(code, context)
const run = c => vm.runInContext(c, context)
const plain = c => JSON.parse(JSON.stringify(run(c)))
const w = context.window
const tick = () => new Promise(r => setImmediate(r))

const M = 'electrical.czone.monitoring.'
run(`monitor.items = ${JSON.stringify([
  { group: 'Batteries', kind: 'dc', name: 'House Battery', readings: [{ field: 'voltage', path: `${M}House_Battery.voltage` }] },
  { group: 'Solar', kind: 'dc', name: 'Solar', readings: [{ field: 'power', path: `${M}Solar.power` }] },
  { group: 'Inputs', kind: 'input', name: 'Watermaker Running', path: 'electrical.czone.inputs.Watermaker_Running.state', readings: [] }
])}`)

async function main () {
  // --- CSV of the chart -------------------------------------------------------
  run(`trend.range = '24h'; trend.list = [
    { path: 'v', title: 'House Battery', r: READING.voltage, data: [[1000, 53.1], [3000, 53.25]] },
    { path: 'wm', title: 'Watermaker Running', r: READING.state, data: [[2000, 0], [2001, 1], [4000, 1]] }
  ]`)
  const csv = run('trendCsv()')
  const rows = csv.split('\r\n')
  assert.strictEqual(rows[0], 'Time,House Battery (V),Watermaker Running (on/off)')
  // Union of all sample times, in order.
  assert.strictEqual(rows.length, 1 + 5)
  // Voltage held at two decimals; the input empty before its first sample, then 0/1.
  assert.strictEqual(rows[1], new Date(1000).toISOString() + ',53.10,')
  assert.strictEqual(rows[2], new Date(2000).toISOString() + ',53.10,0')
  assert.strictEqual(rows[3], new Date(2001).toISOString() + ',53.10,1')
  assert.strictEqual(rows[5], new Date(4000).toISOString() + ',53.25,1')
  // A comma in a name is quoted.
  run(`trend.list = [{ path: 'v', title: 'A, B', r: READING.voltage, data: [[1000, 1]] }]`)
  assert.strictEqual(run('trendCsv()').split('\r\n')[0], 'Time,"A, B (V)"')
  // No data: nothing to export.
  run(`trend.list = [{ path: 'v', title: 'x', r: READING.voltage, data: [] }]`)
  assert.strictEqual(run('trendCsv()'), '')

  // Across a gap the held value stops: a sample older than the series' gapMs
  // leaves the cell blank, both inside an internal gap and past the last sample.
  run(`trend.list = [
    { path: 'a', title: 'A', r: READING.voltage, gapMs: 100, data: [[1000, 10], [1300, 20]] },
    { path: 'b', title: 'B', r: READING.voltage, gapMs: 100000, data: [[1150, 5], [1600, 6]] }
  ]`)
  const grows = run('trendCsv()').split('\r\n')
  const grow = t => grows.find(r => r.indexOf(new Date(t).toISOString()) === 0)
  assert.strictEqual(grow(1150), new Date(1150).toISOString() + ',,5.00', 'A blank inside its gap; B present')
  assert.strictEqual(grow(1300), new Date(1300).toISOString() + ',20.00,5.00', 'A own sample; B still held within its gap')
  assert.strictEqual(grow(1600), new Date(1600).toISOString() + ',,6.00', 'A blank past its final sample')

  // exportTrendCsv downloads the text with a dated filename.
  run(`trend.range = '24h'; trend.list = [{ path: 'v', title: 'House Battery', r: READING.voltage, data: [[1000, 53.1]] }]`)
  el('trendTitle').textContent = 'House Battery'
  dl = {}
  w.exportTrendCsv()
  assert(/^House Battery 24h \d{4}-\d{2}-\d{2}\.csv$/.test(dl.name), dl.name)
  assert(dl.text.indexOf('House Battery (V)') >= 0)

  // --- saving the current view ------------------------------------------------
  run(`trend.range = '7d'; trend.mode = 'stacked'; trend.list = [
    { path: '${M}House_Battery.voltage', title: 'House Battery', r: READING.voltage, data: [[1, 53]] },
    { path: 'electrical.czone.inputs.Watermaker_Running.state', title: 'Watermaker Running', r: READING.state, data: [[1, 0]] }
  ]`)
  el('trendSaveName').value = 'Energy watch'
  await w.saveTrendView(); await tick()
  assert.deepStrictEqual(posted[posted.length - 1], {
    name: 'Energy watch',
    series: [{ path: `${M}House_Battery.voltage` }, { path: 'electrical.czone.inputs.Watermaker_Running.state' }],
    mode: 'stacked',
    range: '7d'
  })
  assert.strictEqual(run('trend.saveOpen'), false, 'the save row closes')

  // A custom range keeps its from/to, so the saved view reopens on the same
  // period instead of silently becoming a rolling 24 h.
  run(`trend.range = 'custom'; trend.custom = { from: 1000, to: 5000 }`)
  el('trendSaveName').value = 'That night'
  await w.saveTrendView(); await tick()
  assert.strictEqual(posted[posted.length - 1].range, 'custom')
  assert.strictEqual(posted[posted.length - 1].from, 1000)
  assert.strictEqual(posted[posted.length - 1].to, 5000)
  // Opening it restores the custom window.
  run('trend.custom = null; trend.range = "24h"')
  const night = serverViews.find(v => v.name === 'That night')
  await w.openSavedView(night.id); await tick(); await tick()
  assert.strictEqual(run('trend.range'), 'custom')
  assert.deepStrictEqual(plain('trend.custom'), { from: 1000, to: 5000 })

  // An empty name is refused client-side (nothing posted).
  const before = posted.length
  el('trendSaveName').value = '   '
  await w.saveTrendView(); await tick()
  assert.strictEqual(posted.length, before)
  assert(el('trendSaveMsg').textContent)

  // --- listing and opening a saved view ---------------------------------------
  await w.toggleTrendViews(); await tick(); await tick()
  assert.strictEqual(run('trend.viewsOpen'), true)
  assert(el('trendViewList').innerHTML.indexOf('Energy watch') >= 0)
  assert(el('trendViewList').innerHTML.indexOf('2 values · stacked') >= 0)

  // Open the Energy watch view: both values resolved, in order, coloured,
  // stacked, over 7 d; an unknown path would be dropped.
  const energy = serverViews.find(v => v.name === 'Energy watch')
  loads = 0
  await w.openSavedView(energy.id); await tick(); await tick()
  assert.deepStrictEqual(plain('trend.list.map(s => s.path)'), [`${M}House_Battery.voltage`, 'electrical.czone.inputs.Watermaker_Running.state'])
  assert.deepStrictEqual(plain('trend.list.map(s => s.rgb)'), ['56,169,255', '217,120,58'])
  assert.strictEqual(run('trend.mode'), 'stacked')
  assert.strictEqual(run('trend.range'), '7d')
  assert.strictEqual(run('trend.open'), true)
  assert.strictEqual(el('trendTitle').textContent, 'Energy watch')
  assert.strictEqual(loads, 1, 'the view loads its data')

  // A view whose values are all gone: nothing opens.
  serverViews.push({ id: 'ghost', name: 'Gone', series: [{ path: 'electrical.czone.nope.value' }], mode: 'overlay', range: '24h' })
  await w.toggleTrendViews(); await tick() // refresh list (toggles closed then we reopen)
  run('trend.views.push({ id:"ghost", name:"Gone", series:[{path:"electrical.czone.nope.value"}], mode:"overlay", range:"24h" })')
  const keepList = run('JSON.stringify(trend.list.map(s => s.path))')
  await w.openSavedView('ghost'); await tick(); await tick()
  assert.strictEqual(run('JSON.stringify(trend.list.map(s => s.path))'), keepList, 'chart unchanged when nothing resolves')

  // Delete a view.
  await w.deleteTrendView(energy.id); await tick(); await tick()
  assert(!serverViews.some(v => v.id === energy.id))

  console.log('webapp trend views tests passed')
}

main().catch(err => { console.error(err); process.exit(1) })
