'use strict'

function delta (path, value, source = 'signalk-czone') {
  const sourceInfo = typeof source === 'string'
    ? { label: source, type: 'CZone' }
    : { ...source }
  return {
    context: 'vessels.self',
    updates: [{
      source: sourceInfo,
      timestamp: new Date().toISOString(),
      values: [{ path, value }]
    }]
  }
}

function statePath (circuit) {
  return `electrical.czone.${circuit.slug}.switch.state`
}

function brightnessPath (circuit) {
  return `electrical.czone.${circuit.slug}.switch.brightness`
}

function nmea2000Source (src, pgn) {
  return {
    label: 'CZone-DC',
    type: 'NMEA2000',
    src: String(src),
    pgn: Number(pgn)
  }
}

function circuitDelta (path, value, circuit, sourceOverride = null) {
  return delta(path, value, sourceOverride || (circuit && circuit.source) || 'signalk-czone')
}

module.exports = { delta, statePath, brightnessPath, nmea2000Source, circuitDelta }
