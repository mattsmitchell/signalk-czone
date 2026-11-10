'use strict'

// PGN 65301 (CZone Status Ext SC), subtype 0x9F: a module-addressed
// 32-bit bitmap of virtual signals 1-32. Verified for channels 1 and 2 by
// Yacht Devices capture SugarShack-20261111-01-VirtualSwitches.CAN.
// ZCF stores these channels as 32-63; bit 0 corresponds to channel 1.
// The full 32-bit mapping is a format inference, not a 32-channel capture.
const PGN = 65301
const SUBTYPE = 0x9F
const FIRST_ZCF_CHANNEL = 32
const COUNT = 32

function decodeVirtualSignalStatus (frame) {
  if (!frame || frame.pgn !== PGN || !frame.data || frame.data.length !== 8) return null
  const bytes = frame.data
  if (bytes[0] !== 0x27 || bytes[1] !== 0x99 || bytes[3] !== SUBTYPE) return null
  return { module: bytes[2], bitmap: bytes.readUInt32LE(4) >>> 0 }
}

function virtualSignalBit (circuit, module) {
  // Only published, display-controlled virtual signals are eligible.
  // Do not publish multi-output/internal signals or infer anything about DSB inputs.
  if (!circuit || circuit.showInCircuitList !== true ||
    !circuit.virtual || circuit.virtual.virtualOnly !== true ||
    !Array.isArray(circuit.outputs) || circuit.outputs.length !== 1) return null
  const output = circuit.outputs[0]
  if (!output || !Number.isInteger(output.module) || output.module !== module ||
      !Number.isInteger(output.channel)) return null
  const bit = output.channel - FIRST_ZCF_CHANNEL
  return bit >= 0 && bit < COUNT ? bit : null
}

function virtualSignalStates (mapping, status) {
  if (!mapping || !Array.isArray(mapping.circuits) || !status) return []
  const candidates = mapping.circuits
    .map(circuit => ({ circuit, bit: virtualSignalBit(circuit, status.module) }))
    .filter(entry => entry.bit !== null)
  // Never broadcast a guessed state when more than one circuit claims an
  // identical module/channel signal.
  const counts = new Map()
  for (const entry of candidates) counts.set(entry.bit, (counts.get(entry.bit) || 0) + 1)
  return candidates
    .filter(entry => counts.get(entry.bit) === 1)
    .map(({ circuit, bit }) => ({ circuit, enabled: ((status.bitmap >>> bit) & 1) !== 0 }))
}

module.exports = { PGN, SUBTYPE, decodeVirtualSignalStatus, virtualSignalBit, virtualSignalStates }
