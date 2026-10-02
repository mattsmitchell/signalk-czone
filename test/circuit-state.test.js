'use strict'

const assert = require('assert')
const state = require('../lib/circuit-state')

assert.deepStrictEqual(state.decodeDcLevel(0x0400), { state: 'OFF', percent: 0 })
assert.deepStrictEqual(state.decodeDcLevel(0x05f4), { state: 'DIMMED', percent: 50 })
assert.deepStrictEqual(state.decodeDcLevel(0x07e8), { state: 'ON', percent: 100 })

const payload = Buffer.alloc(28)
payload[0] = 0x27; payload[1] = 0x99; payload[2] = 0x14; payload[3] = 2
payload[4] = 60; payload[5] = 0xe8; payload[6] = 0x07
const decoded = state.decodeDcPacket(payload)
assert.strictEqual(decoded.module, 0x14)
assert.strictEqual(decoded.page, 2)
assert.strictEqual(decoded.values[0].currentRaw, 60)
assert.strictEqual(decoded.values[0].percent, 100)

const status = state.decodeCircuitStatus(Buffer.from('2799141f02000000', 'hex'))
assert.strictEqual(state.circuitEnabled(status, { statusModule: 0x14, statusBit: 1 }), true)
assert.strictEqual(state.circuitEnabled(status, { statusModule: 0x14, statusMask: 0x04 }), false)
assert.strictEqual(state.circuitEnabled(status, { statusModule: 0x15, statusBit: 1 }), null)

console.log('CZone circuit state decoder tests passed')
