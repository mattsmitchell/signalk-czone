'use strict'

// Tank, temperature and pressure senders from the ZCF's Inputs table, and the
// standard NMEA 2000 PGNs that carry their readings. A sender wired to a
// CZone module is broadcast by that module; a third-party sender (module 0)
// is any other device using the instance set in the Configuration Tool, such
// as a Ruuvi tag bridged by a GX or by Signal K. Either way the ZCF gives the
// instance (and the source or fluid type), and the same numbers are in the
// PGN, so a sender added in the Configuration Tool shows as soon as the ZCF
// is loaded.
//
//   130312 Temperature                 SID, instance, source, temp u16 0.01 K
//   130316 Temperature, Extended Range SID, instance, source, temp u24 0.001 K
//   130313 Humidity                    SID, instance, source, humidity i16 0.004 %
//   130314 Actual Pressure             SID, instance, source, pressure i32 0.1 Pa
//   127505 Fluid Level                 instance:4 | type:4, level i16 0.004 %, capacity u32 0.1 L
//
// Humidity is not a sender type in the Configuration Tool. A humidity reading
// on the instance of a temperature sender (a Ruuvi tag sends both) is shown
// with that temperature.

const SENSOR_PGNS = new Set([130312, 130313, 130314, 130316, 127505])

// The top values of every NMEA 2000 field mean "no data": all ones is not
// available, one below is out of range, one below that is reserved.
const noU = (v, bits) => v >= 2 ** bits - 3
const noI = (v, bits) => v >= 2 ** (bits - 1) - 3

// Values in Signal K units: K, ratio, Pa, m³.
function decodeSensorFrame (pgn, d) {
  if (!Buffer.isBuffer(d) || d.length < 7) return []
  if (pgn === 130312) {
    const raw = d.readUInt16LE(3)
    return noU(raw, 16) ? [] : [{ kind: 'temperature', instance: d[1], source: d[2], field: 'temperature', value: raw / 100 }]
  }
  if (pgn === 130316) {
    const raw = d[3] | (d[4] << 8) | (d[5] << 16)
    return noU(raw, 24) ? [] : [{ kind: 'temperature', instance: d[1], source: d[2], field: 'temperature', value: raw / 1000 }]
  }
  if (pgn === 130313) {
    const raw = d.readInt16LE(3)
    return noI(raw, 16) ? [] : [{ kind: 'humidity', instance: d[1], source: d[2], field: 'relativeHumidity', value: Math.round(raw * 4) / 1e5 }]
  }
  if (pgn === 130314) {
    const raw = d.readInt32LE(3)
    return noI(raw, 32) ? [] : [{ kind: 'pressure', instance: d[1], source: d[2], field: 'pressure', value: raw / 10 }]
  }
  if (pgn === 127505) {
    const instance = d[0] & 0x0f
    const fluid = d[0] >> 4
    const level = d.readInt16LE(1)
    if (noI(level, 16)) return []
    const ratio = Math.round(level * 4) / 1e5
    const out = [{ kind: 'tank', instance, source: fluid, field: 'currentLevel', value: ratio }]
    const capacity = d.readUInt32LE(3)
    if (!noU(capacity, 32)) {
      out.push({ kind: 'tank', instance, source: fluid, field: 'capacity', value: capacity / 10000 })
      out.push({ kind: 'tank', instance, source: fluid, field: 'currentVolume', value: Math.round(ratio * capacity * 100) / 1e6 })
    }
    return out
  }
  return []
}

// The same readings as Signal K's "Signal K to NMEA 2000" plugin hands them
// to the server to send (event nmea2000JsonOut). Signal K does not pass its
// own transmissions back to plugins, so this is how a sender bridged by
// Signal K on the same machine is seen. Field names are canboatjs's, old
// ("Actual Temperature") or new ("actualTemperature"); sources may be names.
const TEMPERATURE_SOURCES = ['sea', 'outside', 'inside', 'engineroom', 'maincabin', 'livewell', 'baitwell', 'refrigeration', 'heatingsystem', 'dewpoint', 'apparentwindchill', 'theoreticalwindchill', 'heatindex', 'freezer', 'exhaustgas', 'shaftseal']
const HUMIDITY_SOURCES = ['inside', 'outside']
const PRESSURE_SOURCES = ['atmospheric', 'water', 'steam', 'compressedair', 'hydraulic', 'filter', 'altimetersetting', 'oil', 'fuel']
const FLUID_TYPES = ['fuel', 'water', 'graywater', 'livewell', 'oil', 'blackwater', 'fuelgasoline']
const flat = s => String(s).toLowerCase().replace(/temperature|pressure|humidity/g, '').replace(/[^a-z]/g, '').replace('refridgeration', 'refrigeration').replace('freshwater', 'water')

