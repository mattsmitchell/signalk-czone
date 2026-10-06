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

    React.useEffect(function () {
      loadConfiguration().catch(function (err) { setError(err.message || String(err)) })
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

    function confirmList (settingName) {
      return (Array.isArray(configuration[settingName]) ? configuration[settingName] : [])
        .map(function (e) { return typeof e === 'string' ? { circuit: e } : e })
        .filter(function (e) { return e && e.circuit })
        .map(function (e) { return { circuit: e.circuit } })
    }

    function addConfirm (settingName, name) {
      if (!name) return
      var next = {}
      next[settingName] = confirmList(settingName).concat([{ circuit: name }])
      persist(next)
    }

    function removeConfirm (settingName, index) {
      var next = {}
      next[settingName] = confirmList(settingName).filter(function (_e, i) { return i !== index })
      persist(next)
    }

    function confirmBox (settingName, title, description, allowName, allowLabel) {
      var list = confirmList(settingName)
      var names = data && Array.isArray(data.circuitNames) ? data.circuitNames : []
      return React.createElement('div', { style: { marginBottom: 14, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
        React.createElement('strong', null, title),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, description),
        list.map(function (e, i) {
          var known = !names.length || names.some(function (n) { return n.trim().toLowerCase() === String(e.circuit).trim().toLowerCase() })
          return React.createElement('div', { key: settingName + ':' + e.circuit + ':' + i, style: { marginTop: 8 } },
            React.createElement('span', { style: { display: 'inline-block', minWidth: 170, marginRight: 8, fontWeight: 600 } }, e.circuit + (known ? '' : ' (not in this configuration)')),
            React.createElement('button', { type: 'button', disabled: busy, onClick: function () { removeConfirm(settingName, i) } }, 'Remove')
          )
        }),
        React.createElement('label', { style: { display: 'block', marginTop: 10 } }, 'Add a circuit ',
          React.createElement('select', { value: '', disabled: busy || !names.length, onChange: function (e) { addConfirm(settingName, e.target.value) } },
            [React.createElement('option', { key: '', value: '' }, names.length ? 'Choose a circuit' : 'Load a CZone configuration first')].concat(
              names.filter(function (n) { return !list.some(function (e) { return String(e.circuit).trim().toLowerCase() === n.trim().toLowerCase() }) })
                .map(function (n) { return React.createElement('option', { key: n, value: n }, n) })
            )
          )
        ),
        React.createElement('label', { style: { display: 'block', marginTop: 12 } },
          React.createElement('input', { type: 'checkbox', checked: configuration[allowName] === true, disabled: busy || !list.length, onChange: function (e) { var next = {}; next[allowName] = e.target.checked; persist(next) } }),
          ' ' + allowLabel
        ),
        React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Other Signal K apps use PUT and cannot show this confirmation. Unticked, matching requests from them are refused. CZone keypads, displays and modes are not affected.')
      )
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

      confirmBox('confirmOn', 'Confirm before turning on', 'Choose circuits where an accidental ON could be undesirable. The CZone webapp asks before sending the ON command.', 'confirmOnAllowElsewhere', 'Let other apps turn these circuits on'),
      confirmBox('confirmOff', 'Confirm before turning off', 'Choose circuits that must not go off by a slip of a finger, such as refrigeration, instruments, network or server power.', 'confirmOffAllowElsewhere', 'Let other apps turn these circuits off'),

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
