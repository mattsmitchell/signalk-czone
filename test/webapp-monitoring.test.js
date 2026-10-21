'use strict'

// The webapp's Monitoring tab and temperature chip (public/index.html), run
// against a stand-in page with the data /monitoring/live returns.

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
const el = id => (els[id] = els[id] || { textContent: '', innerHTML: '' })
const trends = []
const context = vm.createContext({
  console, MFD: false, query: '', window: {},
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  document: { querySelector: id => el(id) },
  showTrend: series => trends.push(series)
})
vm.runInContext('let monitor = { items: [], temperatures: {}, trendsEnabled: false };\n' +
  section('  // How each kind of reading is shown', '  const trend = {') +
  section('  // A temperature paired with the circuit by name', '  // Every 5 s on the Monitoring tab'), context)
const run = code => vm.runInContext(code, context)
const set = data => { context.data = data; run('monitor = data') }

// Units: Signal K in, display out.
assert.strictEqual(run("READING.temperature.f(255.15).toFixed(1)"), '-18.0')
assert.strictEqual(run("readingFor({ kind: 'pressure', source: 0 }, 'pressure').unit"), 'hPa')
assert.strictEqual(run("readingFor({ kind: 'pressure', source: 7 }, 'pressure').unit"), 'kPa')
assert.strictEqual(run("readingFor({ kind: 'ac' }, 'voltage').dp"), 1)
assert.strictEqual(run("readingFor({ kind: 'dc' }, 'voltage').dp"), 2)

const M = 'electrical.czone.monitoring.'
set({
  trendsEnabled: false,
  temperatures: { Freezer: { kelvin: 255.15, path: `${M}Freezer_Temperature.temperature`, name: 'Freezer Temperature' } },
  items: [
    { group: 'Temperatures', kind: 'temperature', name: 'Cabin Temperature', instance: 3, thirdParty: true, live: true, readings: [{ field: 'temperature', path: `${M}Cabin_Temperature.temperature`, value: 295.15 }, { field: 'relativeHumidity', path: `${M}Cabin_Temperature.relativeHumidity`, value: 0.55 }] },
    { group: 'Batteries', kind: 'dc', name: 'House Battery', instance: 0, live: true, readings: [{ field: 'voltage', path: `${M}House_Battery.voltage`, value: 13.2 }, { field: 'power', path: `${M}House_Battery.power`, value: -165 }, { field: 'stateOfCharge', path: `${M}House_Battery.capacity.stateOfCharge`, value: 0.87 }] },
    { group: 'Temperatures', kind: 'temperature', name: 'Engine Room <Temp>', instance: 2, live: false, readings: [] },
    { group: 'Tanks', kind: 'tank', name: 'Port Water Tank', instance: 2, live: true, capacity: 0.4, readings: [{ field: 'currentLevel', path: `${M}Port_Water_Tank.currentLevel`, value: 0.5 }] },
    { group: 'Environment', kind: 'pressure', source: 0, name: 'Atmospheric Pressure', instance: 100, live: true, readings: [{ field: 'pressure', path: `${M}Atmospheric_Pressure.pressure`, value: 101325 }] },
    { group: 'Inputs', kind: 'input', name: 'Bilge Float', live: true, state: true, since: '2026-10-21T01:02:00.000Z', readings: [] }
  ]
})
run('renderMonitoring()')
const page = el('#circuits').innerHTML
// Groups in their fixed order, Batteries before Temperatures before Inputs.
const order = ['Batteries', 'Tanks', 'Temperatures', 'Environment', 'Inputs'].map(g => page.indexOf(`<div class="mon-group">${g}</div>`))
assert(order.every((p, i) => p >= 0 && (i === 0 || p > order[i - 1])), order.join(','))
assert(page.includes('<b>13.20</b><i>V</i>'))
assert(page.includes('<b>-165</b><i>W</i>'))
assert(page.includes('<b>87</b><i>%</i><small>Charge</small>'))
assert(page.includes('<b>22.0</b><i>°C</i>') && page.includes('<b>55</b><i>%</i><small>Humidity</small>'))
assert(page.includes('<b>1013</b><i>hPa</i>'))
assert(page.includes('<b>400</b><i>L</i><small>Capacity</small>'))
assert(page.includes('Nothing is sending instance 2 on NMEA 2000') && page.includes('NOT ON BUS'))
assert(page.includes('Engine Room &lt;Temp&gt;'), 'names escaped')
assert(page.includes('<div class="mon-val on"><b>ON</b>'))
assert(page.includes('Instance 3 · third-party'))
assert(!page.includes('<button'), 'values open no trend while trends are off')
assert.strictEqual(el('#sectionCount').textContent, '6 items · 5 live')
// Search narrows the rows.
context.query = 'cabin'
run('renderMonitoring()')
assert(el('#circuits').innerHTML.includes('Cabin Temperature') && !el('#circuits').innerHTML.includes('House Battery'))
context.query = ''

// Trends on: a value opens its trend, in display units.
run('monitor.trendsEnabled = true; renderMonitoring()')
const button = el('#circuits').innerHTML.match(/onclick="(openSeries\([^"]*pressure[^"]*\))"/)
assert(button, 'pressure value is a button')
vm.runInContext(button[1].replace(/&#39;/g, "'").replace(/^openSeries/, 'window.openSeries'), context)
assert.strictEqual(trends[0].path, `${M}Atmospheric_Pressure.pressure`)
assert.strictEqual(trends[0].title, 'Atmospheric Pressure')
assert.strictEqual(trends[0].r.unit, 'hPa')
assert(!el('#circuits').innerHTML.includes("'capacity')"), 'capacity has no trend')

// The temperature chip beside a circuit.
assert.strictEqual(run("tempChip({ slug: 'Fridge' })"), '')
const chip = run("tempChip({ slug: 'Freezer' })")
assert(chip.startsWith('<button') && chip.includes('-18.0°C') && chip.includes('Freezer Temperature trend'))
run('monitor.trendsEnabled = false')
assert(run("tempChip({ slug: 'Freezer' })").startsWith('<span class="temp-chip"'))

console.log('Webapp monitoring tests passed')
