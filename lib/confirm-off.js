'use strict'

// Confirm before off.
//
// Some circuits must not go off by a slip of a finger: a freezer full of
// stores, or the circuit that powers the display in use (turn Instruments off
// on the chartplotter and the chartplotter goes with it), the Signal K server
// or the network. The ZCF says which output a circuit drives, not what is
// wired to it, so the installer nominates these circuits in the plugin
// configuration.
//
// A nominated circuit:
//  - turns ON from anywhere, never held up;
//  - turns OFF from the webapp only after an "are you sure?";
//  - is not turned off by anything that cannot ask (a Signal K PUT from
//    another app), unless the installer allows it.
// CZone's own keypads and displays are not affected. Modes are not held up
// either: a mode is switched often and on purpose, and what it switches is the
// installer's choice in the CZone configuration.
//
// settings.confirmOff and settings.confirmOn are lists of { circuit }; a plain name is accepted.

const key = s => String(s == null ? '' : s).trim().toLowerCase()

function entriesFor (settings, settingName) {
  const list = settings && Array.isArray(settings[settingName]) ? settings[settingName] : []
  return list
    .map(e => (typeof e === 'string' ? { circuit: e } : e))
    .filter(e => e && key(e.circuit))
    .map(e => ({ circuit: String(e.circuit).trim() }))
}

function entries (settings) {
  return entriesFor(settings, 'confirmOff')
}

// -> { marked: Set(circuit.name), unknown: [names that match no circuit] }
function confirmFor (settings, circuits, settingName) {
  const marked = new Set()
  const unknown = []
  for (const e of entriesFor(settings, settingName)) {
    const hits = (circuits || []).filter(c => key(c.name) === key(e.circuit) || key(c.slug) === key(e.circuit))
    if (!hits.length) { unknown.push(e.circuit); continue }
    for (const c of hits) marked.add(c.name)
  }
  return { marked, unknown }
}

function confirmOffFor (settings, circuits) {
  return confirmFor(settings, circuits, 'confirmOff')
}

function confirmOnFor (settings, circuits) {
  return confirmFor(settings, circuits, 'confirmOn')
}

// The names offered in the plugin configuration: every circuit the webapp
// lists, plus any name already saved that this configuration no longer has,
// so that an old entry never stops the form from saving.
function choicesFor (settings, circuits, settingName) {
  const names = []
  const seen = new Set()
  for (const c of circuits || []) {
    if (c.hidden || c.showInCircuitList === false) continue
    const n = String(c.name).trim()
    if (n && !seen.has(key(n))) { seen.add(key(n)); names.push({ value: n, label: n }) }
  }
  names.sort((a, b) => a.label.localeCompare(b.label))
  for (const e of entriesFor(settings, settingName)) {
    if (!seen.has(key(e.circuit))) { seen.add(key(e.circuit)); names.push({ value: e.circuit, label: `${e.circuit} (not in this configuration)` }) }
  }
  return names
}

function choices (settings, circuits) {
  return choicesFor(settings, circuits, 'confirmOff')
}

function confirmOnChoices (settings, circuits) {
  return choicesFor(settings, circuits, 'confirmOn')
}

module.exports = { confirmOffFor, confirmOnFor, choices, confirmOnChoices, entries }
