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
const toggle = { textContent: '' }
const context = vm.createContext({
  console, CSS: { escape: s => s },
  document: { querySelector: () => toggle },
  pending: new Map(), favorites: new Set(), status: {},
  circuits: [{ name: 'Galley Lights', slug: 'Galley_Lights', module: 20, channel: 1, state: { state: 'ON' } }],
  nameKey: c => c.name, circuitBySlug: slug => context.circuits.find(c => c.slug === slug),
  stateOf: c => c.state.state === 'ON', percentOf: c => c.state.percent,
  categoryData: () => ({ master: [] }), subCategoryList: () => [],
  askMark: () => '', tempChip: () => '', esc: s => s
})
vm.runInContext(
  section('  const currentOf =', '  const categoryData =') +
  section('  function circuitRow(', '  function previewPercent(') +
  section('  function applySocketValue(', '  async function refreshOnce('), context)
const run = code => vm.runInContext(code, context)
run("applySocketValue('electrical.czone.Galley_Lights.current', 6.2)")
assert.strictEqual(toggle.textContent, '6.2 A')
run("mergeRest({ circuits: [{name:'Galley Lights',slug:'Galley_Lights',module:20,channel:1,state:{state:'ON'}}] })")
assert(run('circuitRow(circuits[0])').includes('>6.2 A</button>'))
run("mergeRest({ circuits: [{name:'Galley Lights',slug:'Galley_Lights',module:20,channel:1,state:{state:'ON',current:0}}] })")
assert(run('circuitRow(circuits[0])').includes('>ON</button>'))
run("applySocketValue('electrical.czone.Galley_Lights.current', 2.5)")
run("mergeRest({ circuits: [{name:'Galley Lights',slug:'Galley_Lights',module:20,channel:1,state:{state:'OFF'}}] })")
assert(run('circuitRow(circuits[0])').includes('>OFF</button>'))
console.log('Webapp live current and REST reconciliation tests passed')
