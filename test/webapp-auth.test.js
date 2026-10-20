'use strict'

const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const html = fs.readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8')
const source = html.slice(html.indexOf('  function showLoadError('), html.indexOf('  async function refreshVesselName('))
// A small stand-in DOM: elements keep their children; the banner also keeps
// its link, as the page appends it last.
const element = tagName => ({ tagName, style: {}, children: [], appendChild (child) { this.children.push(child); return child } })
const banner = { hidden: true, children: [], appendChild (child) { this.children.push(child); if (child.tagName === 'a') this.link = child; return child } }
Object.defineProperty(banner, 'textContent', { get () { return this.text }, set (v) { this.text = v; this.children = []; this.link = null } })
let loginResponse
let loginRequest
let loginNetworkError = false
const connection = { classList: { remove() {}, toggle() {} } }
let statusResponse
let circuitResponse
let networkError = false
let rendered = false
let reloaded = false
const context = vm.createContext({
  console: { warn() {}, debug() {} }, API: '/plugins/signalk-czone',
  window: { location: { pathname: '/signalk-czone/', search: '?view=all', hash: '#lights', href: 'http://boat/signalk-czone/?view=all#lights', reload() { reloaded = true } } },
  document: { querySelector: id => id === '#loadError' ? banner : connection, createElement: element },
  MFD: false,
  fetch: async (url, options) => {
    assert.strictEqual(options.credentials, 'include')
    if (url === '/skServer/loginStatus') return statusResponse
    if (url === '/signalk/v1/auth/login') {
      loginRequest = { method: options.method, body: JSON.parse(options.body) }
      if (loginNetworkError) throw new Error('Network unavailable')
      return loginResponse
    }
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
  assert.strictEqual(banner.link.textContent, 'Or sign in on the Signal K login page')
  assert.strictEqual(banner.link.href, '/admin/#/login?redirect=%2Fsignalk-czone%2F%3Fview%3Dall%23lights')
  assert.strictEqual(rendered, false)

  // A sign-in form on the page, for home-screen apps with no address bar.
  const form = banner.loginForm
  assert(form && form.tagName === 'form', 'sign-in form shown')
  assert.strictEqual(banner.children[0], form, 'form before the link')
  const [user, pass, button, error] = form.children
  assert.deepStrictEqual([user.name, user.autocomplete, pass.name, pass.type, pass.autocomplete, button.type],
    ['username', 'username', 'password', 'password', 'current-password', 'submit'])
  // Another refresh while it shows keeps the form someone may be typing in.
  user.value = 'skipper'; pass.value = 'secret'
  await refresh()
  assert.strictEqual(banner.loginForm, form)
  assert.strictEqual(banner.children[0], form)
  // Wrong password: said on the form, which stays usable.
  const submit = () => form.onsubmit({ preventDefault () {} })
  loginResponse = { ok: false, status: 401 }
  await submit()
  assert.deepStrictEqual(loginRequest, { method: 'POST', body: { username: 'skipper', password: 'secret', rememberMe: true } })
  assert.strictEqual(error.textContent, 'Wrong user name or password.')
  assert.strictEqual(button.disabled, false)
  assert.strictEqual(reloaded, false)
  loginResponse = { ok: false, status: 500 }
  await submit()
  assert(error.textContent.includes('HTTP 500'))
  loginNetworkError = true
  await submit()
  assert.strictEqual(error.textContent, 'Signal K could not be reached.')
  loginNetworkError = false
  // Accepted: the page reloads, logged in.
  loginResponse = { ok: true, status: 200 }
  await submit()
  assert.strictEqual(error.textContent, '')
  assert.strictEqual(reloaded, true)
  reloaded = false
  // On a chartplotter the banner is hidden; the status line says where its login comes from.
  context.MFD = true
  await refresh()
  assert(/Navico embedder/.test(connection.text))
  context.MFD = false
  await refresh()
  assert.strictEqual(connection.text, 'Sign in required')

  circuitResponse = { ok: false, status: 403 }
  statusResponse = { ok: true, json: async () => ({ status: 'notLoggedIn' }) }
  await refresh()
  assert.strictEqual(banner.link.textContent, 'Or sign in on the Signal K login page')
  assert(banner.loginForm)
  statusResponse = { ok: true, json: async () => ({ status: 'loggedIn' }) }
  await refresh()
  assert(banner.textContent.includes('permissions'))
  assert.strictEqual(banner.link.textContent, 'Retry')
  assert.strictEqual(banner.loginForm, null, 'no form when logged in without permission')
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
