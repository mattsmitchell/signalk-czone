'use strict'

// Regression: loadTrend (public/index.html) matches each /trend response to its
// series by Signal K path, not by position. Removing a value while a load is in
// flight must not apply one value's data to another.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
const START = '  async function loadTrend() {'
const END = '\n  const trendLow ='
assert(html.includes(START) && html.includes(END), 'loadTrend markers')
const code = html.slice(html.indexOf(START), html.indexOf(END, html.indexOf(START)))

// Per-path trend data; fetches resolve only when we release them, so a series
// can be removed mid-flight.
const DATA = {
  a: { data: [[1, 100]], start: 0, end: 10, gapMs: 1000, latest: { value: 100 } },
  b: { data: [[1, 200]], start: 0, end: 10, gapMs: 1000, latest: { value: 200 } },
  c: { data: [[1, 300]], start: 0, end: 10, gapMs: 1000, latest: { value: 300 } }
}
const released = []
const noop = () => {}
const stubEl = { value: '', style: {}, textContent: '', classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop }

const ctx = vm.createContext({
  Promise, Array, Number, Math, Date, JSON, console,
  API: '/plugins/signalk-czone',
  TREND_RANGE_MS: { '24h': 86400e3 },
  toLocalInput: () => '',
  trendEl: () => stubEl,
  trendControls: noop, trendStats: noop, drawTrend: noop, trendMsg: noop,
  setInterval: () => 0, clearInterval: noop,
  fetch: url => {
    const p = decodeURIComponent(url.match(/path=([^&]+)/)[1])
    return new Promise(res => released.push(() => res({ json: () => Promise.resolve(DATA[p]) })))
  }
})
const idf = v => v
ctx.trend = {
  open: true, series: null, data: [], range: '24h', custom: null, customOpen: false,
  seq: 0, gapMs: 0, latest: null, hover: null, start: 0, end: 0,
  list: [
    { path: 'a', title: 'A', r: { f: idf, dp: 0 }, data: [], gapMs: 0, latest: null },
    { path: 'b', title: 'B', r: { f: idf, dp: 0 }, data: [], gapMs: 0, latest: null },
    { path: 'c', title: 'C', r: { f: idf, dp: 0 }, data: [], gapMs: 0, latest: null }
  ]
}
ctx.trend.series = ctx.trend.list[0]
vm.runInContext(code + '\nthis.loadTrend = loadTrend;', ctx)

async function main () {
  const p = ctx.loadTrend()        // creates three pending fetches, then awaits
  await Promise.resolve(); await Promise.resolve()
  // Remove B while the fetches are still outstanding.
  ctx.trend.list.splice(1, 1)
  assert.deepStrictEqual(ctx.trend.list.map(s => s.path), ['a', 'c'])
  released.forEach(fn => fn())      // let all three responses come back
  await p

  // C must carry C's data (300), never B's (200) that arrived in slot 1.
  const byPath = {}
  ctx.trend.list.forEach(s => { byPath[s.path] = s.data[0][1] })
  assert.deepStrictEqual(byPath, { a: 100, c: 300 }, 'each series keeps its own data by path')
  assert.strictEqual(ctx.trend.list.find(s => s.path === 'c').latest, 300, 'C latest is C, not B')

  console.log('loadTrend path-matching regression passed')
}
main().catch(e => { console.error(e && e.stack || e); process.exit(1) })
