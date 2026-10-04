'use strict'

const assert = require('assert')
const monitoring = require('../lib/monitoring')

function dcDetailed (instance, type, soc = 80) {
  const b = Buffer.alloc(11)
  b[0] = 7
  b[1] = instance
  b[2] = type
  b[3] = soc
  b[4] = 95
  b.writeUInt16LE(120, 5)
  b.writeUInt16LE(5, 7)
  b.writeUInt16LE(123, 9)
  return b
}

function batteryStatus (instance, voltage, current, temperature) {
  const b = Buffer.alloc(8)
  b[0] = instance
  b.writeUInt16LE(Math.round(voltage * 100), 1)
  b.writeInt16LE(Math.round(current * 10), 3)
  b.writeUInt16LE(Math.round(temperature * 100), 5)
  b[7] = 7
  return b
}

const meters = [
  { name: 'House Battery', type: 'DC', meterId: 1, module: 0, instance: 0, dcType: 'battery' },
  { name: 'Solar', type: 'DC', meterId: 2, module: 0, instance: 1, dcType: 'solar' },
  { name: 'Port Alternator', type: 'DC', meterId: 3, module: 1, instance: 0, dcType: 'alternator' },
  { name: 'Shore Power', type: 'AC', meterId: 1, module: 4, instance: 2 }
]

const runtime = monitoring.createRuntime(meters)

const solarDetailed = runtime.observe({
  pgn: monitoring.PGN_DC_DETAILED,
  source: 81,
  data: dcDetailed(1, 3, 50)
})
assert.strictEqual(solarDetailed.length, 1)
assert.strictEqual(solarDetailed[0].meter.name, 'Solar')
assert.strictEqual(solarDetailed[0].values.stateOfCharge, 0.5)

const solarStatus = runtime.observe({
  pgn: monitoring.PGN_BATTERY_STATUS,
  source: 81,
  data: batteryStatus(1, 81.9, 6.4, 298.15)
})
assert.strictEqual(solarStatus.length, 1)
assert.strictEqual(solarStatus[0].meter.name, 'Solar')
assert.strictEqual(solarStatus[0].values.voltage, 81.9)
assert.strictEqual(solarStatus[0].values.current, 6.4)

const batteryDetailed = runtime.observe({
  pgn: monitoring.PGN_DC_DETAILED,
  source: 35,
  data: dcDetailed(0, 0, 92)
})
assert.strictEqual(batteryDetailed.length, 1)
assert.strictEqual(batteryDetailed[0].meter.name, 'House Battery')

const batteryStatusResult = runtime.observe({
  pgn: monitoring.PGN_BATTERY_STATUS,
  source: 35,
  data: batteryStatus(0, 13.2, 18.5, 299.15)
})
assert.strictEqual(batteryStatusResult.length, 1)
assert.strictEqual(batteryStatusResult[0].meter.name, 'House Battery')
assert.strictEqual(batteryStatusResult[0].values.current, 18.5)

const acPower = Buffer.alloc(8)
acPower[0] = 1
acPower[1] = 2
acPower.writeUInt16LE(125, 2)
acPower.writeInt32LE(2500, 4)
const acPowerResult = runtime.observe({
  pgn: monitoring.PGN_AC_POWER_A,
  source: 44,
  data: acPower
})
assert.strictEqual(acPowerResult.length, 1)
assert.strictEqual(acPowerResult[0].meter.name, 'Shore Power')
assert.strictEqual(acPowerResult[0].values.current, 12.5)
assert.strictEqual(acPowerResult[0].values.power, 2500)

const acVoltage = Buffer.alloc(8)
acVoltage[0] = 2
acVoltage[1] = 2
acVoltage.writeUInt16LE(2300, 2)
acVoltage.writeUInt16LE(4000, 4)
acVoltage.writeUInt16LE(500, 6)
const acVoltageResult = runtime.observe({
  pgn: monitoring.PGN_AC_VOLTAGE_A,
  source: 44,
  data: acVoltage
})
assert.strictEqual(acVoltageResult.length, 1)
assert.strictEqual(acVoltageResult[0].values.voltage, 230)
assert.strictEqual(acVoltageResult[0].values.lineToLineVoltage, 400)
assert.strictEqual(acVoltageResult[0].values.frequency, 50)

console.log('Monitoring parser/runtime tests passed')
