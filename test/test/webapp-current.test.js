'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
const section = (start, end) => {
  assert(html.includes(start) && html.includes(end), 'Webapp test source markers must exist')
  return html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)))
}
// The ON/OFF button and the name chip are separate elements; the stub returns
// the right one by selector so each can be checked independently.
const btn = { textContent: '' }
const chip = { textContent: '' }
const context = vm.createContext({
  console, CSS: { escape: s => s },
  document: { querySelector: sel => (String(sel).includes('data-meter-slug') ? chip : btn) },
  pending: new Map(), favorites: new Set(), status: {},
  circuits: [{ name: 'Galley Lights', slug: 'Galley_Lights', module: 20, channel: 1, state: { state: 'ON' } }],
  isFavorite: () => false, nameKey: c => c.name, circuitBySlug: slug => context.circuits.find(c => c.slug === slug),
  stateOf: c => c.state.state === 'ON', percentOf: c => c.state.percent,
  categoryData: () => ({ master: [] }), subCategoryList: () => [],
  askMark: () => '', tempChip: () => '', esc: s => s
})
vm.runInContext(
  section('  const currentOf =', '  const categoryData =') +
  section('  function meterChip(', '  const MONITOR_GROUPS') +
  section('  function circuitRow(', '  function previewPercent(') +
  section('  function applySocketValue(', '  async function refreshOnce('), context)
const run = code => vm.runInContext(code, context)

// A plain CZone (DC) load: amps on the ON/OFF button, as it has always been,
// and no chip beside the name.
run("applySocketValue('electrical.czone.Galley_Lights.current', 6.2)")
assert.strictEqual(btn.textContent, '6.2 A', 'DC load: amps on the button')
assert.strictEqual(chip.textContent, '', 'DC load: no amps chip')
run("mergeRest({ circuits: [{name:'Galley Lights',slug:'Galley_Lights',module:20,channel:1,state:{state:'ON',current:6.2}}] })")
let row = run('circuitRow(circuits[0])')
assert(row.includes('>6.2 A</button>'), 'DC button shows amps')
assert(row.includes('data-meter-slug="Galley_Lights"></span>'), 'DC: empty chip')
// Drawing nothing: button falls back to ON, chip stays empty.
run("circuits = []")
run("mergeRest({ circuits: [{name:'Galley Lights',slug:'Galley_Lights',module:20,channel:1,state:{state:'ON',current:0}}] })")
row = run('circuitRow(circuits[0])')
assert(row.includes('>ON</button>') && row.includes('data-meter-slug="Galley_Lights"></span>'))

// A metered circuit (a load measured by a Shelly): watts on the button, amps in
// the chip beside the name. Both arrive on their own paths.
run("circuits = []")
run("mergeRest({ circuits: [{name:'Hot Water',slug:'Hot_Water',module:1,channel:1,state:{state:'ON'}}] })")
run("applySocketValue('electrical.czone.Hot_Water.power', 688.2)")
assert.strictEqual(btn.textContent, '688 W', 'metered: watts on the button')
assert.strictEqual(chip.textContent, '', 'no current reading yet: empty chip')
run("applySocketValue('electrical.czone.Hot_Water.current', 3.0)")
assert.strictEqual(btn.textContent, '688 W', 'button stays watts')
assert.strictEqual(chip.textContent, '3.0 A', 'metered: amps in the chip')
row = run('circuitRow(circuitBySlug("Hot_Water"))')
assert(row.includes('>688 W</button>'), 'metered button shows watts')
assert(row.includes('data-meter-slug="Hot_Water">3.0 A</span>'), 'metered chip shows amps')
// Power but no current: watts on button, empty chip.
run("circuits = []")
run("mergeRest({ circuits: [{name:'Hot Water',slug:'Hot_Water',module:1,channel:1,state:{state:'ON',power:688.2}}] })")
row = run('circuitRow(circuitBySlug("Hot_Water"))')
assert(row.includes('>688 W</button>') && row.includes('data-meter-slug="Hot_Water"></span>'))
// Off: button OFF, chip empty even if stale readings linger.
run("circuits = []")
run("mergeRest({ circuits: [{name:'Hot Water',slug:'Hot_Water',module:1,channel:1,state:{state:'OFF',power:688.2,current:3.0}}] })")
row = run('circuitRow(circuitBySlug("Hot_Water"))')
assert(row.includes('>OFF</button>') && row.includes('data-meter-slug="Hot_Water"></span>'))
console.log('Webapp live current and REST reconciliation tests passed')
