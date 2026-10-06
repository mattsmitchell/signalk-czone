'use strict'

const assert = require('assert')
const confirm = require('../lib/confirm-switch')

const circuits = [
  { name: 'Freezer', slug: 'Freezer' },
  { name: 'Instruments ', slug: 'Instruments' },
  { name: 'Cabin Lights', slug: 'Cabin_Lights' },
  { name: 'Hidden', slug: 'Hidden', hidden: true }
]

assert.deepStrictEqual(confirm.entries({}, 'confirmOn'), [])
assert.deepStrictEqual(
  confirm.entries({ confirmOn: ['Freezer', { circuit: ' Instruments ' }, null] }, 'confirmOn'),
  [{ circuit: 'Freezer' }, { circuit: 'Instruments' }]
)

const on = confirm.confirmFor({ confirmOn: [{ circuit: 'freezer' }, { circuit: 'Cabin_Lights' }, { circuit: 'Gone' }] }, circuits, 'confirmOn')
assert.deepStrictEqual([...on.marked].sort(), ['Cabin Lights', 'Freezer'])
assert.deepStrictEqual(on.unknown, ['Gone'])

const off = confirm.confirmFor({ confirmOff: [{ circuit: 'instruments' }] }, circuits, 'confirmOff')
assert.deepStrictEqual([...off.marked], ['Instruments '])

assert.deepStrictEqual(
  confirm.choices({ confirmOff: [{ circuit: 'Old Fridge' }] }, circuits, 'confirmOff'),
  [
    { value: 'Cabin Lights', label: 'Cabin Lights' },
    { value: 'Freezer', label: 'Freezer' },
    { value: 'Instruments', label: 'Instruments' },
    { value: 'Old Fridge', label: 'Old Fridge (not in this configuration)' }
  ]
)

const schema = confirm.schema({ confirmOn: [{ circuit: 'Freezer' }] }, circuits, 'confirmOn', 'Confirm before turning on')
assert.strictEqual(schema.title, 'Confirm before turning on')
assert(schema.items.properties.circuit.enum.includes('Freezer'))

console.log('Confirm switching tests passed')
