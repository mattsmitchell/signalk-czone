'use strict'

const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const html = fs.readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8')
const source = html.slice(html.indexOf('  function showLoadError('), html.indexOf('  async function refreshVesselName('))
const banner = { hidden: true, appendChild(link) { this.link = link } }
const connection = { classList: { remove() {}, toggle() {} } }
let statusResponse
let circuitResponse
let networkError = false
let rendered = false
let reloaded = false
const context = vm.createContext({
  console: { warn() {}, debug() {} }, API: '/plugins/signalk-czone',
  window: { location: { pathname: '/signalk-czone/', search: '?view=all', hash: '#lights', href: 'http://boat/signalk-czone/?view=all#lights', reload() { reloaded = true } } },
  document: { querySelector: id => id === '#loadError' ? banner : connection, createElement: () => ({ style: {} }) },
  fetch: async (url, options) => {
    assert.strictEqual(options.credentials, 'include')
    if (url === '/skServer/loginStatus') return statusResponse
    if (networkError) throw new Error('Network unavailable')
    return circuitResponse
  },
  encodeURIComponent, updateSocketIndicator: (text) => { connection.text = text },
  mergeRest() {}, render() { rendered = true }, socketConnected: false, socketEverOpen: false
})
vm.runInContext(source, context)
const refresh = () => vm.runInContext('refreshOnce()', context)
;(async () => {
  circuitResponse = { ok: false, status: 401, json() { throw new Error('401 body is not JSON') } }
  assert.strictEqual(await refresh(), false)
  assert.strictEqual(banner.link.textContent, 'Sign in')
  assert.strictEqual(banner.link.href, '/admin/#/login?redirect=%2Fsignalk-czone%2F%3Fview%3Dall%23lights')
  assert.strictEqual(rendered, false)

  circuitResponse = { ok: false, status: 403 }
  statusResponse = { ok: true, json: async () => ({ status: 'notLoggedIn' }) }
  await refresh()
  assert.strictEqual(banner.link.textContent, 'Sign in')
  statusResponse = { ok: true, json: async () => ({ status: 'loggedIn' }) }
  await refresh()
  assert(banner.textContent.includes('permissions'))
  assert.strictEqual(banner.link.textContent, 'Retry')
  statusResponse = { ok: false }
  await refresh()
  assert(banner.textContent.includes('denied access'))

  circuitResponse = { ok: false, status: 500 }
  await refresh()
  assert(banner.textContent.includes('HTTP 500'))
  assert.strictEqual(banner.link.textContent, 'Retry')
  banner.link.onclick({ preventDefault() {} })
  assert.strictEqual(reloaded, true)
  networkError = true
  await refresh()
  assert(banner.textContent.includes('connection'))
  networkError = false

  circuitResponse = { ok: true, json: async () => ({ circuits: [{ name: 'Lights' }] }) }
  assert.strictEqual(await refresh(), true)
  assert.strictEqual(banner.hidden, true)
  assert.strictEqual(rendered, true)
  console.log('Webapp authentication and circuit load error tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
