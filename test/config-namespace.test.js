'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const pluginFactory = require('../index')

const fixture = path.join(__dirname, 'fixtures', 'SugarShack-20260927-01.zcf')
if (!fs.existsSync(fixture)) {
  console.log('Configuration namespace tests skipped: fixture not present')
  process.exit(0)
}

function makeApp (configPath, statuses) {
  return {
    config: { configPath },
    isNmea2000OutAvailable: true,
    on: () => {},
    emit: () => {},
    debug: () => {},
    registerPutHandler: () => {},
    handleMessage: () => {},
    setPluginStatus: status => statuses.push(status)
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-czone-namespace-'))
const pluginData = path.join(root, 'plugin-config-data')
const canonical = path.join(pluginData, 'signalk-czone')
const retired = path.join(pluginData, 'signalk-czone-circuits')

fs.mkdirSync(retired, { recursive: true })
fs.copyFileSync(fixture, path.join(retired, 'installation.zcf'))

let statuses = []
const legacyOnlyPlugin = pluginFactory(makeApp(root, statuses))
legacyOnlyPlugin.start({})
assert(statuses.at(-1).includes('Waiting for CZone ZCF upload'))
legacyOnlyPlugin.stop()

fs.mkdirSync(canonical, { recursive: true })
fs.copyFileSync(fixture, path.join(canonical, 'installation.zcf'))

statuses = []
const canonicalPlugin = pluginFactory(makeApp(root, statuses))
canonicalPlugin.start({})
assert(statuses.at(-1).includes('Loaded 110 CZone circuits'))
canonicalPlugin.stop()

console.log('Configuration namespace tests passed')
