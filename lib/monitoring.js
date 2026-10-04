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
    timeRemaining: payload.readUInt16LE(5) * 60,
    rippleVoltage: payload.readUInt16LE(7) * 0.01,
    ampHours: payload.readUInt16LE(9) * 0.1
  }
}

function decodeBatteryStatus (payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null
  return {
    instance: payload[0],
    voltage: payload.readUInt16LE(1) * 0.01,
    current: payload.readInt16LE(3) * 0.1,
    temperature: payload.readUInt16LE(5) * 0.01,
    sid: payload[7]
  }
}

function decodeAcPower (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null
  return {
    sid: payload[0],
    connection: payload[1],
    current: payload.readUInt16LE(2) * 0.1,
    power: payload.readInt32LE(4),
    phase: pgn - PGN_AC_POWER_A
  }
}

function decodeAcVoltage (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 8) return null
  return {
    sid: payload[0],
    connection: payload[1],
    voltage: payload.readUInt16LE(2) * 0.1,
    lineToLineVoltage: payload.readUInt16LE(4) * 0.1,
    frequency: payload.readUInt16LE(6) * 0.1,
    phase: pgn - PGN_AC_VOLTAGE_A
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
      meters = dcCandidates(decoded.instance)
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
      return meters.map(meter => ({
        meter,
        values: {
          voltage: decoded.voltage,
          current: decoded.current,
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
  decodeDcDetailed,
  decodeBatteryStatus,
  decodeAcPower,
  decodeAcVoltage,
  prepareMeters,
  createRuntime
}
