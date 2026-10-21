'use strict'

// DC power history for a chart.
//
// Live DC power is volts x amps of one 127508 message (lib/monitoring), and
// it is recorded like any other value. Before it was recorded (it is new in
// 0.3.0-beta.19) the meter's volts and amps were already being recorded, so
// the chart works that earlier part out from them:
//   - each point is volts x amps, the latest of each at that time, as long as
//     neither is older than the gap the chart allows;
//   - for summarised periods (rows of [t, average, min, max]) the value is
//     the product of the averages and the band is the range the two bands
//     allow, so it is close but not exact.
// Wherever power itself was recorded, those exact figures are used.
//
// Inputs and output are the trend store's read() results:
//   { available, data: [[t, value]] or [[t, avg, min, max]], gapMs, ... }

const round1 = v => Math.round(v * 10) / 10
const low = row => (row.length > 2 && row[2] !== null ? row[2] : row[1])
const high = row => (row.length > 3 && row[3] !== null ? row[3] : row[1])

// volts x amps, for times before `until` (ms; Infinity = all).
function multiply (volts, amps, until = Infinity) {
  const v = (volts && volts.data) || []
  const a = (amps && amps.data) || []
  const gap = Math.max(volts.gapMs || 0, amps.gapMs || 0) || 16 * 60e3
  const times = [...new Set([...v.map(r => r[0]), ...a.map(r => r[0])])].filter(t => t < until).sort((x, y) => x - y)
  const out = []
  let i = 0
  let j = 0
  let rv = null
  let ra = null
  for (const t of times) {
    while (i < v.length && v[i][0] <= t) rv = v[i++]
    while (j < a.length && a[j][0] <= t) ra = a[j++]
    if (!rv || !ra || t - rv[0] > gap || t - ra[0] > gap) continue
    if (rv.length > 2 || ra.length > 2) {
      const corners = [low(rv) * low(ra), low(rv) * high(ra), high(rv) * low(ra), high(rv) * high(ra)]
      out.push([t, round1(rv[1] * ra[1]), round1(Math.min(...corners)), round1(Math.max(...corners))])
    } else {
      out.push([t, round1(rv[1] * ra[1])])
    }
  }
  return out
}

// power, volts, amps: read() results for the same range.
function powerHistory (power, volts, amps) {
  if (!power || !power.available || power.error) return power
  if (!volts || !volts.available || !amps || !amps.available) return power
  const recorded = Array.isArray(power.data) ? power.data : []
  const first = recorded.length ? recorded[0][0] : Infinity
  const before = multiply(volts, amps, first)
  if (!before.length) return power
  return {
    ...power,
    data: before.concat(recorded),
    points: before.length + recorded.length,
    gapMs: Math.max(power.gapMs || 0, volts.gapMs || 0, amps.gapMs || 0) || undefined,
    // Up to here the figures are worked out from volts x amps.
    computedUntil: before[before.length - 1][0]
  }
}

module.exports = { powerHistory, multiply }
