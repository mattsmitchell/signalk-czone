'use strict'

// DC power history (lib/power-history.js): recorded power where there is
// some, volts x amps before it.

const assert = require('assert')
const { powerHistory, multiply } = require('../lib/power-history')

const t0 = 1.7e12
const min = 60e3
const res = (data, extra = {}) => ({ available: true, gapMs: 16 * min, data, ...extra })

// Full detail: volts and amps recorded a little apart; each point is the
// latest of each at that time.
{
  const volts = res([[t0, 13.6], [t0 + 2 * min, 13.6], [t0 + 4 * min, 13.8]])
  const amps = res([[t0 + 5000, 5], [t0 + 2 * min + 5000, 8]])
  assert.deepStrictEqual(multiply(volts, amps), [
    [t0 + 5000, 68], [t0 + 2 * min, 68], [t0 + 2 * min + 5000, 108.8], [t0 + 4 * min, 110.4]])
  // Before `until` only.
  assert.deepStrictEqual(multiply(volts, amps, t0 + 3 * min).length, 3)
  // A value older than the gap is not paired.
  assert.deepStrictEqual(multiply(res([[t0, 13]], { gapMs: min }), res([[t0 + 5 * min, 2]], { gapMs: min })), [])
}

// Summaries ([t, avg, min, max]): product of the averages, band from the corners.
{
  const volts = res([[t0, 13, 12, 14]])
  const amps = res([[t0, -2, -5, 3]])
  assert.deepStrictEqual(multiply(volts, amps), [[t0, -26, -70, 42]])
}

// Recorded power is used where there is some; volts x amps only before it.
{
  const volts = res([[t0, 13], [t0 + 10 * min, 13]])
  const amps = res([[t0, 2], [t0 + 10 * min, 3]])
  const power = res([[t0 + 10 * min, 39.1]], { latest: { value: 39.1 } })
  const out = powerHistory(power, volts, amps)
  assert.deepStrictEqual(out.data, [[t0, 26], [t0 + 10 * min, 39.1]])
  assert.strictEqual(out.computedUntil, t0)
  assert.deepStrictEqual(out.latest, { value: 39.1 })
  // Nothing recorded as power yet: all from volts x amps.
  assert.deepStrictEqual(powerHistory(res([]), volts, amps).data, [[t0, 26], [t0 + 10 * min, 39]])
  // Nothing to add: the power result as it was.
  assert.strictEqual(powerHistory(power, res([]), res([])), power)
  // Trends off or a bad range: passed through.
  const off = { available: false, reason: 'disabled', data: [] }
  assert.strictEqual(powerHistory(off, volts, amps), off)
  const bad = { available: true, error: 'bad_range', data: [] }
  assert.strictEqual(powerHistory(bad, volts, amps), bad)
}

console.log('Power history tests passed')
