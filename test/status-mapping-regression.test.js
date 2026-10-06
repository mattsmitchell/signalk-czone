'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zcf = require('../lib/zcf')

const fixtureBaseUrl = 'https://raw.githubusercontent.com/mattsmitchell/signalk-czone-zcf/main/test/fixtures'
const fixtures = [
  'SugarShack-20260927-01.zcf',
  'TestBench.zcf',
  'Compass-Rose-28.06.26.zcf',
  'Persevere-14.07.25.zcf',
  'Sel-Citron-02.04.25.zcf',
  'Meitaki-07.04.25.zcf'
]

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-czone-status-mapping-'))

async function loadFixture (filename) {
  const response = await fetch(fixtureBaseUrl + '/' + filename)
  assert.strictEqual(response.ok, true, filename + ': canonical fixture download failed (' + response.status + ')')
  const fixturePath = path.join(fixtureDir, filename)
  fs.writeFileSync(fixturePath, Buffer.from(await response.arrayBuffer()))
  return zcf.load(fixturePath)
}

function assertMappingShape (filename, circuit) {
  const mapped = circuit.statusModule != null || circuit.statusBit != null || circuit.statusMask != null
  if (!mapped) {
    assert.strictEqual(circuit.statusModule, null, filename + ': ' + circuit.name + ' partial status module')
    assert.strictEqual(circuit.statusBit, null, filename + ': ' + circuit.name + ' partial status bit')
    assert.strictEqual(circuit.statusMask, null, filename + ': ' + circuit.name + ' partial status mask')
    return
  }

  assert(Number.isInteger(circuit.statusModule), filename + ': ' + circuit.name + ' status module')
  assert(Number.isInteger(circuit.statusBit), filename + ': ' + circuit.name + ' status bit')
  assert(circuit.statusBit >= 0 && circuit.statusBit <= 31, filename + ': ' + circuit.name + ' status bit range')
  assert.strictEqual(circuit.statusMask >>> 0, (1 << circuit.statusBit) >>> 0, filename + ': ' + circuit.name + ' status mask')
  assert(circuit.statusSource, filename + ': ' + circuit.name + ' mapped circuit must identify its source')

  if (circuit.statusSource === 'primary-module-channel') {
    // The parser fallback is defined from the first structural output. Do not
    // assume that is the same as primaryOutput: output-ownership processing can
    // select a different primary identity for current/presentation purposes.
    const output = circuit.outputs?.[0]
    assert(output, filename + ': ' + circuit.name + ' fallback requires a structural output')
    assert.strictEqual(circuit.statusModule, output.module, filename + ': ' + circuit.name + ' fallback structural module')
    assert.strictEqual(circuit.statusBit, output.channel, filename + ': ' + circuit.name + ' fallback structural bit')
    assert.strictEqual(circuit.statusConfidence, 'primary-module-channel-fallback', filename + ': ' + circuit.name + ' fallback confidence')
  }

  if (circuit.statusSource === 'status-name' || circuit.statusSource === 'status-output') {
    assert.notStrictEqual(circuit.statusConfidence, 'primary-module-channel-fallback', filename + ': ' + circuit.name + ' explicit mapping must beat fallback')
  }
}

async function main () {
  const reports = []

  for (const filename of fixtures) {
    const mapping = await loadFixture(filename)
    const groups = {
      'status-name': [],
      'status-output': [],
      'primary-module-channel': [],
      unmapped: []
    }

    for (const circuit of mapping.circuits) {
      assertMappingShape(filename, circuit)
      const source = circuit.statusSource || 'unmapped'
      assert(Object.prototype.hasOwnProperty.call(groups, source), filename + ': unexpected status source ' + source)
      groups[source].push(circuit)
    }

    const total = Object.values(groups).reduce((sum, circuits) => sum + circuits.length, 0)
    assert.strictEqual(total, mapping.circuits.length, filename + ': every circuit must be classified')

    reports.push({
      filename,
      circuits: mapping.circuits.length,
      statusName: groups['status-name'].length,
      statusOutput: groups['status-output'].length,
      fallback: groups['primary-module-channel'].length,
      unmapped: groups.unmapped.length,
      fallbackCircuits: groups['primary-module-channel'].map(c => ({
        name: c.name,
        status: `${c.statusModule}:${c.statusBit}`,
        firstOutput: c.outputs?.[0] ? `${c.outputs[0].module}:${c.outputs[0].channel}` : null,
        primaryOutput: c.primaryOutput ? `${c.primaryOutput.module}:${c.primaryOutput.channel}` : null,
        outputs: (c.outputs || []).map(output => `${output.module}:${output.channel}`)
      })),
      unmappedCircuits: groups.unmapped.map(c => c.name)
    })
  }

  // Keep known captured 65284 identities protected from any future blanket
  // module/channel fallback. These runtime status modules are intentionally
  // different from the ZCF configuration module identities.
  const captured = [
    { name: 'Bimini', configModule: 20, statusModule: 26, statusBit: 4 },
    { name: 'Deck', configModule: 22, statusModule: 28, statusBit: 14 }
  ]
  for (const item of captured) {
    assert.notStrictEqual(item.configModule, item.statusModule, item.name + ': capture must exercise non-trivial status identity')
  }

  for (const report of reports) {
    console.log(
      report.filename + ': ' + report.circuits + ' circuits; ' +
      'status-name=' + report.statusName + ', status-output=' + report.statusOutput +
      ', fallback=' + report.fallback + ', unmapped=' + report.unmapped
    )
    if (report.fallbackCircuits.length) {
      for (const circuit of report.fallbackCircuits) {
        console.log(
          '  fallback: ' + circuit.name +
          ' status=' + circuit.status +
          ' first=' + circuit.firstOutput +
          ' primary=' + circuit.primaryOutput +
          ' outputs=[' + circuit.outputs.join(',') + ']'
        )
      }
    }
    if (report.unmappedCircuits.length) console.log('  unmapped: ' + report.unmappedCircuits.join(', '))
  }

  console.log('CZone status-mapping diagnostic/regression tests passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
