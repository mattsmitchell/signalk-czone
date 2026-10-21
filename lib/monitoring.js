'use strict'

const PGN_DC_DETAILED = 127506
const PGN_BATTERY_STATUS = 127508
const PGN_AC_POWER_A = 127744
const PGN_AC_POWER_B = 127745
const PGN_AC_POWER_C = 127746
const PGN_AC_VOLTAGE_A = 127747
const PGN_AC_VOLTAGE_B = 127748
const PGN_AC_VOLTAGE_C = 127749

const DC_TYPE_NAMES = Object.freeze({
  0: 'battery',
  1: 'alternator',
  2: 'converter',
  3: 'solar',
  4: 'wind'
})

// The older AC messages, fast packets: instance, number of lines, then per
// line (18 bytes) line/flags, voltage u16 0.01 V, current u16 0.1 A,
// frequency u16 0.01 Hz, breaker u16, real power u32 1 W, reactive power u32,
// power factor. CZone and many chartplotters use these; Victron equipment
// sends 127744-127749. Both feed the same AC meter, by its instance.
const PGN_AC_INPUT_STATUS = 127503
const PGN_AC_OUTPUT_STATUS = 127504
// Reassembled from fast packets before they reach observe().
const FAST_PACKET_PGNS = new Set([PGN_DC_DETAILED, PGN_AC_INPUT_STATUS, PGN_AC_OUTPUT_STATUS])

// The top values of every NMEA 2000 field mean "no data" (not available, out
// of range, reserved). None of them is a reading.
const naU = (v, bits) => v >= 2 ** bits - 3
const naI = (v, bits) => v >= 2 ** (bits - 1) - 3
// Scaled without floating-point dust (1320 x 0.01 = 13.2, not 13.200000000000001).
const scaled = (v, scale) => Math.round(v * scale * 1e6) / 1e6
const u16 = (b, at, scale) => { const v = b.readUInt16LE(at); return naU(v, 16) ? null : scaled(v, scale) }
const i16 = (b, at, scale) => { const v = b.readInt16LE(at); return naI(v, 16) ? null : scaled(v, scale) }

const AC_POWER_PGNS = new Set([PGN_AC_POWER_A, PGN_AC_POWER_B, PGN_AC_POWER_C])
const AC_VOLTAGE_PGNS = new Set([PGN_AC_VOLTAGE_A, PGN_AC_VOLTAGE_B, PGN_AC_VOLTAGE_C])

function decodeDcDetailed (payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 11) return null
  return {
    sid: payload[0],
    instance: payload[1],
    dcTypeCode: payload[2],
    dcType: DC_TYPE_NAMES[payload[2]] || null,
    stateOfCharge: payload[3] <= 100 ? payload[3] / 100 : null,
    stateOfHealth: payload[4] <= 100 ? payload[4] / 100 : null,
    timeRemaining: u16(payload, 5, 60),
    rippleVoltage: u16(payload, 7, 0.01),
    ampHours: u16(payload, 9, 0.1)
  }
}

function decodeBatteryStatus (payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null
  return {
    instance: payload[0],
    voltage: u16(payload, 1, 0.01),
    current: i16(payload, 3, 0.1),
    temperature: u16(payload, 5, 0.01),
    sid: payload[7]
  }
}

function decodeAcPower (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null
  return {
    sid: payload[0],
    connection: payload[1],
    current: u16(payload, 2, 0.1),
    power: naI(payload.readInt32LE(4), 32) ? null : payload.readInt32LE(4),
    phase: pgn - PGN_AC_POWER_A
  }
}

function decodeAcVoltage (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null
  return {
    sid: payload[0],
    connection: payload[1],
    voltage: u16(payload, 2, 0.1),
    lineToLineVoltage: u16(payload, 4, 0.1),
    frequency: u16(payload, 6, 0.1),
    phase: pgn - PGN_AC_VOLTAGE_A
  }
}

// Line 1 of 127503 / 127504 (a reassembled packet).
function decodeAcStatus (payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 15 || payload[1] === 0 || payload[1] === 0xff) return null
  const watts = payload.readUInt32LE(11)
  return {
    connection: payload[0],
    voltage: u16(payload, 3, 0.01),
    current: u16(payload, 5, 0.1),
    frequency: u16(payload, 7, 0.01),
    power: naU(watts, 32) ? null : watts
  }
}

function signalKPaths (meter) {
  const slug = meter.slug
  const base = `electrical.czone.monitoring.${slug}`
  return {
    voltage: `${base}.voltage`,
    current: `${base}.current`,
    temperature: `${base}.temperature`,
    stateOfCharge: `${base}.capacity.stateOfCharge`,
    stateOfHealth: `${base}.capacity.stateOfHealth`,
    timeRemaining: `${base}.timeRemaining`,
    rippleVoltage: `${base}.rippleVoltage`,
    ampHours: `${base}.capacity.remaining`,
    power: `${base}.power`,
    frequency: `${base}.frequency`,
    lineToLineVoltage: `${base}.lineToLineVoltage`
  }
}

function prepareMeters (meters) {
  const used = new Map()
  return (Array.isArray(meters) ? meters : []).map(meter => {
    const base = String(meter.name || 'CZoneMonitoring')
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'CZoneMonitoring'
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    const slug = count === 1 ? base : `${base}${count}`
    return { ...meter, slug, signalK: signalKPaths({ ...meter, slug }) }
  })
}

