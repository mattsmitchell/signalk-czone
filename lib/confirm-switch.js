'use strict'

const key = s => String(s == null ? '' : s).trim().toLowerCase()

function entries (settings, settingName) {
  const list = settings && Array.isArray(settings[settingName]) ? settings[settingName] : []
  return list
    .map(e => (typeof e === 'string' ? { circuit: e } : e))
    .filter(e => e && key(e.circuit))
    .map(e => ({ circuit: String(e.circuit).trim() }))
}

function confirmFor (settings, circuits, settingName) {
  const marked = new Set()
  const unknown = []
  for (const e of entries(settings, settingName)) {
    const hits = (circuits || []).filter(c => key(c.name) === key(e.circuit) || key(c.slug) === key(e.circuit))
    if (!hits.length) { unknown.push(e.circuit); continue }
    for (const c of hits) marked.add(c.name)
  }
  return { marked, unknown }
}

function choices (settings, circuits, settingName) {
  const names = []
  const seen = new Set()
  for (const c of circuits || []) {
    if (c.hidden || c.showInCircuitList === false) continue
    const n = String(c.name).trim()
    if (n && !seen.has(key(n))) { seen.add(key(n)); names.push({ value: n, label: n }) }
  }
  names.sort((a, b) => a.label.localeCompare(b.label))
  if (settingName) {
    for (const e of entries(settings, settingName)) {
      if (!seen.has(key(e.circuit))) {
        seen.add(key(e.circuit))
        names.push({ value: e.circuit, label: `${e.circuit} (not in this configuration)` })
      }
    }
  }
  return names
}

function schema (settings, circuits, settingName, title) {
  const names = choices(settings, circuits, settingName)
  return {
    type: 'array',
    title,
    default: [],
    items: {
      type: 'object',
      required: ['circuit'],
      properties: {
        circuit: names.length
          ? { type: 'string', title: 'Circuit', enum: names.map(n => n.value), enumNames: names.map(n => n.label) }
          : { type: 'string', title: 'Circuit (name as in the CZone configuration)' }
      }
    }
  }
}

module.exports = { confirmFor, choices, entries, schema }
