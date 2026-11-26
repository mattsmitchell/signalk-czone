'use strict'

// More than one value on a trend chart (public/index.html): the picker's
// list, adding and removing values, their colours, the legend, the scales and
// the overlay / stacked choice. Run against stand-in page elements.

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
const el = id => (els[id] = els[id] || { id, textContent: '', innerHTML: '', value: '', style: {}, disabled: false, title: '', attrs: {}, classList: classes(), setAttribute (k, v) { this.attrs[k] = v }, focus () {} })
const stored = {}
const fetched = []
let loads = 0, draws = 0
const context = vm.createContext({
  console, Math, Promise, Object, Number, String, Array, Date,
  window: {},
  API: '/plugins/signalk-czone',
  MONITOR_GROUPS: ['Batteries', 'Solar', 'Alternators', 'Converters', 'Wind Generators', 'DC', 'AC Power', 'Tanks', 'Temperatures', 'Environment', 'Inputs'],
  TREND_RGB: '56,169,255',
  TREND_RANGES: [['1h', '1 h'], ['24h', '24 h']],
  TREND_RANGE_MS: { '1h': 3600e3, '24h': 86400e3 },
  circuits: [{ slug: 'Bilge_Pump', name: 'Bilge Pump ' }, { slug: 'Nav_Lights', name: 'Nav Lights' }],
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  document: { querySelector: sel => el(sel.replace(/^#/, '')), body: { classList: classes() } },
  localStorage: { getItem: k => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v) } },
  fetch: url => { fetched.push(url); return Promise.resolve({ json: () => Promise.resolve({ items: [] }) }) },
  setInterval: () => 0,
  clearInterval: () => {}
})
// The page's code from READING to the chart, with loading and drawing counted
// instead of done (drawTrend and loadTrend need a canvas and a server).
const code = 'let monitor = { items: [], temperatures: {}, trendsEnabled: true };\n' +
  section('  // How each kind of reading is shown', '  async function loadTrend()') +
  section('  const trendLow =', '  function trendTicks(') +
  section('  function trendScale(', '  function drawTrendMulti()') +
  section('  function trendTicks(', '  function trendTimeLabel(') +
  'function loadTrend () { loadCount() }\nfunction drawTrend () { drawCount() }\n'
// In a page, window is the global object.
context.window = context
context.loadCount = () => { loads++ }
context.drawCount = () => { draws++ }
vm.runInContext(code, context)
const run = c => vm.runInContext(c, context)
// Arrays made in the page's context compared as plain values.
const plain = c => JSON.parse(JSON.stringify(run(c)))
const w = context.window

const M = 'electrical.czone.monitoring.'
run(`monitor.items = ${JSON.stringify([
  { group: 'Batteries', kind: 'dc', name: 'House Battery', readings: [{ field: 'voltage', path: `${M}House_Battery.voltage` }, { field: 'stateOfCharge', path: `${M}House_Battery.capacity.stateOfCharge` }] },
  { group: 'Batteries', kind: 'dc', name: 'Start Battery', readings: [{ field: 'voltage', path: `${M}Start_Battery.voltage` }] },
  { group: 'Tanks', kind: 'tank', name: 'Port Water Tank', capacity: 0.4, readings: [{ field: 'currentLevel', path: `${M}Port_Water_Tank.currentLevel` }, { field: 'capacity', path: `${M}Port_Water_Tank.capacity` }] },
  { group: 'Solar', kind: 'dc', name: 'Solar', readings: [{ field: 'power', path: `${M}Solar.power` }] },
  { group: 'Environment', kind: 'pressure', source: 0, name: 'Atmospheric Pressure', readings: [{ field: 'pressure', path: `${M}Atmospheric_Pressure.pressure` }] },
  { group: 'Inputs', kind: 'input', name: 'Watermaker Running', path: 'electrical.czone.inputs.Watermaker_Running.state', readings: [] },
  { group: 'Inputs', kind: 'input', name: 'No Path', readings: [] },
  { group: 'Pumps', kind: 'dc', name: 'Odd Group', readings: [{ field: 'current', path: `${M}Odd_Group.current` }] }
])}`)

// Everything that can be added: monitored values (not capacity), inputs with a
// path as on/off, and circuit currents.
const cand = run('trendCandidates()')
const paths = cand.map(c => c.path)
assert(paths.includes(`${M}House_Battery.voltage`))
assert(!paths.includes(`${M}Port_Water_Tank.capacity`), 'capacity is a setting, not a trend')
assert(paths.includes('electrical.czone.inputs.Watermaker_Running.state'))
assert.strictEqual(cand.filter(c => c.title === 'No Path').length, 0, 'an input with no path is left out')
assert.strictEqual(cand.find(c => c.title === 'Watermaker Running').r.onOff, true)
assert.strictEqual(cand.find(c => c.title === 'Atmospheric Pressure').r.unit, 'hPa', 'display units as on the Monitoring tab')
const bilge = cand.find(c => c.path === 'electrical.czone.Bilge_Pump.current')
assert(bilge && bilge.group === 'Circuit current' && bilge.title === 'Bilge Pump' && bilge.r.unit === 'A')

// Open a chart with one value: no legend, the usual subtitle, no mode choice.
run(`showTrend({ path: '${M}House_Battery.voltage', title: 'House Battery', r: READING.voltage })`)
assert.strictEqual(run('trend.list.length'), 1)
assert.strictEqual(run('trend.list[0].rgb'), '56,169,255', 'the first value keeps the usual colour')
assert.strictEqual(el('trendSub').textContent, `Voltage · ${M}House_Battery.voltage`)
assert.strictEqual(loads, 1)
run('trendControls()')
assert.strictEqual(el('trendMode').innerHTML, '', 'one unit: no overlay / stacked')
assert.strictEqual(el('trendAdd').disabled, false)

// The picker: grouped in the Monitoring order, then any other group, then circuits;
// the value already on the chart is not offered.
w.toggleTrendPicker()
assert.strictEqual(run('trend.picker'), true)
assert(el('trendPicker').classList.contains('show'))
assert.strictEqual(el('trendAdd').attrs['aria-expanded'], 'true')
assert.strictEqual(fetched.length, 0, 'Monitoring values already loaded: nothing fetched')
let list = el('trendPickList').innerHTML
const groupAt = g => list.indexOf(`<div class="trend-pick-group">${g}</div>`)
assert(groupAt('Batteries') >= 0 && groupAt('Batteries') < groupAt('Solar') && groupAt('Solar') < groupAt('Tanks') && groupAt('Tanks') < groupAt('Environment') && groupAt('Environment') < groupAt('Inputs'))
assert(groupAt('Inputs') < groupAt('Pumps') && groupAt('Pumps') < groupAt('Circuit current'), 'an unknown group before circuits')
assert(!run('trend.pickShown').some(c => c.path === `${M}House_Battery.voltage`), 'already on the chart')

// Search narrows the list; nothing found says so.
el('trendPickSearch').value = 'solar'
w.trendPickerList()
assert.deepStrictEqual(plain('trend.pickShown.map(c => c.title)'), ['Solar'])
el('trendPickSearch').value = 'zzz'
w.trendPickerList()
assert(el('trendPickList').innerHTML.includes('Nothing matches.'))

// Add Solar power: second colour, picker closed, reloaded, subtitle counts.
el('trendPickSearch').value = 'solar'
w.trendPickerList()
w.addTrendSeries(0)
assert.strictEqual(run('trend.list.length'), 2)
assert.strictEqual(run('trend.list[1].title'), 'Solar')
assert.strictEqual(run('trend.list[1].rgb'), '217,120,58')
assert.strictEqual(run('trend.picker'), false)
assert.strictEqual(loads, 2)
assert.strictEqual(el('trendSub').textContent, '2 values')
// The same value again is not added twice.
w.addTrendSeries(0)
assert.strictEqual(run('trend.list.length'), 2)
// A bad index does nothing.
w.addTrendSeries(99)
assert.strictEqual(run('trend.list.length'), 2)

// Two units: overlay / stacked offered.
run('trendControls()')
assert(el('trendMode').innerHTML.includes("setTrendMode('overlay')") && el('trendMode').innerHTML.includes("setTrendMode('stacked')"))
assert(el('trendMode').innerHTML.includes('class="active" onclick="setTrendMode(\'overlay\')"'), 'overlay by default')
w.setTrendMode('stacked')
assert.strictEqual(run('trend.mode'), 'stacked')
assert.strictEqual(stored['czone-trend-mode'], 'stacked', 'remembered')
w.setTrendMode('nonsense')
assert.strictEqual(run('trend.mode'), 'overlay')
w.setTrendMode('stacked')

// Add the watermaker input and a circuit current.
const addByTitle = title => {
  el('trendPickSearch').value = ''
  w.toggleTrendPicker()
  const i = run('trend.pickShown').findIndex(c => c.title === title)
  assert(i >= 0, title)
  w.addTrendSeries(i)
}
addByTitle('Watermaker Running')
addByTitle('Bilge Pump')
assert.deepStrictEqual(plain('trendUnits()'), ['V', 'W', 'on/off', 'A'])
assert.deepStrictEqual(plain('trend.list.map(s => s.rgb)'), ['56,169,255', '217,120,58', '35,170,120', '214,166,30'])

// The legend: a chip per value with its latest reading; only added ones can be removed.
run(`trend.list[0].latest = 13.164; trend.list[1].data = [[1, 486], [2, 512]]; trend.list[2].latest = 0; trend.list[3].latest = null`)
run('trendStats()')
const legend = el('trendStats').innerHTML
assert.strictEqual((legend.match(/class="trend-legend"/g) || []).length, 4)
assert(legend.includes('House Battery · Voltage</span><b>13.16 V</b>'))
assert(legend.includes('Solar · Power</span><b>512 W</b>'), 'no live value: the last sample')
assert(legend.includes('Watermaker Running · On / off</span><b>OFF</b>'))
assert(legend.includes('Bilge Pump · Current</span><b>—</b>'))
assert(!legend.includes('removeTrendSeries(0)'), 'the first value stays')
assert(legend.includes('removeTrendSeries(1)') && legend.includes('removeTrendSeries(3)'))

// Value text: ON / OFF, share of time when summarised, else number and unit.
assert.strictEqual(run('trendValueText(trend.list[2], 1, false)'), 'ON')
assert.strictEqual(run('trendValueText(trend.list[2], 0.25, true)'), 'on 25%')
assert.strictEqual(run('trendValueText(trend.list[0], 13.2, true)'), '13.20 V')

// Five at most: the add button is disabled and the picker will not open.
addByTitle('Port Water Tank')
assert.strictEqual(run('trend.list.length'), 5)
assert.strictEqual(run('trend.list[4].rgb'), '214,96,150')
run('trendControls()')
assert.strictEqual(el('trendAdd').disabled, true)
w.toggleTrendPicker()
assert.strictEqual(run('trend.picker'), false)
w.addTrendSeries(0)
assert.strictEqual(run('trend.list.length'), 5)

// Remove one: its colour is free for the next value; the first can't be removed.
w.removeTrendSeries(1)
assert.strictEqual(run('trend.list.length'), 4)
assert(!run('trend.list').some(s => s.title === 'Solar'))
assert.strictEqual(el('trendSub').textContent, '4 values')
assert.strictEqual(el('trendTip').style.display, 'none')
w.removeTrendSeries(0)
w.removeTrendSeries(9)
assert.strictEqual(run('trend.list.length'), 4)
addByTitle('Solar')
assert.strictEqual(run('trend.list[4].rgb'), '217,120,58', 'the freed colour is reused')

// Back to one value: the usual subtitle again.
while (run('trend.list.length') > 1) w.removeTrendSeries(1)
assert.strictEqual(el('trendSub').textContent, `Voltage · ${M}House_Battery.voltage`)
run('trendControls()')
assert.strictEqual(el('trendMode').innerHTML, '')

// Two values in the same unit share one scale: no overlay / stacked choice.
addByTitle('Start Battery')
assert.strictEqual(el('trendSub').textContent, '2 values')
run('trendControls()')
assert.strictEqual(el('trendMode').innerHTML, '', 'one unit, one scale')
w.removeTrendSeries(1)

// Scales: on/off is fixed at OFF and ON; a zero-based unit starts at zero.
const onOff = run(`trendScale([{ r: READING.state, data: [[1, 0, null, null], [2, 1, null, null]] }], 4)`)
assert.deepStrictEqual(Array.from(onOff.ticks), [0, 1])
assert.strictEqual(onOff.label(1), 'ON')
assert.strictEqual(onOff.label(0), 'OFF')
const power = run(`trendScale([{ r: READING.power, data: [[1, 300, null, null], [2, 900, 250, 1200]] }], 4)`)
assert.strictEqual(power.lo, 0, 'power from zero')
assert(power.hi >= 1200, 'summarised maximum included')
assert.strictEqual(power.unit, 'W')
const volts = run(`trendScale([{ r: READING.voltage, data: [[1, 53.05, null, null], [2, 53.3, null, null]] }], 4)`)
assert(volts.lo > 50, 'voltage not from zero')
assert.strictEqual(volts.label(53.1), '53.1', 'labels to the tick step')
assert.strictEqual(run('trendScale([{ r: READING.voltage, data: [] }], 4)'), null, 'no data, no scale')

// On/off plots the bucket max, not the time-average, so a brief open still
// reaches ON on a summarised range; raw points and numeric series are unchanged.
assert.strictEqual(run('trendPlot({ r: READING.state }, [1, 0.2, 0, 1])'), 1, 'on/off summarised uses max, not avg')
assert.strictEqual(run('trendPlot({ r: READING.state }, [1, 1, null, null])'), 1, 'on/off raw on')
assert.strictEqual(run('trendPlot({ r: READING.state }, [1, 0, null, null])'), 0, 'on/off raw off')
assert.strictEqual(run('trendPlot({ r: READING.voltage }, [1, 53.1, 53, 53.3])'), 53.1, 'a numeric series still plots the average')

// Opened from a circuit with the Monitoring tab never loaded: the picker fetches the values.
run('monitor.items = []')
run(`showTrend({ path: 'electrical.czone.Nav_Lights.current', title: 'Nav Lights', r: READING.current })`)
w.toggleTrendPicker()
assert.strictEqual(fetched.length, 1)
assert(fetched[0].endsWith('/monitoring/live'))
assert(run('trend.pickShown').some(c => c.title === 'Bilge Pump'), 'circuits offered meanwhile')

// A stored mode is used when the page opens.
const ctx2 = vm.createContext(Object.assign({}, context, { localStorage: { getItem: () => 'stacked', setItem () {} } }))
ctx2.window = ctx2
vm.runInContext(code, ctx2)
assert.strictEqual(vm.runInContext('trend.mode', ctx2), 'stacked')

console.log('webapp trend series tests passed')
