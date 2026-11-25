'use strict'

// PGN 65301 (CZone Status Ext SC): a module-addressed report of the on/off
// state of the Configuration Tool's "virtual signals". The ZCF stores these as
// channels 32-63 (Configuration Tool virtual signals 1-32).
//
// Two on-the-wire forms are seen, selected by the byte after the module
// (payload byte 3):
//
//   Single-frame (byte 3 = 0x9F): a 32-bit bitmap of channels 32-63 in bytes
//     4-7; bit 0 = channel 32. Verified for channels 1-2 by the Yacht Devices
//     capture SugarShack-20261111-01-VirtualSwitches.CAN (a Signal Interface).
//     The full 32-bit mapping is a format inference.
//
//   Paged (byte 3 = page << 5, i.e. the low 5 bits are 0, page 0-7): byte 4
//     carries 8 channel states for that page, channel = page*8 + bit. Each
//     frame reports only its own page; a module advertises all 8 pages in
//     rotation (~2 s cycle). Bytes 5-7 are unused (8 pages x 8 = 64 channels
//     covers the whole CZone channel space). Verified on a Control X Plus
//     against VS 10 (module 2, channel 41 -> page 5 bit 1) and VS 11 (module 1,
//     channel 42 -> page 5 bit 2), Compass Rose 25 Nov 2026.
const PGN = 65301
const SUBTYPE = 0x9F
const FIRST_ZCF_CHANNEL = 32
const COUNT = 32
const PAGE_CHANNELS = 8

function decodeVirtualSignalStatus (frame) {
  if (!frame || frame.pgn !== PGN || !frame.data || frame.data.length !== 8) return null
  const bytes = frame.data
  if (bytes[0] !== 0x27 || bytes[1] !== 0x99) return null
  const selector = bytes[3]
  if (selector === SUBTYPE) {
    // Single-frame form: every channel 32-63 in one 32-bit bitmap.
    return { module: bytes[2], bitmap: bytes.readUInt32LE(4) >>> 0 }
  }
  if ((selector & 0x1f) === 0) {
    // Paged form: byte 3 = page<<5, byte 4 = the 8 channel states of that page.
    return { module: bytes[2], page: selector >>> 5, bits: bytes[4] }
  }
  return null
}

// The absolute ZCF channel (32-63) of a circuit eligible to be published as a
// virtual signal, or null. Only published, display-controlled, single-output
// virtual signals qualify; do not publish multi-output/internal signals or
// infer anything about DSB inputs.
function eligibleChannel (circuit, module) {
  if (!circuit || circuit.showInCircuitList !== true ||
    !circuit.virtual || circuit.virtual.virtualOnly !== true ||
    !Array.isArray(circuit.outputs) || circuit.outputs.length !== 1) return null
  const output = circuit.outputs[0]
  if (!output || !Number.isInteger(output.module) || output.module !== module ||
      !Number.isInteger(output.channel)) return null
  const channel = output.channel
  return channel >= FIRST_ZCF_CHANNEL && channel < FIRST_ZCF_CHANNEL + COUNT ? channel : null
}

// Kept for compatibility: the single-frame bitmap bit (0-31) for a circuit, or
// null when it is not an eligible virtual signal on this module.
function virtualSignalBit (circuit, module) {
  const channel = eligibleChannel(circuit, module)
  return channel === null ? null : channel - FIRST_ZCF_CHANNEL
}

function virtualSignalStates (mapping, status) {
  if (!mapping || !Array.isArray(mapping.circuits) || !status) return []
  const paged = Number.isInteger(status.page)
  const pageBase = paged ? status.page * PAGE_CHANNELS : 0
  const candidates = mapping.circuits
    .map(circuit => ({ circuit, channel: eligibleChannel(circuit, status.module) }))
    .filter(entry => entry.channel !== null)
    // A paged frame carries only the 8 channels of its own page.
    .filter(entry => !paged || (entry.channel >= pageBase && entry.channel < pageBase + PAGE_CHANNELS))
  // Never broadcast a guessed state when more than one circuit claims an
  // identical module/channel signal.
  const counts = new Map()
  for (const entry of candidates) counts.set(entry.channel, (counts.get(entry.channel) || 0) + 1)
  return candidates
    .filter(entry => counts.get(entry.channel) === 1)
    .map(({ circuit, channel }) => {
      const enabled = paged
        ? ((status.bits >>> (channel - pageBase)) & 1) !== 0
        : ((status.bitmap >>> (channel - FIRST_ZCF_CHANNEL)) & 1) !== 0
      return { circuit, enabled }
    })
}

module.exports = { PGN, SUBTYPE, decodeVirtualSignalStatus, virtualSignalBit, virtualSignalStates }
