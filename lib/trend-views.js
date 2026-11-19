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
  const out = { name, series, mode, range }
  // A custom range keeps its from/to, so the view reopens on the same period.
  // Without a valid window it falls back to a rolling 24 h.
  if (range === 'custom') {
    const from = Number(view.from)
    const to = Number(view.to)
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) { out.from = from; out.to = to } else out.range = '24h'
  }
  return out
}

function createTrendViews ({ dir, log = () => {} }) {
  const file = path.join(dir, 'trend-views.json')
  let views = []
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(raw)) views = raw.filter(v => v && v.id && v.name && Array.isArray(v.series) && v.series.length)
  } catch (e) { views = [] }

  // Write the given list atomically (temp file, then rename). Throws on
  // failure, so the caller only commits the in-memory change once the bytes
  // are safely on disk — a view is never reported saved when the write failed.
  function persist (list) {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
      fs.renameSync(tmp, file)
    } catch (e) {
      try { fs.unlinkSync(tmp) } catch (e2) {}
      log(`Trend views: could not save (${e.message})`)
      const err = new Error(`Could not save views to ${file}: ${e.message}`)
      err.status = 500
      throw err
    }
  }

  const newId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  function list () { return views.map(v => ({ ...v })) }

  // Save a new view, or replace one by its id (a rename or an update). The new
  // list is written first; only on success does it become the live list.
  function save (input) {
    const v = sanitize(input)
    if (!v) throw new Error('A view needs a name and at least one value.')
    const id = input && input.id && views.some(x => x.id === input.id) ? input.id : newId()
    const rec = { id, ...v, updatedAt: new Date().toISOString() }
    const next = views.slice()
    const i = next.findIndex(x => x.id === id)
    if (i >= 0) next[i] = rec
    else {
      if (next.length >= MAX_VIEWS) throw new Error(`At most ${MAX_VIEWS} saved views.`)
      next.push(rec)
    }
    persist(next)
    views = next
    return rec
  }

  function remove (id) {
    if (!views.some(v => v.id === id)) return false
    const next = views.filter(v => v.id !== id)
    persist(next)
    views = next
    return true
  }

  return { list, save, remove, file }
}

module.exports = { createTrendViews, sanitize, MAX_VIEWS, MAX_SERIES }
