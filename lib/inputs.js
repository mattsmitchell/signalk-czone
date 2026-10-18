'use strict'

// CZone switch inputs: ON / OFF of each switch wired to a CZone module, from
// the module's own messages. The inputs and their wiring come from the ZCF's
// signal-input table (signalk-czone-zcf parseSignalInputs).
//
// PGN 65284 (0xFF04), module status, about every two seconds and on change:
//   27 99 <module dipswitch> <module kind> <bitmap, 32 bits, low byte first>
// PGN 65308 (0xFF1C), input message, sent on change:
//   27 99 <module dipswitch> <variant> <bitmap, 32 bits, low byte first>
//
// Where an input sits depends on the kind of module (its type in the ZCF):
//
// Signal Interface (0x0D). Test bench, 6 Oct 2026: module 2, five switches on
// inputs 0-4 closed one after another gave 02 00, 0A 00, 2A 00, AA 00, AA 02:
// input n (from 0) is bit 2n+1, in 65284 and in 65308 (variant 00). The
// message comes on change too, so a tap on a momentary switch is caught.
//
// COI (0x1F). SugarShack capture, 27 Sep 2026: a COI's 65284 carries its
// outputs only; its inputs are in 65308 (variant 03), numbered from 16 in
// the ZCF, input i at bit 2(i-16)+1. Module 1A input 19 -> 80 00, 1A input
// 20 -> 00 02, 1C input 17 -> 08 00.
//
// Control X PLUS (0x36). Compass Rose, 15 Oct 2026, each input operated twice:
// its 65284 has the outputs in bits 0-15 and the inputs above, input i (from
// 16 in the ZCF) at bit i when it switches to positive, bit i+1 when it
// switches to negative. Anchor Up (input 17, to +) bit 17; Ignition (24, to +)
// bit 24; High Bilge Water Alarm (18, to -) bit 19. Only one input to
// negative was seen. Its 65308 messages come in four variants (byte 3: 00,
// 01, 03, 06) and are not read.
//
// Other kinds: not decoded (no state rather than a guess).

const STATUS_PGN = 65284
const INPUT_PGN = 65308

const oddBits = first => input => 2 * (input - first) + 1
const LAYOUT = {
  0x0d: { name: 'Signal Interface', pgns: [STATUS_PGN, INPUT_PGN], first: 0, bit: oddBits(0) },
  0x1f: { name: 'COI', pgns: [INPUT_PGN], first: 16, bit: oddBits(16) },
  0x36: { name: 'Control X PLUS', pgns: [STATUS_PGN], first: 16, bit: (input, wiring) => input + (wiring === 'switchToNeg' ? 1 : 0) }
}

// data: 8 bytes of a 65284 or 65308 frame -> { module, variant, bitmap } or null
function decodeFrame (data) {
  if (!data || data.length !== 8 || data[0] !== 0x27 || data[1] !== 0x99) return null
  return { module: data[2], variant: data[3], bitmap: data.readUInt32LE(4) }
}

// true / false, or undefined when this kind of module or message does not
// carry the input.
function inputState (kind, bitmap, input, pgn, wiring) {
  const layout = LAYOUT[kind]
  if (!layout || !Number.isInteger(input) || !layout.pgns.includes(pgn)) return undefined
  if (input < layout.first) return undefined
  const bit = layout.bit(input, wiring)
  if (bit > 31) return undefined
  return ((bitmap >>> bit) & 1) === 1
}

function slugify (name) {
  const cleaned = String(name || 'Input').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'Input'
}

// The switch inputs of a loaded configuration, each with its Signal K path
// (electrical.czone.inputs.<name>.state) and its module's kind.
function switchInputs (mapping) {
  const table = mapping && mapping.signalInputs
  if (!table || !Array.isArray(table.inputs)) return []
  const kinds = new Map((mapping.modules || []).filter(m => Number.isInteger(m.module)).map(m => [m.module, m.type]))
  const used = new Map()
  return table.inputs
    .filter(i => i.type === 'switch' && Number.isInteger(i.module) && i.module !== 0)
    .map(i => {
      const base = slugify(i.name)
      const count = (used.get(base) || 0) + 1
      used.set(base, count)
      const slug = count === 1 ? base : `${base}${count}`
      const kind = kinds.get(i.module)
      return {
        name: String(i.name).trim(),
        slug,
        path: `electrical.czone.inputs.${slug}.state`,
        module: i.module,
        input: i.input,
        wiring: i.wiring,
        moduleKind: Number.isInteger(kind) ? kind : null,
        decoded: Boolean(LAYOUT[kind])
      }
    })
}

module.exports = { STATUS_PGN, INPUT_PGN, LAYOUT, decodeFrame, inputState, switchInputs }
