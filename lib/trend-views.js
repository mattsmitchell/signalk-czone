'use strict'

// Saved trend views.
//
// A view is just a definition — a name, the list of value paths on the chart,
// and the overlay/stacked and range choices. It holds no trend data and does
// no work: it is read when the webapp lists views and written when one is
// saved or removed. Views are stored once on the server (a small JSON file in
// the plugin data folder, never the trend SD card), so they are the same on
// every device and browser, including the plotter.

const fs = require('fs')
const path = require('path')

const MAX_VIEWS = 50
const MAX_SERIES = 5
const MODES = ['overlay', 'stacked']

const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max)

// A view from the webapp, reduced to what is stored: a name, up to five
// distinct paths, a known mode and a range. Returns null if there is no name
// or no value.
function sanitize (view) {
  if (!view || typeof view !== 'object') return null
  const name = clean(view.name, 80)
  if (!name) return null
  const seen = new Set()
  const series = []
  for (const s of Array.isArray(view.series) ? view.series : []) {
    const p = clean(typeof s === 'string' ? s : s && s.path, 200)
    if (!p || seen.has(p)) continue
    seen.add(p)
    series.push({ path: p })
    if (series.length >= MAX_SERIES) break
  }
  if (!series.length) return null
  const mode = MODES.includes(view.mode) ? view.mode : 'overlay'
  const range = clean(view.range, 20) || '24h'
  return { name, series, mode, range }
}

function createTrendViews ({ dir, log = () => {} }) {
  const file = path.join(dir, 'trend-views.json')
  let views = []
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(raw)) views = raw.filter(v => v && v.id && v.name && Array.isArray(v.series) && v.series.length)
  } catch (e) { views = [] }

  function persist () {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(views, null, 2))
    } catch (e) { log(`Trend views: could not save (${e.message})`) }
  }

  const newId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  function list () { return views.map(v => ({ ...v })) }

  // Save a new view, or replace one by its id (a rename or an update).
  function save (input) {
    const v = sanitize(input)
    if (!v) throw new Error('A view needs a name and at least one value.')
    const id = input && input.id && views.some(x => x.id === input.id) ? input.id : newId()
    const rec = { id, ...v, updatedAt: new Date().toISOString() }
    const i = views.findIndex(x => x.id === id)
    if (i >= 0) views[i] = rec
    else {
      if (views.length >= MAX_VIEWS) throw new Error(`At most ${MAX_VIEWS} saved views.`)
      views.push(rec)
    }
    persist()
    return rec
  }

  function remove (id) {
    const before = views.length
    views = views.filter(v => v.id !== id)
    const removed = views.length !== before
    if (removed) persist()
    return removed
  }

  return { list, save, remove, file }
}

module.exports = { createTrendViews, sanitize, MAX_VIEWS, MAX_SERIES }
