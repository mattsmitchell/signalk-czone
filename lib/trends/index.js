'use strict'

// Trend recording.
//
// The plugin hands every decoded value to observe(); this module keeps only
// the latest value of each series and stores it on a fixed beat, so the load
// on the card does not depend on how often CZone repeats itself. What is
// written, where, and for how long is storage.js's business.
//
//   observe(series, value)   latest value of a series (a Signal K path)
//   sample()                 every SAMPLE_MS: the latest values go to the store
//   read(series, range)      for a chart: '24h', or { from, to } in ms; with
//                            `latest` while the series is live
//   status()                 where trends are going, or why they are off
//
// A series that goes quiet for STALE_MS is no longer recorded, so a module
// that drops off the bus leaves a gap in the chart, not a flat line.

const { createTrendStore, sanitizePath, RANGES } = require('./storage')

const SAMPLE_MS = 10e3
const FLUSH_MS = 60e3
const PURGE_MS = 3600e3
const FIRST_PURGE_MS = 15e3
const STALE_MS = 60e3

// A series name becomes a folder name. Only plain Signal K paths are accepted.
function validSeries (series) {
  const s = String(series || '')
  return s.length > 0 && s.length <= 200 && sanitizePath(s) === s && !s.startsWith('.') && !s.includes('..')
}

function createTrends (options = {}) {
  const log = options.log || (() => {})
  const enabled = options.enabled !== false
  const store = enabled
    ? createTrendStore({
        directory: options.directory ? String(options.directory).trim() : null,
        retentionDays: options.retentionDays, // 0 / unset: keep until space runs low
        fallbackDir: options.fallbackDir || null,
        isVenus: options.isVenus,
        mountsProvider: options.mountsProvider,
        spaceProvider: options.spaceProvider,
        log
      })
    : null
  const latest = new Map() // series -> { value, at }
  const timers = []

  function observe (series, value, at = Date.now()) {
    if (!store || typeof value !== 'number' || !Number.isFinite(value)) return
    latest.set(series, { value, at })
  }

  function sample (now = Date.now()) {
    if (!store) return 0
    let recorded = 0
    for (const [series, seen] of latest) {
      if (now - seen.at > STALE_MS) { latest.delete(series); continue }
      store.record(series, seen.value, now)
      recorded++
    }
    return recorded
  }

  function flush () {
    if (!store) return { written: 0 }
    const r = store.flush()
    if (r.written) log(`Trends: wrote ${r.written} samples`)
    return r
  }

  function purge (now = Date.now()) {
    if (!store) return 0
    try { return store.purge(now) } catch (err) { log(`Trend purge failed: ${err.message}`); return 0 }
  }

  // Timers never keep the server (or a test) alive.
  const every = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); timers.push(t) }
  const once = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); timers.push(t) }

  function start () {
    if (!store || timers.length) return
    every(() => sample(), SAMPLE_MS)
    every(flush, FLUSH_MS)
    once(() => purge(), FIRST_PURGE_MS)
    every(() => purge(), PURGE_MS)
    const where = store.status()
    log(where.available ? `Trends: recording to ${where.dir}` : `Trends off: ${where.detail}`)
  }

  // On shutdown the latest values and the open summaries are stored.
  function stop () {
    for (const t of timers) { clearInterval(t); clearTimeout(t) }
    timers.length = 0
    if (!store) return
    try { sample(); store.close() } catch (err) { log(`Trend close failed: ${err.message}`) }
    latest.clear()
  }

  const OFF = { available: false, reason: 'disabled', detail: 'Trend recording is switched off in the plugin configuration.' }

  function read (series, range = '24h') {
    if (!validSeries(series)) return { available: !!store, error: 'bad_path', detail: 'Not a trend path.', data: [] }
    if (!store) return { ...OFF, data: [] }
    const custom = range && typeof range === 'object'
    const result = store.read(series, custom ? range : (RANGES[range] ? range : '24h'))
    // The rows of a long range are averages; the value right now is not.
    const seen = latest.get(series)
    if (seen && Date.now() - seen.at <= STALE_MS) result.latest = { value: seen.value, at: seen.at }
    return result
  }

  function status () {
    const base = { enabled, sampleSeconds: SAMPLE_MS / 1000, trending: latest.size }
    return store ? { ...store.status(), ...base } : { ...OFF, ...base }
  }

  return { observe, sample, flush, purge, start, stop, read, status }
}

module.exports = { createTrends, validSeries, SAMPLE_MS, STALE_MS }
