'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zcf = require('../lib/zcf')

const files = [
  'SugarShack-20260927-01.zcf',
  'TestBench.zcf',
  'Compass-Rose-28.06.26.zcf',
  'Persevere-14.07.25.zcf',
  'Sel-Citron-02.04.25.zcf',
  'Meitaki-07.04.25.zcf'
]
const base = 'https://raw.githubusercontent.com/mattsmitchell/signalk-czone-zcf/main/test/fixtures/'
const outputKey = output => output.module + ':' + output.channel
const identity = c => ({ id: c.zcfCircuitId, name: c.name, module: c.module, channel: c.channel,
  own: (c.ownOutputs || []).map(outputKey), outputs: (c.outputs || []).map(outputKey),
  controls: c.display?.controlCount || 0, virtualOnly: Boolean(c.virtual?.virtualOnly),
  show: Boolean(c.showInCircuitList), status: c.statusSource || null })

async function main () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'czone-identity-audit-'))
  try {
    for (const file of files) {
      const response = await fetch(base + file)
      assert(response.ok, file + ': download failed ' + response.status)
      const p = path.join(dir, file)
      fs.writeFileSync(p, Buffer.from(await response.arrayBuffer()))
      const mapping = zcf.load(p)
      const circuits = mapping.circuits
      const byName = new Map()
      const byId = new Map()
      const byOutput = new Map()
      for (const c of circuits) {
        if (!byName.has(c.name)) byName.set(c.name, [])
        byName.get(c.name).push(c)
        if (!byId.has(c.zcfCircuitId)) byId.set(c.zcfCircuitId, [])
        byId.get(c.zcfCircuitId).push(c)
        for (const output of c.outputs || []) {
          const k = outputKey(output)
          if (!byOutput.has(k)) byOutput.set(k, [])
          byOutput.get(k).push(c)
        }
      }
      const duplicates = map => [...map.entries()].filter(([, records]) => records.length > 1)
        .map(([key, records]) => ({ key, circuits: records.map(identity) }))
      const shared = duplicates(byOutput)
      const noOwn = circuits.filter(c => c.outputs.length && !c.ownOutputCount)
      const noDisplay = circuits.filter(c => !c.display?.onDisplay)
      const virtualOnly = circuits.filter(c => c.virtual?.virtualOnly)
      const hidden = circuits.filter(c => !c.showInCircuitList)
      const modes = mapping.circuitTable.records.filter(c => c.kind === 'mode')
      const logic = mapping.circuitTable.records.filter(c => c.kind === 'logic')
      const result = {
        file, circuits: circuits.length, logicRecords: logic.map(c => ({id:c.id,name:c.name})),
        modeRecords: modes.map(c => ({id:c.id,name:c.name})),
        duplicateNames: duplicates(byName), duplicateIds: duplicates(byId),
        sharedOutputs: shared, noOwnOutputs: noOwn.map(identity),
        virtualOnly: virtualOnly.map(identity), noDisplayControls: noDisplay.map(identity),
        hiddenFromCircuitList: hidden.map(identity)
      }
      console.log('AUDIT_JSON ' + JSON.stringify(result))
    }
  } finally {
    fs.rmSync(dir, {recursive:true,force:true})
  }
}

main().catch(e => {console.error(e);process.exitCode = 1})
