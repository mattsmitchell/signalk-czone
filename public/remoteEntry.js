/* Signal K classic Module Federation configuration panel. */
var signalk_czone = (function () {
  function getReact () {
    var React = globalThis.__SK_REACT__ || globalThis.React
    if (!React) throw new Error('Signal K Admin UI React host was not found')
    return React
  }

  function PluginConfigurationPanel (props) {
    var React = getReact()
    var configuration = props.configuration || {}
    var save = props.save
    var state = React.useState(null)
    var data = state[0]
    var setData = state[1]
    var busyState = React.useState(false)
    var busy = busyState[0]
    var setBusy = busyState[1]
    var errorState = React.useState('')
    var error = errorState[0]
    var setError = errorState[1]
    var readState = React.useState(null)
    var read = readState[0]
    var setRead = readState[1]
    var selectedState = React.useState(configuration.networkConfigFile || '')
    var selected = selectedState[0]
    var setSelected = selectedState[1]
    var sourceState = React.useState(configuration.configurationSource || 'installedZcf')
    var localSource = sourceState[0]
    var setLocalSource = sourceState[1]
    var uploadState = React.useState(null)
    var uploadFile = uploadState[0]
    var setUploadFile = uploadState[1]
    var paneState = React.useState(null); var pane = paneState[0]; var setPane = paneState[1]
    var trendState = React.useState(null)
    var trend = trendState[0]
    var setTrend = trendState[1]

    // Third-party switches (lib/bridge)
    var bridgeKindState = React.useState('victron'); var bridgeKind = bridgeKindState[0]; var setBridgeKind = bridgeKindState[1]
    var bridgeCircuitState = React.useState(''); var bridgeCircuit = bridgeCircuitState[0]; var setBridgeCircuit = bridgeCircuitState[1]
    var bridgeOutputState = React.useState(''); var bridgeOutput = bridgeOutputState[0]; var setBridgeOutput = bridgeOutputState[1]
    var bridgeHostState = React.useState(''); var bridgeHost = bridgeHostState[0]; var setBridgeHost = bridgeHostState[1]
    var bridgeChannelState = React.useState('0'); var bridgeChannel = bridgeChannelState[0]; var setBridgeChannel = bridgeChannelState[1]
    var outputsState = React.useState(null); var outputs = outputsState[0]; var setOutputs = outputsState[1]
    var shellyTestState = React.useState(''); var shellyTest = shellyTestState[0]; var setShellyTest = shellyTestState[1]
    var linkStatusState = React.useState([]); var linkStatus = linkStatusState[0]; var setLinkStatus = linkStatusState[1]

    function bridgeList () {
      return (Array.isArray(configuration.bridges) ? configuration.bridges : []).filter(function (b) { return b && b.circuit })
    }
    function loadOutputs () {
      setOutputs({ loading: true, outputs: [] })
      fetch('/plugins/signalk-czone/bridge/outputs', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (v) { setOutputs(v) })
        .catch(function (err) { setOutputs({ available: false, outputs: [], detail: err.message }) })
    }
    function loadLinkStatus () {
      fetch('/plugins/signalk-czone/bridge/status', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (v) { setLinkStatus(Array.isArray(v.links) ? v.links : []) })
        .catch(function () {})
    }
    React.useEffect(function () {
      loadOutputs(); loadLinkStatus()
      var t = setInterval(loadLinkStatus, 3000)
      return function () { clearInterval(t) }
    }, [])
    function testShelly () {
      setShellyTest('Asking the Shelly…')
      fetch('/plugins/signalk-czone/bridge/shelly?host=' + encodeURIComponent(bridgeHost.trim()) + '&channel=' + encodeURIComponent(bridgeChannel), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (v) { setShellyTest(v.ok ? 'Found: switch is ' + (v.output ? 'ON' : 'OFF') + (typeof v.power === 'number' ? ' · ' + v.power + ' W' : '') : 'Not found: ' + (v.detail || 'no answer')) })
        .catch(function (err) { setShellyTest('Not found: ' + err.message) })
    }
    function addBridge () {
      var row
      if (bridgeKind === 'victron') {
        var o = (outputs && outputs.outputs || []).filter(function (x) { return x.value === bridgeOutput })[0]
        if (!o) return
        row = { circuit: bridgeCircuit, target: 'victron', output: o.value, label: o.label }
      } else {
        row = { circuit: bridgeCircuit, target: 'shelly', host: bridgeHost.trim(), channel: Number(bridgeChannel) || 0 }
      }
      persist({ bridges: bridgeList().concat([row]) })
      setBridgeCircuit(''); setBridgeOutput(''); setShellyTest('')
    }
    function removeBridge (index) {
      persist({ bridges: bridgeList().filter(function (_b, i) { return i !== index }) })
    }
    function bridgeTarget (b) {
      return b.target === 'victron' ? (b.label || b.output) + ' (Victron output, through the GX)' : 'Shelly at ' + b.host + (b.channel ? ' channel ' + b.channel : '') + ' (directly)'
    }

    function loadConfiguration () {
      return fetch('/plugins/signalk-czone/configuration', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('Could not load CZone configuration status'); return r.json() })
        .then(function (value) {
          setData(value)
          setSelected(value.networkConfigFile || configuration.networkConfigFile || '')
          setLocalSource(value.source || configuration.configurationSource || 'installedZcf')
          if (value.networkRead) setRead(value.networkRead)
          return value
        })
    }

    function loadTrendStatus () {
      return fetch('/plugins/signalk-czone/trend/status', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (value) { setTrend(value) })
        .catch(function () {})
    }

    function loadPaneStatus () {
      return fetch('/plugins/signalk-czone/victron/status', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (value) { setPane(value) })
        .catch(function () {})
    }

    function paneSummary () {
      if (configuration.victronSwitches !== true) return 'Switched off.'
      if (!pane) return 'Checking…'
      if (pane.running) return pane.channels + ' circuits in the switch pane (device instance ' + pane.deviceInstance + ').'
      return pane.error ? 'Not running: ' + pane.error : 'Starting…'
    }

    React.useEffect(function () {
      loadConfiguration().catch(function (err) { setError(err.message || String(err)) })
      loadTrendStatus()
      loadPaneStatus()
      // Saving a trend setting restarts the plugin; show where trends go now.
      var timer = setInterval(function () { loadTrendStatus(); loadPaneStatus() }, 5000)
      return function () { clearInterval(timer) }
    }, [])

    React.useEffect(function () {
      if (!read || read.status !== 'reading') return undefined
      var timer = setInterval(function () {
        loadConfiguration().catch(function () {})
      }, 1000)
      return function () { clearInterval(timer) }
    }, [read && read.status])

    function persist(next) {
      setBusy(true); setError('')
      try {
        save(Object.assign({}, configuration, next))
        setData(Object.assign({}, data || {}, next))
      } catch (err) {
        setError(err.message || String(err))
      } finally {
        setBusy(false)
      }
    }

    function setSending (value) {
      persist({ allowCzoneWrite: value })
    }

    // Confirm before turning off: a list of { circuit }.
    function confirmOffList () {
      return (Array.isArray(configuration.confirmOff) ? configuration.confirmOff : [])
        .map(function (e) { return typeof e === 'string' ? { circuit: e } : e })
        .filter(function (e) { return e && e.circuit })
        .map(function (e) { return { circuit: e.circuit } })
    }

    function addConfirmOff (name) {
      if (!name) return
      persist({ confirmOff: confirmOffList().concat([{ circuit: name }]) })
    }

    function removeConfirmOff (index) {
      persist({ confirmOff: confirmOffList().filter(function (_e, i) { return i !== index }) })
    }

    // Confirm before turning on: deliberately parallel to the tested OFF list.
    function confirmOnList () {
      return (Array.isArray(configuration.confirmOn) ? configuration.confirmOn : [])
        .map(function (e) { return typeof e === 'string' ? { circuit: e } : e })
        .filter(function (e) { return e && e.circuit })
        .map(function (e) { return { circuit: e.circuit } })
    }

    function addConfirmOn (name) {
      if (!name) return
      persist({ confirmOn: confirmOnList().concat([{ circuit: name }]) })
    }

    function removeConfirmOn (index) {
      persist({ confirmOn: confirmOnList().filter(function (_e, i) { return i !== index }) })
    }

    function chooseSource (value) {
      setLocalSource(value)
      if (value === 'installedZcf') {
        setSelected('')
        persist({ configurationSource: 'installedZcf', networkConfigFile: '' })
      } else if (selected) {
        persist({ configurationSource: 'networkCache', networkConfigFile: selected })
      }
    }

    // Where trends are going, or why they are off.
    function trendSummary () {
      if (configuration.trendsEnabled !== true) return 'Switched off.'
      if (!trend) return 'Checking…'
      if (!trend.available) return 'Trends off: ' + (trend.detail || trend.reason || 'no storage')
      var where = trend.location === 'removable' ? 'on the SD card or USB stick at ' + trend.mount
        : trend.location === 'data_dir' ? 'in the plugin data folder'
          : 'in ' + trend.dir
      var free = typeof trend.freeBytes === 'number' ? ' · ' + (trend.freeBytes / 1073741824).toFixed(1) + ' GB free' : ''
      return 'Recording ' + trend.trending + ' circuit' + (trend.trending === 1 ? '' : 's') + ' every ' + trend.sampleSeconds + ' s ' + where + free
    }

    function useSelected () {
      if (!selected) return
      setBusy(true); setError('')
      fetch('/plugins/signalk-czone/configuration/network/use', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: selected })
      }).then(function (r) {
        return r.text().then(function (body) {
          var value
          try { value = JSON.parse(body) } catch (_) { value = null }
          if (!r.ok) throw new Error(value && value.error ? value.error : body || ('HTTP ' + r.status))
          return value || {}
        })
      }).then(function () {
        configuration.configurationSource = 'networkCache'
        configuration.networkConfigFile = selected
        setData(Object.assign({}, data || {}, { source: 'networkCache', networkConfigFile: selected }))
      }).catch(function (err) {
        setError(err.message || String(err))
      }).finally(function () { setBusy(false); loadConfiguration().catch(function () {}) })
    }

    function uploadZcf () {
      if (!uploadFile) return
      var name = String(uploadFile.name || '')
      if (!/\.zcf$/i.test(name)) {
        setError('Please choose a .zcf file')
        return
      }
      setBusy(true); setError('')
      var form = new FormData()
      form.append('file', uploadFile, name)
      fetch('/plugins/signalk-czone/zcf/upload', {
        method: 'POST', credentials: 'same-origin', body: form
      }).then(function (r) {
        return r.text().then(function (body) {
          var value
          try { value = JSON.parse(body) } catch (_) { value = null }
          if (!r.ok) throw new Error(value && value.error ? value.error : body || ('HTTP ' + r.status))
          return value || {}
        })
      }).then(function (value) {
        setLocalSource('installedZcf')
        setSelected('')
        setUploadFile(null)
        configuration.configurationSource = 'installedZcf'
        configuration.networkConfigFile = ''
        setData(Object.assign({}, data || {}, { source: 'installedZcf', networkConfigFile: '' }))
        return loadConfiguration().then(function () {
          setRead({ status: 'complete', message: value.message || 'ZCF uploaded and installed.' })
        })
      }).catch(function (err) {
        setError(err.message || String(err))
      }).finally(function () { setBusy(false) })
    }

    function readFromNetwork () {
      setBusy(true); setError(''); setRead({ status: 'reading', message: 'Starting CZone configuration read…' })
      fetch('/plugins/signalk-czone/configuration/network/read', {
        method: 'POST', credentials: 'same-origin'
      }).then(function (r) {
        return r.text().then(function (body) {
          var value
          try { value = JSON.parse(body) } catch (_) { value = null }
          if (!r.ok) throw new Error(value && value.error ? value.error : body || ('HTTP ' + r.status))
          return value || {}
        })
      }).then(function (value) {
        setRead(value)
        return loadConfiguration()
      }).catch(function (err) {
        setError(err.message || String(err))
        setRead({ status: 'error', error: err.message || String(err) })
      }).finally(function () { setBusy(false) })
    }

    var installed = data && data.installedZcf
    var files = data && data.availableNetworkConfigs ? data.availableNetworkConfigs : []
    var source = localSource
    var nmeaReady = data && data.nmeaReady === true
    var current = data && data.current
    var reading = read && read.status === 'reading'

    return React.createElement('div', null,
      React.createElement('h4', null, 'CZone Circuits Configuration'),
      React.createElement('p', null, 'Configuration is loaded locally at Signal K startup. Reading from the CZone network is an explicit maintenance action and is never performed automatically at startup.'),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #c55', borderRadius: 6 } },
        React.createElement('strong', null, 'CZone transmit control'),
        React.createElement('div', { style: { marginTop: 9 } },
          React.createElement('label', null,
            React.createElement('input', { type: 'checkbox', checked: configuration.allowCzoneWrite === true, disabled: busy, onChange: function (e) { setSending(e.target.checked) } }),
            ' Enable CZone read/write control'
          ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Allows this plugin to send commands to CZone devices. This can change circuit states, modes, and configuration. Enable only if you understand the risks.')
        )
      ),      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Configuration source'),
        React.createElement('div', { style: { marginTop: 9 } },
          React.createElement('label', { style: { display: 'block', marginBottom: 8 } },
            React.createElement('input', { type: 'radio', name: 'czone-source', checked: source === 'installedZcf', disabled: busy, onChange: function () { chooseSource('installedZcf') } }),
            ' Use installed/uploaded ZCF'
          ),
          React.createElement('div', { style: { marginLeft: 24, fontSize: 12 } }, installed && installed.exists
            ? (installed.fileName || 'installation.zcf') + (installed.vesselName ? ' · ' + installed.vesselName : '') + (installed.circuits != null ? ' · ' + installed.circuits + ' circuits · ' + installed.modes + ' modes' : '')
            : 'No uploaded ZCF is installed.'),
          React.createElement('label', { style: { display: 'block', marginTop: 13 } },
            React.createElement('input', { type: 'radio', name: 'czone-source', checked: source === 'networkCache', disabled: busy, onChange: function () { chooseSource('networkCache') } }),
            ' Use saved CZone network configuration'
          ),
          React.createElement('div', { style: { marginTop: 7, marginLeft: 24 } },
            React.createElement('select', { value: selected, disabled: busy || !files.length, onChange: function (e) { setSelected(e.target.value) }, style: { maxWidth: '100%', padding: 5 } },
              React.createElement('option', { value: '' }, files.length ? 'Select a .czone.net file…' : 'No saved network configurations'),
              files.map(function (item) { return React.createElement('option', { key: item.file, value: item.file }, item.file + ' (' + item.bytes + ' bytes)') })
            ),
            React.createElement('button', { type: 'button', disabled: busy || !selected, onClick: useSelected, style: { marginLeft: 8 } }, 'Use Selected')
          )
        )
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'ZCF file'),
        React.createElement('p', { style: { margin: '7px 0', fontSize: 12 } }, 'Upload a CZone .zcf file to install it as the local configuration. Uploading switches the configuration source back to the installed/uploaded ZCF.'),
        React.createElement('input', { type: 'file', accept: '.zcf,application/octet-stream', disabled: busy, onChange: function (e) { setUploadFile(e.target.files && e.target.files[0] ? e.target.files[0] : null) } }),
        React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('button', { type: 'button', disabled: busy || !uploadFile, onClick: uploadZcf }, busy ? 'Uploading ZCF…' : 'Upload and install ZCF'),
          uploadFile ? React.createElement('span', { style: { marginLeft: 8, fontSize: 12 } }, uploadFile.name) : null
        )
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'CZone network configuration'),
        React.createElement('p', { style: { margin: '7px 0', fontSize: 12 } }, 'Read the complete configuration from the CZone network and save it locally as a .czone.net file. This does not automatically change the active configuration.'),
        React.createElement('button', { type: 'button', disabled: busy || reading || !nmeaReady || configuration.allowCzoneWrite !== true, onClick: readFromNetwork }, reading ? 'Reading CZone configuration…' : 'Read From Network and Save'),
        configuration.allowCzoneWrite !== true ? React.createElement('div', { style: { marginTop: 7, fontSize: 12 } }, 'Enable CZone read/write control before reading from the network. Reading the configuration requires sending a request to CZone.') : null,
        !nmeaReady ? React.createElement('div', { style: { marginTop: 7, fontSize: 12 } }, 'NMEA 2000 output is waiting; the read action becomes available when output is ready.') : null,
        reading ? React.createElement('div', { style: { marginTop: 8, fontSize: 12 } }, 'Receiving configuration · ' + (read.receivedBytes || 0) + ' bytes' + (read.blockCount != null ? ' · ' + read.blockCount + ' blocks' : '') + (read.lastPacketAt ? ' · last block ' + new Date(read.lastPacketAt).toLocaleTimeString() : '')) : null,
        read && read.status === 'complete' ? React.createElement('div', { style: { marginTop: 8, fontSize: 12 } }, 'Saved: ' + (read.file || 'CZone network configuration')) : null
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Confirm before turning on'),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'For circuits where an accidental ON could be undesirable. The webapp asks "are you sure?" before turning one of these on. CZone keypads, displays and modes are not affected.'),
        confirmOnList().map(function (e, i) {
          var known = !data || !Array.isArray(data.circuitNames) || data.circuitNames.some(function (n) { return n.trim().toLowerCase() === String(e.circuit).trim().toLowerCase() })
          return React.createElement('div', { key: e.circuit + ':' + i, style: { marginTop: 8 } },
            React.createElement('span', { style: { display: 'inline-block', minWidth: 170, marginRight: 8, fontWeight: 600 } }, e.circuit + (known ? '' : ' (not in this configuration)')),
            React.createElement('button', { type: 'button', disabled: busy, onClick: function () { removeConfirmOn(i) } }, 'Remove')
          )
        }),
        React.createElement('label', { style: { display: 'block', marginTop: 10 } }, 'Add a circuit ',
          React.createElement('select', { value: '', disabled: busy || !data || !Array.isArray(data.circuitNames) || !data.circuitNames.length, onChange: function (e) { addConfirmOn(e.target.value) } },
            [React.createElement('option', { key: '', value: '' }, data && Array.isArray(data.circuitNames) && data.circuitNames.length ? 'Choose a circuit' : 'Load a CZone configuration first')].concat(
              (data && Array.isArray(data.circuitNames) ? data.circuitNames : [])
                .filter(function (n) { return !confirmOnList().some(function (e) { return String(e.circuit).trim().toLowerCase() === n.trim().toLowerCase() }) })
                .map(function (n) { return React.createElement('option', { key: n, value: n }, n) })
            )
          )
        ),
        React.createElement('label', { style: { display: 'block', marginTop: 12 } },
          React.createElement('input', { type: 'checkbox', checked: configuration.confirmOnAllowElsewhere === true, disabled: busy || !confirmOnList().length, onChange: function (e) { persist({ confirmOnAllowElsewhere: e.target.checked }) } }),
          ' Let other apps turn these circuits on'
        ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Other Signal K apps switch with a PUT and cannot ask "are you sure?". Unticked, an on from them is refused with a message. The circuit can still be turned on from the webapp or a CZone keypad.')
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Confirm before turning off'),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'For circuits that must not go off by a slip of a finger: freezers and fridges, instruments, anything that powers the Signal K server, the network or a display. The webapp asks "are you sure?" before turning one of these off. Turning on is never held up. CZone keypads, displays and modes are not affected.'),
        confirmOffList().map(function (e, i) {
          var known = !data || !Array.isArray(data.circuitNames) || data.circuitNames.some(function (n) { return n.trim().toLowerCase() === String(e.circuit).trim().toLowerCase() })
          return React.createElement('div', { key: e.circuit + ':' + i, style: { marginTop: 8 } },
            React.createElement('span', { style: { display: 'inline-block', minWidth: 170, marginRight: 8, fontWeight: 600 } }, e.circuit + (known ? '' : ' (not in this configuration)')),
            React.createElement('button', { type: 'button', disabled: busy, onClick: function () { removeConfirmOff(i) } }, 'Remove')
          )
        }),
        React.createElement('label', { style: { display: 'block', marginTop: 10 } }, 'Add a circuit ',
          React.createElement('select', { value: '', disabled: busy || !data || !Array.isArray(data.circuitNames) || !data.circuitNames.length, onChange: function (e) { addConfirmOff(e.target.value) } },
            [React.createElement('option', { key: '', value: '' }, data && Array.isArray(data.circuitNames) && data.circuitNames.length ? 'Choose a circuit' : 'Load a CZone configuration first')].concat(
              (data && Array.isArray(data.circuitNames) ? data.circuitNames : [])
                .filter(function (n) { return !confirmOffList().some(function (e) { return String(e.circuit).trim().toLowerCase() === n.trim().toLowerCase() }) })
                .map(function (n) { return React.createElement('option', { key: n, value: n }, n) })
            )
          )
        ),
        React.createElement('label', { style: { display: 'block', marginTop: 12 } },
          React.createElement('input', { type: 'checkbox', checked: configuration.confirmOffAllowElsewhere === true, disabled: busy || !confirmOffList().length, onChange: function (e) { persist({ confirmOffAllowElsewhere: e.target.checked }) } }),
          ' Let other apps turn these circuits off'
        ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Other Signal K apps switch with a PUT and cannot ask "are you sure?". Unticked, an off from them is refused with a message. The circuit can still be turned off from the webapp or a CZone keypad.')
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Third-party switches'),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Switch something that is not on the CZone network from a CZone display or keypad: a Shelly, a GX relay set to Manual, or any output in the Victron switch pane. In the CZone configuration add a virtual circuit for it and put it on the display, then link that circuit here. The switch follows the CZone circuit, and the circuit follows the switch when it is switched from anywhere else (that needs Enable CZone read/write control). Nothing is switched when the plugin starts: if the two differ, the link shows out of step until one is switched. A circuit set to confirm before turning on or off is never switched that way by a link.'),
        bridgeList().map(function (b, i) {
          var st = linkStatus.filter(function (l) { return l.circuit === b.circuit })[0]
          var state = !st ? '' : st.error ? ' · ' + st.error : st.inStep === true ? ' · in step (' + (st.device ? 'ON' : 'OFF') + ')' : st.inStep === false ? ' · out of step' : ' · waiting for both sides'
          return React.createElement('div', { key: b.circuit + ':' + i, style: { marginTop: 8 } },
            React.createElement('span', { style: { fontWeight: 600 } }, b.circuit),
            React.createElement('span', null, ' \u2194 ' + bridgeTarget(b)),
            React.createElement('span', { style: { fontSize: 12, color: st && st.error ? '#b00' : '#555' } }, state + ' '),
            React.createElement('button', { type: 'button', disabled: busy, onClick: function () { removeBridge(i) } }, 'Remove')
          )
        }),
        React.createElement('div', { style: { marginTop: 12 } },
          React.createElement('label', null, 'CZone circuit ',
            React.createElement('select', { value: bridgeCircuit, disabled: busy, onChange: function (e) { setBridgeCircuit(e.target.value) } },
              [React.createElement('option', { key: '', value: '' }, data && Array.isArray(data.allCircuitNames) && data.allCircuitNames.length ? 'Choose a circuit' : 'Load a CZone configuration first')].concat(
                (data && Array.isArray(data.allCircuitNames) ? data.allCircuitNames : [])
                  .filter(function (n) { return !bridgeList().some(function (b) { return b.circuit === n }) })
                  .map(function (n) { return React.createElement('option', { key: n, value: n }, n) })
              )
            )
          ),
          React.createElement('label', { style: { marginLeft: 12 } }, 'linked to ',
            React.createElement('select', { value: bridgeKind, disabled: busy, onChange: function (e) { setBridgeKind(e.target.value) } },
              React.createElement('option', { value: 'victron' }, 'a Victron output (through the GX)'),
              React.createElement('option', { value: 'shelly' }, 'a Shelly (directly, by IP address)')
            )
          )
        ),
        bridgeKind === 'victron'
          ? React.createElement('div', { style: { marginTop: 8 } },
              React.createElement('select', { value: bridgeOutput, disabled: busy || !outputs || outputs.loading || !(outputs.outputs || []).length, onChange: function (e) { setBridgeOutput(e.target.value) } },
                [React.createElement('option', { key: '', value: '' }, !outputs || outputs.loading ? 'Looking for Victron outputs…' : (outputs.outputs || []).length ? 'Choose an output' : (outputs.detail || 'No switchable outputs found on the GX'))].concat(
                  (outputs && outputs.outputs ? outputs.outputs : []).map(function (o) { return React.createElement('option', { key: o.value, value: o.value, disabled: o.available === false }, o.label + (o.available === false ? ' (' + o.reason + ')' : '')) })
                )
              ),
              React.createElement('button', { type: 'button', style: { marginLeft: 8 }, disabled: busy, onClick: loadOutputs }, 'Look again')
            )
          : React.createElement('div', { style: { marginTop: 8 } },
              React.createElement('label', null, 'IP address ',
                React.createElement('input', { type: 'text', value: bridgeHost, placeholder: '192.168.1.204', disabled: busy, onChange: function (e) { setBridgeHost(e.target.value); setShellyTest('') }, style: { width: 140 } })
              ),
              React.createElement('label', { style: { marginLeft: 10 } }, 'channel ',
                React.createElement('input', { type: 'number', min: 0, value: bridgeChannel, disabled: busy, onChange: function (e) { setBridgeChannel(e.target.value) }, style: { width: 50 } })
              ),
              React.createElement('button', { type: 'button', style: { marginLeft: 8 }, disabled: busy || !bridgeHost.trim(), onClick: testShelly }, 'Test'),
              shellyTest ? React.createElement('span', { style: { marginLeft: 8, fontSize: 12 } }, shellyTest) : null,
              React.createElement('div', { style: { marginTop: 4, fontSize: 12 } }, 'Shelly Gen2 or later, with no password. Reserve its address in the router so it does not change.')
            ),
        React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('button', { type: 'button', disabled: busy || !bridgeCircuit || (bridgeKind === 'victron' ? !bridgeOutput : !bridgeHost.trim()), onClick: addBridge }, 'Link')
        )
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Victron switch pane'),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Victron GX only (Venus OS 3.60 or later). The CZone circuits as switches on the GX touch screen, Remote Console and VRM, one card per CZone category. Switching there needs CZone read/write control enabled; circuits set to confirm before turning off (on) are not turned off (on) from there unless other apps are allowed to.'),
        React.createElement('div', { style: { marginTop: 9 } },
          React.createElement('label', null,
            React.createElement('input', { type: 'checkbox', checked: configuration.victronSwitches === true, disabled: busy, onChange: function (e) { persist({ victronSwitches: e.target.checked }) } }),
            ' Show CZone circuits in the Victron switch pane'
          )
        ),
        React.createElement('div', { style: { marginTop: 6 } },
          React.createElement('label', null,
            React.createElement('input', { type: 'checkbox', checked: configuration.victronSwitchCurrent !== false, disabled: busy || configuration.victronSwitches !== true, onChange: function (e) { persist({ victronSwitchCurrent: e.target.checked }) } }),
            ' Show circuit current in the label while on'
          )
        ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, paneSummary())
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Monitoring'),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Off by default. Adds a Monitoring tab to the webapp: every meter, tank, temperature, humidity and pressure sender in the ZCF, live, with DC watts (solar, alternators, wind). A temperature named after a circuit ("Freezer Temperature") shows beside the circuit and in its Victron switch pane label. Meter readings are published to Signal K either way.'),
        React.createElement('div', { style: { marginTop: 9 } },
          React.createElement('label', null,
            React.createElement('input', { type: 'checkbox', checked: configuration.monitoringEnabled === true, disabled: busy, onChange: function (e) { persist({ monitoringEnabled: e.target.checked }) } }),
            ' Show the Monitoring tab'
          )
        )
      ),

      React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, 'Trends'),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Off by default. Stores each circuit\'s current and every monitored value every 10 seconds as plain CSV files, for the trend charts in the webapp (the arrow at the end of a circuit row, or a value on the Monitoring tab). Not needed if the data already goes to a database such as InfluxDB.'),
        React.createElement('div', { style: { marginTop: 9 } },
          React.createElement('label', null,
            React.createElement('input', { type: 'checkbox', checked: configuration.trendsEnabled === true, disabled: busy, onChange: function (e) { persist({ trendsEnabled: e.target.checked }) } }),
            ' Record trends'
          )
        ),
        React.createElement('div', { id: 'czone-trend-status', style: { marginTop: 6, fontSize: 12 } }, trendSummary()),
        React.createElement('label', { style: { display: 'block', marginTop: 10 } }, 'Trend folder (optional) ',
          React.createElement('input', { type: 'text', style: { width: '60%' }, placeholder: 'Automatic', defaultValue: configuration.trendDirectory || '', disabled: busy, onBlur: function (e) { var value = (e.target.value || '').trim(); if (value !== (configuration.trendDirectory || '')) persist({ trendDirectory: value }) } })
        ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Blank = automatic. On a Victron GX trends go to an SD card or USB stick, never to internal flash. On a Pi or PC they go to the plugin data folder.'),
        React.createElement('label', { style: { display: 'block', marginTop: 10 } }, 'Keep full-detail trend data for ',
          React.createElement('select', { value: String(configuration.trendRetentionDays || 0), disabled: busy, onChange: function (e) { persist({ trendRetentionDays: Number(e.target.value) }) } },
            React.createElement('option', { value: '0' }, 'Until the storage is nearly full'),
            React.createElement('option', { value: '31' }, '31 days'),
            React.createElement('option', { value: '90' }, '90 days'),
            React.createElement('option', { value: '365' }, '1 year')
          )
        ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Ten-minute summaries are kept regardless. When storage runs low the oldest full-detail days are removed first, so recording never stops.')
      ),

      current ? React.createElement('div', { style: { fontSize: 12 } }, 'Currently loaded: ' + (current.vesselName || current.fileName) + ' · ' + current.circuits + ' circuits · ' + current.modes + ' modes') : null,
      error ? React.createElement('div', { role: 'alert', style: { marginTop: 9 } }, 'Error: ' + error) : null
    )
  }

  var modules = { './PluginConfigurationPanel': function () { return { default: PluginConfigurationPanel } } }
  return {
    get: function (request) {
      if (!modules[request]) return Promise.reject(new Error('Unknown exposed module: ' + request))
      return Promise.resolve(modules[request])
    },
    init: function () { return Promise.resolve() }
  }
})()
