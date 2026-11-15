'use strict'

// Monitoring PGNs read straight off a GX's CAN interface with candump.
//
// Signal K hands plugins the frames it receives from other devices, but not
// the frames the GX itself transmits. A Ruuvi tag or other sensor that Venus
// OS sends onto NMEA 2000 (bench, 1 Oct 2026: Ruuvi and Victron temperature
// sensors sent by the Cerbo at address 0x65 as 130312 / 130316) is seen by
// CZone displays and by candump, but never reaches the plugin's
// canboatjs:rawoutput listener. candump sees the wire as a CZone display
// does. The kernel filter passes only the monitoring PGNs, a few frames a
// second.
//
// Only on Venus OS, which ships candump. Anywhere else this is not started.

const { spawn } = require('child_process')

// PGNs: 130312 130313 130314 130316 127505 127506 127508 127503 127504
// 127744-127749. <can_id>:<mask> on data page + PF + PS.
const PGNS = [0x1FD08, 0x1FD09, 0x1FD0A, 0x1FD0C, 0x1F211, 0x1F212, 0x1F214, 0x1F20F, 0x1F210, 0x1F300, 0x1F301, 0x1F302, 0x1F303, 0x1F304, 0x1F305]
const FILTERS = PGNS.map(pgn => `${(pgn << 8).toString(16).toUpperCase().padStart(8, '0')}:01FFFF00`)
const LINE = /\s([0-9A-Fa-f]{8})\s+\[(\d)\]\s+((?:[0-9A-Fa-f]{2}\s*)+)$/

// "  vecan0  0DF21465   [8]  02 2F 05 E7 FF FF FF 00" -> the raw line format
// the plugin already reads ("<time> R <can id> <bytes>").
function parseCandumpLine (line) {
  const m = LINE.exec(String(line).trimEnd())
  if (!m) return null
  return `0 R ${m[1].toUpperCase()} ${m[3].trim()}`
}

function createCandump ({ device = 'vecan0', onLine, log = () => {}, spawnFn = spawn } = {}) {
  let child = null
  let stopped = true
  let restartTimer = null
  let buffer = ''
  const state = { running: false, device, lines: 0, lastLineAt: 0, error: null }

  function launch () {
    if (stopped) return
    try {
      child = spawnFn('candump', [`${device},${FILTERS.join(',')}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      state.running = false
      state.error = err.message
      return
    }
    state.error = null
    child.on('spawn', () => { state.running = true })
    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const raw = parseCandumpLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        if (!raw) continue
        state.lines++
        state.lastLineAt = Date.now()
        try { onLine(raw) } catch (_) {}
      }
    })
    child.stderr.on('data', d => { state.error = d.toString().trim().slice(0, 200) })
    child.on('error', err => {
      state.running = false
      state.error = err.code === 'ENOENT' ? 'candump not installed' : err.message
      child = null
      if (err.code !== 'ENOENT') scheduleRestart()
    })
    child.on('exit', code => {
      state.running = false
      child = null
      if (!stopped && state.error !== 'candump not installed') {
        log(`candump on ${device} exited (${code}); restarting in 30 s`)
        scheduleRestart()
      }
    })
  }

  function scheduleRestart () {
    clearTimeout(restartTimer)
    if (!stopped) restartTimer = setTimeout(launch, 30e3)
  }

  function start () { stopped = false; launch() }

  function stop () {
    stopped = true
    clearTimeout(restartTimer)
    // Never signal without a real pid: a failed spawn can leave pid 0, and
    // kill(0) would hit the whole process group.
    if (child && child.pid > 0) { try { child.kill() } catch (_) {} }
    child = null
    state.running = false
  }

  // Delivering frames now: running, and a frame within the last minute (a
  // candump that started but sees nothing must not hide the other route).
  const delivering = (now = Date.now()) => state.running && now - state.lastLineAt < 60e3

  return { start, stop, delivering, status: () => ({ ...state }) }
}

// Which CAN interface to listen on. CZone has to be on the interface Signal K
// uses for NMEA 2000 (that is how the plugin switches circuits), and that is
// not always vecan0: a Cerbo's CAN 2 port is vecan1. So by default the
// interface comes from Signal K's own connections (settings.json
// pipedProviders: an enabled NMEA 2000 provider of type canbus-canboatjs, or
// the older canbus, and its interface).
//
// The setting: blank, "auto" or "vecan0" (the earlier default, saved with
// every configuration) = automatic. Anything else is used as given.

const DEFAULT_DEVICE = 'vecan0'
const DEVICE_NAME = /^[A-Za-z0-9_.-]{1,15}$/

// The CAN interfaces Signal K's enabled NMEA 2000 connections use.
function signalkCanDevices (skSettings) {
  const out = []
  const providers = skSettings && Array.isArray(skSettings.pipedProviders) ? skSettings.pipedProviders : []
  for (const p of providers) {
    if (!p || p.enabled === false || !Array.isArray(p.pipeElements)) continue
    for (const el of p.pipeElements) {
      const o = el && el.options
      const sub = o && o.subOptions
      if (!o || !/^NMEA2000/.test(String(o.type)) || !sub || (sub.type !== 'canbus-canboatjs' && sub.type !== 'canbus')) continue
      const dev = String(sub.interface || '').trim()
      if (DEVICE_NAME.test(dev) && !out.includes(dev)) out.push(dev)
    }
  }
  return out
}

// -> { device, from: 'setting' | 'signalk' | 'default', signalk: [...] }
function chooseCanDevice (setting, skSettings) {
  const signalk = signalkCanDevices(skSettings)
  const given = String(setting === undefined || setting === null ? '' : setting).trim()
  const automatic = given === '' || given.toLowerCase() === 'auto' || given === DEFAULT_DEVICE
  if (!automatic && DEVICE_NAME.test(given)) return { device: given, from: 'setting', signalk }
  if (signalk.length) return { device: signalk[0], from: 'signalk', signalk }
  return { device: DEFAULT_DEVICE, from: 'default', signalk }
}

module.exports = { createCandump, parseCandumpLine, signalkCanDevices, chooseCanDevice, FILTERS, PGNS }
