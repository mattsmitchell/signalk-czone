'use strict'

const zcfLibrary = require('signalk-czone-zcf')

const CURRENT_PGN_DC = 130822
const CURRENT_PGN_AC = 130817

function slugify (name) {
  const text = String(name || 'CZoneCircuit').trim()
  const cleaned = text.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'CZoneCircuit'
}

function uniqueSlugs (items) {
  const used = new Map()
  for (const item of items) {
    const base = slugify(item.name)
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    item.slug = count === 1 ? base : `${base}${count}`
  }
  return items
}

function signalKPaths (slug, capabilities) {
  const paths = { state: `electrical.czone.${slug}.switch.state` }
  if (capabilities && capabilities.dimmer) paths.brightness = `electrical.czone.${slug}.switch.brightness`
  return paths
}

function circuitSource (circuit) {
  if (Number(circuit.module) === 0xF8) return 'CZone-AC.11'
  return `CZone-DC.${Number(circuit.module)}`
}

const VERIFIED_CONTROL_PROFILES = Object.freeze({
  0x73: { parameter: 0x24, family: 'f1f2', confidence: 'capture' },
  0x21: { parameter: 0x24, family: 'f1f2', confidence: 'capture' },
  0x35: { parameter: 0x24, family: 'f1f2', confidence: 'capture' },
  0x2E: { parameter: 0x08, family: 'f1f2', confidence: 'capture' },
  0x29: { parameter: 0x08, family: 'f1f2', confidence: 'capture' },
  0x1B: { parameter: 0x08, family: 'level', confidence: 'capture' },
  0x65: { parameter: 0x08, family: 'level', confidence: 'capture' }
})

function enrichRuntimeModel (mapping) {
  mapping.circuits = uniqueSlugs(mapping.circuits.map(circuit => {
    const profile = VERIFIED_CONTROL_PROFILES[circuit.zcfCircuitId] ||
      (circuit.capabilities.dimmer
        ? { parameter: 0x24, family: 'level', confidence: 'zcf-dimmer-capture' }
        : { parameter: 0x08, family: 'f1f2', confidence: 'zcf-derived' })

    return {
      ...circuit,
      source: circuit.module === null ? 'CZone-Unknown' : circuitSource(circuit),
      protocolCircuitId: circuit.zcfCircuitId,
      protocolParameter: profile.parameter,
      protocolOperationFamily: profile.family,
      protocolConfidence: profile.confidence,
      signalK: signalKPaths(slugify(circuit.name), circuit.capabilities)
    }
  }))

  mapping.currentMappings = mapping.circuits
    .map(circuit => {
      if (Number(circuit.module) === 0x28) return null
      return {
        ...circuit,
        pgn: Number(circuit.module) === 0xF8 ? CURRENT_PGN_AC : CURRENT_PGN_DC,
        scale_A_per_bit: Number(circuit.module) === 0xF8 ? 0.2 : 0.1
      }
    })
    .filter(Boolean)

  return mapping
}

function classifyCurrentMapping (circuit) {
  if (Number(circuit.module) === 0xF8) return { pgn: CURRENT_PGN_AC, scale_A_per_bit: 0.2 }
  if (Number(circuit.module) === 0x28) return null
  return { pgn: CURRENT_PGN_DC, scale_A_per_bit: 0.1 }
}

function lookup (mapping, module, page, slot, pgn) {
  if (!mapping || !Array.isArray(mapping.currentMappings)) return null
  return mapping.currentMappings.find(x =>
    Number(x.module) === Number(module) &&
    Number(x.page) === Number(page) &&
    Number(x.slot) === Number(slot) &&
    (pgn === undefined || Number(x.pgn) === Number(pgn))
  ) || null
}

function parse (buffer) {
  return enrichRuntimeModel(zcfLibrary.parse(buffer))
}

function load (filePath) {
  return enrichRuntimeModel(zcfLibrary.load(filePath))
}

module.exports = {
  ...zcfLibrary,
  CURRENT_PGN_DC,
  CURRENT_PGN_AC,
  classifyCurrentMapping,
  parse,
  load,
  lookup
}