function enumCode (value, names) {
  if (Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  const i = typeof value === 'string' ? names.indexOf(flat(value)) : -1
  return i >= 0 ? i : undefined
}

function decodeSensorJson (message) {
  if (!message || typeof message !== 'object') return []
  const pgn = Number(message.pgn)
  if (!SENSOR_PGNS.has(pgn)) return []
  const raw = message.fields && typeof message.fields === 'object' ? message.fields : message
  const f = {}
  for (const [k, v] of Object.entries(raw)) f[k.toLowerCase().replace(/[^a-z]/g, '')] = v
  const instance = Number(f.instance)
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  if (!Number.isInteger(instance)) return []
  if (pgn === 130312 || pgn === 130316) {
    const value = num(f.actualtemperature !== undefined ? f.actualtemperature : f.temperature)
    const source = enumCode(f.source, TEMPERATURE_SOURCES)
    return value === undefined || source === undefined ? [] : [{ kind: 'temperature', instance, source, field: 'temperature', value }]
  }
  if (pgn === 130313) {
    let value = num(f.actualhumidity)
    if (value === undefined) return []
    if (value > 1) value /= 100 // a percentage rather than a ratio
    const source = enumCode(f.source, HUMIDITY_SOURCES)
    return [{ kind: 'humidity', instance, source: source === undefined ? 0 : source, field: 'relativeHumidity', value }]
  }
  if (pgn === 130314) {
    const value = num(f.pressure)
    const source = enumCode(f.source, PRESSURE_SOURCES)
    return value === undefined || source === undefined ? [] : [{ kind: 'pressure', instance, source, field: 'pressure', value }]
  }
  // 127505: level in percent, capacity in litres (canboatjs units).
  const level = num(f.level)
  const fluid = enumCode(f.type, FLUID_TYPES)
  if (level === undefined || fluid === undefined) return []
  const out = [{ kind: 'tank', instance, source: fluid, field: 'currentLevel', value: level / 100 }]
  const capacity = num(f.capacity)
  if (capacity !== undefined) {
    out.push({ kind: 'tank', instance, source: fluid, field: 'capacity', value: capacity / 1000 })
    out.push({ kind: 'tank', instance, source: fluid, field: 'currentVolume', value: level / 100 * capacity / 1000 })
  }
  return out
}

const KIND_FIELDS = {
  temperature: ['temperature', 'relativeHumidity'],
  pressure: ['pressure'],
  tank: ['currentLevel', 'currentVolume', 'capacity']
}

// The senders of a parsed ZCF, with Signal K paths under
// electrical.czone.monitoring.<slug>, as the meters have. `usedSlugs` holds
// the meters' slugs so the two never collide.
function senders (mapping, usedSlugs = new Set()) {
  const inputs = (mapping && mapping.signalInputs && mapping.signalInputs.inputs) || []
  const monitors = (mapping && mapping.tankMonitors && mapping.tankMonitors.monitors) || []
  const used = new Set(usedSlugs)
  const out = []
  for (const input of inputs) {
    if (!KIND_FIELDS[input.type]) continue
    if (!Number.isInteger(input.a) || !Number.isInteger(input.b)) continue
    const base = String(input.name || input.type).trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Sender'
    let slug = base
    for (let n = 2; used.has(slug); n++) slug = `${base}${n}`
    used.add(slug)
    const monitor = input.type === 'tank' ? monitors.find(m => m.module === input.module && m.input === input.input) : null
    const litres = monitor && monitor.configuration ? Number(monitor.configuration.capacityLitres) : NaN
    const paths = {}
    for (const field of KIND_FIELDS[input.type]) paths[field] = `electrical.czone.monitoring.${slug}.${field}`
    out.push({
      kind: input.type,
      name: String(input.name || '').trim() || slug,
      slug,
      instance: input.b,
      source: input.a,
      module: input.module,
      thirdParty: input.module === 0,
      capacity: Number.isFinite(litres) && litres > 0 ? litres / 1000 : null,
      signalK: paths
    })
  }
  return out
}

// Matches decoded readings to senders. One device per sender: a second device
// using the same instance is ignored while the first keeps reporting, so a
// reading never flips between two devices. A device quiet for QUIET_MS gives
// the sender up.
const QUIET_MS = 120e3

function createSensorRuntime (list) {
  const byKey = new Map()
  for (const s of list) byKey.set(`${s.kind}:${s.instance}:${s.source}`, s)
  const owners = new Map() // slug -> { device, at }

  function targets (reading) {
    if (reading.kind === 'humidity') return list.filter(s => s.kind === 'temperature' && s.instance === reading.instance)
    const s = byKey.get(`${reading.kind}:${reading.instance}:${reading.source}`)
    return s ? [s] : []
  }

  // readings from one frame or message of one device -> [{ sender, field, value, path }]
  // `allowed(item, device, now)` (lib/sources) decides which device a sender
  // is read from; without it, the first device heard keeps it.
  function accept (readings, device, now = Date.now(), allowed = null) {
    const out = []
    for (const r of readings) {
      for (const s of targets(r)) {
        const key = `${s.slug}:${r.kind === 'humidity' ? 'h' : 'v'}`
        if (allowed) {
          if (!allowed({ key, module: s.module, instance: s.instance }, device, now)) continue
        } else {
          const owner = owners.get(key)
          if (owner && owner.device !== device && now - owner.at < QUIET_MS) continue
          owners.set(key, { device, at: now })
        }
        const path = s.signalK[r.field]
        if (path) out.push({ sender: s, field: r.field, value: r.value, path })
      }
    }
    return out
  }

  return { senders: list, accept, clear: () => owners.clear() }
}

// "Freezer" and "Freezer Temperature" (or "Freezer Temp") are one thing: the
// circuit and its temperature. Case and punctuation do not count, and a name
// two temperature senders share pairs with nothing.
const pairName = s => String(s || '').toLowerCase().replace(/\btemp(erature)?\b/g, '').replace(/[^a-z0-9]/g, '')

function circuitTemperatures (circuits, list) {
  const temps = new Map()
  for (const s of list) {
    if (s.kind !== 'temperature') continue
    const k = pairName(s.name)
    if (!k) continue
    temps.set(k, temps.has(k) ? null : s)
  }
  const out = new Map()
  for (const c of circuits || []) {
    const s = temps.get(pairName(c.name))
    if (s) out.set(c.slug, s)
  }
  return out
}

module.exports = { SENSOR_PGNS, QUIET_MS, decodeSensorFrame, decodeSensorJson, senders, createSensorRuntime, circuitTemperatures, pairName }