function createRuntime (meters) {
  const prepared = prepareMeters(meters)
  const dcProfiles = new Map()
  const values = new Map()

  function dcCandidates(instance) {
    return prepared.filter(meter =>
      meter.type === 'DC' && Number(meter.instance) === Number(instance)
    )
  }

  function acCandidates(connection) {
    return prepared.filter(meter =>
      meter.type === 'AC' && Number(meter.instance) === Number(connection)
    )
  }

  function selectDc(packet) {
    const candidates = dcCandidates(packet.instance)
    if (!candidates.length) return []

    const profile = dcProfiles.get(packet.instance)
    if (profile && profile.dcType) {
      const typed = candidates.filter(meter => meter.dcType === profile.dcType)
      if (typed.length) return typed
    }

    // Battery sources are the only case where multiple devices on the same
    // instance are expected to be common. Prefer the source which also
    // supplied DC Detailed Status / SOC information.
    if (profile && profile.dcType === 'battery') {
      return candidates.filter(meter => meter.dcType === 'battery')
    }

    return candidates.length === 1 ? candidates : []
  }

  function observe(frame) {
    if (!frame) return []
    let decoded = null
    let meters = []

    if (frame.pgn === PGN_DC_DETAILED) {
      decoded = decodeDcDetailed(frame.data)
      if (!decoded) return []
      dcProfiles.set(decoded.instance, decoded)
      meters = dcCandidates(decoded.instance).filter(meter => meter.dcType === decoded.dcType)
      return meters.map(meter => ({
        meter,
        values: {
          stateOfCharge: decoded.stateOfCharge,
          stateOfHealth: decoded.stateOfHealth,
          timeRemaining: decoded.timeRemaining,
          rippleVoltage: decoded.rippleVoltage,
          ampHours: decoded.ampHours
        },
        source: { label: 'NMEA2000', type: 'NMEA2000', src: String(frame.source), pgn: frame.pgn }
      }))
    }

    if (frame.pgn === PGN_BATTERY_STATUS) {
      decoded = decodeBatteryStatus(frame.data)
      if (!decoded) return []
      meters = selectDc(decoded)
      // DC watts (solar, alternator, wind, battery): volts x amps of the
      // same message, so the two always belong together.
      const power = decoded.voltage !== null && decoded.current !== null
        ? Math.round(decoded.voltage * decoded.current * 10) / 10
        : null
      return meters.map(meter => ({
        meter,
        values: {
          voltage: decoded.voltage,
          current: decoded.current,
          power,
          temperature: decoded.temperature
        },
        source: { label: 'NMEA2000', type: 'NMEA2000', src: String(frame.source), pgn: frame.pgn }
      }))
    }

    if (AC_POWER_PGNS.has(frame.pgn)) {
      decoded = decodeAcPower(frame.data, frame.pgn)
      if (!decoded) return []
      meters = acCandidates(decoded.connection)
      return meters.map(meter => ({
        meter,
        values: { current: decoded.current, power: decoded.power },
        source: { label: 'NMEA2000', type: 'NMEA2000', src: String(frame.source), pgn: frame.pgn }
      }))
    }

    if (frame.pgn === PGN_AC_INPUT_STATUS || frame.pgn === PGN_AC_OUTPUT_STATUS) {
      decoded = decodeAcStatus(frame.data)
      if (!decoded) return []
      meters = acCandidates(decoded.connection)
      return meters.map(meter => ({
        meter,
        values: { voltage: decoded.voltage, current: decoded.current, frequency: decoded.frequency, power: decoded.power },
        source: { label: 'NMEA2000', type: 'NMEA2000', src: String(frame.source), pgn: frame.pgn }
      }))
    }

    if (AC_VOLTAGE_PGNS.has(frame.pgn)) {
      decoded = decodeAcVoltage(frame.data, frame.pgn)
      if (!decoded) return []
      meters = acCandidates(decoded.connection)
      return meters.map(meter => ({
        meter,
        values: {
          voltage: decoded.voltage,
          lineToLineVoltage: decoded.lineToLineVoltage,
          frequency: decoded.frequency
        },
        source: { label: 'NMEA2000', type: 'NMEA2000', src: String(frame.source), pgn: frame.pgn }
      }))
    }

    return []
  }

  function publishable(path, value) {
    const previous = values.get(path)
    if (previous !== undefined && Object.is(previous, value)) return false
    values.set(path, value)
    return true
  }

  return {
    meters: prepared,
    observe,
    publishable,
    clear: () => values.clear()
  }
}

module.exports = {
  PGN_DC_DETAILED,
  PGN_BATTERY_STATUS,
  PGN_AC_POWER_A,
  PGN_AC_POWER_B,
  PGN_AC_POWER_C,
  PGN_AC_VOLTAGE_A,
  PGN_AC_VOLTAGE_B,
  PGN_AC_VOLTAGE_C,
  PGN_AC_INPUT_STATUS,
  PGN_AC_OUTPUT_STATUS,
  FAST_PACKET_PGNS,
  decodeAcStatus,
  decodeDcDetailed,
  decodeBatteryStatus,
  decodeAcPower,
  decodeAcVoltage,
  prepareMeters,
  createRuntime
}
