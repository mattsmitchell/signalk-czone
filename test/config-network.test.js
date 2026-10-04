'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const pluginFactory = require('../index')
const czone = require('../lib/czone')
const zcf = require('../lib/zcf')

const sourceZcf = path.join(__dirname, 'fixtures', 'SugarShack-20260927-01.zcf')
if (!fs.existsSync(sourceZcf)) {
  console.log('Network configuration tests skipped: live ZCF not present')
  process.exit(0)
}

const configPath = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-czone-network-'))
const rawListeners = new Map()
const emitted = []
const routes = { get: new Map(), post: new Map() }
const app = {
  config: { configPath },
  isNmea2000OutAvailable: true,
  on: (event, fn) => rawListeners.set(event, fn),
  removeListener: (event) => rawListeners.delete(event),
  emit: (event, line) => { if (event === 'nmea2000out') emitted.push(line) },
  debug: () => {},
  setPluginStatus: () => {},
  registerPutHandler: () => {},
  handleMessage: () => {},
  getSelfPath: p => p === 'name' ? 'Signal K Vessel' : undefined
}

const plugin = pluginFactory(app)
plugin.start({ allowCzoneWrite: true })
plugin.registerWithRouter({
  get: (p, fn) => routes.get.set(p, fn),
  post: (p, fn) => routes.post.set(p, fn)
})

assert(routes.post.has('/configuration/network/read'))
const response = () => {
  const result = { statusCode: 200, body: null }
  return {
    result,
    status(code) { result.statusCode = code; return this },
    json(body) { result.body = body; return this }
  }
}

const readRes = response()
routes.post.get('/configuration/network/read')({}, readRes)
assert.strictEqual(readRes.result.statusCode, 202)
assert.strictEqual(readRes.result.body.ok, true)
assert(emitted.some(line => line.split(',')[2] === '65290' && line.endsWith(',27,99,00,00,00,00,c0,ff')))

function fastFrames (pgn, source, payload, sequence = 0) {
  const frames = []
  const first = payload.subarray(0, 6)
  const canId = pgn === 130816 ? (0x1CFF0000 | source) : (0x1C000000 | ((pgn & 0xffff) << 8) | source)
  frames.push(`2026-09-27T06:00:00.000Z R ${canId.toString(16).padStart(8, '0')} ${(sequence << 5).toString(16).padStart(2, '0')} ${payload.length.toString(16).padStart(2, '0')} ${Array.from(first, b => b.toString(16).padStart(2, '0')).join(' ')}`)
  let offset = 6
  let frameNo = 1
  while (offset < payload.length) {
    const chunk = payload.subarray(offset, offset + 7)
    frames.push(`2026-09-27T06:00:00.000Z R ${canId.toString(16).padStart(8, '0')} ${((sequence << 5) | frameNo).toString(16).padStart(2, '0')} ${Array.from(chunk, b => b.toString(16).padStart(2, '0')).join(' ')}`)
    offset += chunk.length
    frameNo++
  }
  return frames
}

const original = fs.readFileSync(sourceZcf)
const target = 0xF8
const chunkSize = 200
let seq = 0
for (let block = 0; block < Math.ceil(original.length / chunkSize); block++) {
  const chunk = original.subarray(block * chunkSize, Math.min(original.length, (block + 1) * chunkSize))
  const payload = Buffer.alloc(23 + chunk.length)
  payload[0] = 0x27; payload[1] = 0x99
  payload.writeUInt16LE(block, 2)
  payload[4] = target
  chunk.copy(payload, 23)
  for (const frame of fastFrames(130816, 11, payload, seq++ & 0x07)) rawListeners.get('canboatjs:rawoutput')(frame)
}
const terminator = Buffer.from([0x27, 0x99, 0x4d, 0x00, target, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
for (const frame of fastFrames(130816, 11, terminator, seq++ & 0x07)) rawListeners.get('canboatjs:rawoutput')(frame)

const statusRes = response()
routes.get.get('/configuration/network/status')({}, statusRes)
assert.strictEqual(statusRes.result.body.read.status, 'complete')
assert.strictEqual(statusRes.result.body.read.bytes, original.length)
assert.strictEqual(statusRes.result.body.read.vesselName, 'Sugar Shack-20260927-01')
assert(statusRes.result.body.read.file.endsWith('.czone.net'))
assert(!statusRes.result.body.read.file.endsWith('.zcf'))
const saved = path.join(configPath, 'plugin-config-data', 'signalk-czone', 'network-configs', statusRes.result.body.read.file)
assert(fs.existsSync(saved))
assert.deepStrictEqual(fs.readFileSync(saved), original)
assert(fs.existsSync(`${saved}.json`))
const parsed = zcf.load(saved)
assert.strictEqual(parsed.vesselName, 'Sugar Shack-20260927-01')
const configurationRes = response()
routes.get.get('/configuration')( {}, configurationRes )
assert.strictEqual(configurationRes.result.body.installedZcf.exists, false)
const ackCount = emitted.filter(line => line.split(',')[2] === '65291').length
assert.strictEqual(ackCount, Math.ceil(original.length / chunkSize) + 1)

const readAgainRes = response()
routes.post.get('/configuration/network/read')({}, readAgainRes)
assert.strictEqual(readAgainRes.result.statusCode, 202)
plugin.stop()
console.log('CZone network configuration read/reassembly/save tests passed')
