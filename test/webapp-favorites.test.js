'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
const section = (start, end) => {
  assert(html.includes(start) && html.includes(end), `markers: ${start}`)
  return html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)))
}
const storage = new Map([['signalk-czone-circuits:favorites', '["local"]']])
const elements = {}
function page () {
  const context = vm.createContext({
    window: {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: id => (elements[id] ||= {}) },
    circuits: [
      { name: 'ShowerTime', slug: 'shower', categories: { master: ['Favorites', 'DC'] } },
      { name: 'Local favorite', slug: 'local' },
      { name: 'Other', slug: 'other', categories: { master: ['DC'] } }
    ],
    view: 'favorites', category: null, query: '', sort: 'name', MFD: false,
    monitor: { items: [] }, render: () => {}, stateOf: () => false, percentOf: () => null
  })
  vm.runInContext(section('  const favoritesKey =', '  const esc =') +
    section('  const nameKey =', '  const stateOf =') +
    section('  const categoryData =', '  const catList =') +
    section('  const activeCount =', '  const subCategoryList =') +
    section('  function saveFavorites()', '  function setView(') +
    section('  function renderNav()', '  function renderCategories()') +
    section('  function currentList()', '  function renderCircuits()') +
    section('  window.toggleFavorite =', '  // ---- Trends'), context)
  return code => vm.runInContext(code, context)
}

let run = page()
assert.strictEqual(run('circuits.filter(isFavorite).length'), 2)
assert.strictEqual(run('currentList().map(c => c.slug).join(",")'), 'local,shower')
run('renderNav()')
assert(elements['#mainNav'].innerHTML.includes('Favorites<span class="nav-count">2</span>'))
run('window.toggleFavorite("shower")')
assert.strictEqual(run('isFavorite(circuits[0])'), false)
run = page()
assert.strictEqual(run('isFavorite(circuits[0])'), false, 'ZCF favorite removal survives reload')
assert.strictEqual(run('isFavorite(circuits[1])'), true, 'existing browser favorites preserved')
run('window.toggleFavorite("shower"); window.toggleFavorite("other")')
assert.strictEqual(run('circuits.filter(isFavorite).length'), 3)
run('window.toggleFavorite("local")')
run = page()
assert.strictEqual(run('isFavorite(circuits[1])'), false)
assert.strictEqual(run('isFavorite(circuits[0])'), true)
assert.strictEqual(run('isFavorite(circuits[2])'), true)
run('circuits[1].categories = {master: ["Favorites"]}')
assert.strictEqual(run('isFavorite(circuits[1])'), false, 'local removal overrides later ZCF imports')
console.log('Webapp ZCF and browser favorites tests passed')
