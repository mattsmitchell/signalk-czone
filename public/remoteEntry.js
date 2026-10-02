/*
 * Signal K classic Module Federation container.
 * Exposes ./PluginConfigurationPanel without bundling React; the Signal K
 * Admin UI supplies the host React instance.
 */
var signalk_czone = (function () {
  function getReact () {
    var React = globalThis.__SK_REACT__ || globalThis.React
    if (!React) throw new Error('Signal K Admin UI React host was not found')
    return React
  }

  function fmtBytes (bytes) {
    if (bytes == null) return '—'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function fmtUptime (seconds) {
    if (seconds == null) return '—'
    var s = Number(seconds) || 0
    var d = Math.floor(s / 86400)
    s %= 86400
    var h = Math.floor(s / 3600)
    s %= 3600
    var m = Math.floor(s / 60)
    var sec = s % 60
    return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + sec + 's'
  }

  function fmtTime (value) {
    if (!value) return '—'
    try { return new Date(value).toLocaleString() } catch (_) { return String(value) }
  }

  function Cell (React, value) {
    return React.createElement('td', { style: { padding: '4px 6px', borderBottom: '1px solid #ddd', fontSize: 12 } }, value == null ? '—' : String(value))
  }

  function Diagnostics (props) {
    var React = getReact()
    var stateData = React.useState(null)
    var data = stateData[0]
    var setData = stateData[1]
    var stateBusy = React.useState(true)
    var busy = stateBusy[0]
    var setBusy = stateBusy[1]
    var stateError = React.useState('')
    var error = stateError[0]
    var setError = stateError[1]

    function load () {
      setBusy(true)
      setError('')
      return fetch('/plugins/signalk-czone/diagnostics', { credentials: 'same-origin' })
        .then(function (response) {
          return response.text().then(function (body) {
            var value
            try { value = JSON.parse(body) } catch (_) { value = null }
            if (!response.ok) throw new Error(value && value.error ? value.error : body || ('HTTP ' + response.status))
            return value
          })
        })
        .then(function (value) { setData(value) })
        .catch(function (err) { setError(err && err.message ? err.message : String(err)) })
        .finally(function () { setBusy(false) })
    }

    React.useEffect(function () {
      var active = true
      load()
      var timer = setInterval(function () { if (active) load() }, 3000)
      return function () { active = false; clearInterval(timer) }
    }, [])

    if (busy && !data) return React.createElement('div', null, 'Loading CZone diagnostics…')
    if (error && !data) return React.createElement('div', { role: 'alert' }, 'Diagnostics unavailable: ' + error)
    if (!data) return React.createElement('div', null, 'No diagnostic data available.')

    var counters = data.counters || {}
    var zcf = data.zcf || {}
    var circuits = Array.isArray(data.circuits) ? data.circuits : []
    var last = data.diagnostics || {}
    var cardStyle = { border: '1px solid #ddd', borderRadius: 4, padding: 10, marginBottom: 10 }
    var tableStyle = { borderCollapse: 'collapse', width: '100%' }

    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
        React.createElement('h4', { style: { margin: 0 } }, 'CZone diagnostics'),
        React.createElement('button', { type: 'button', disabled: busy, onClick: load }, busy ? 'Refreshing…' : 'Refresh')
      ),
      error ? React.createElement('div', { role: 'alert', style: { marginBottom: 8 } }, error) : null,
      React.createElement('div', { style: cardStyle },
        React.createElement('strong', null, 'Plugin'),
        React.createElement('div', { style: { marginTop: 6 } }, 'Status: ', data.running ? 'Running' : 'Stopped'),
        React.createElement('div', null, 'Uptime: ', fmtUptime(data.uptimeSeconds)),
        React.createElement('div', null, 'Reassembly in progress: ', last.reassemblyInProgress == null ? '—' : last.reassemblyInProgress)
      ),
      React.createElement('div', { style: cardStyle },
        React.createElement('strong', null, 'ZCF'),
        React.createElement('div', { style: { marginTop: 6 } }, zcf.fileName || 'No ZCF loaded'),
        React.createElement('div', null, 'Size: ', fmtBytes(zcf.fileSize)),
        React.createElement('div', null, 'Circuits: ', zcf.circuits == null ? '—' : zcf.circuits, '  •  Current mappings: ', zcf.currentMappings == null ? '—' : zcf.currentMappings),
        React.createElement('div', null, 'Mappings by PGN: ', JSON.stringify(zcf.mappingsByPgn || {})),
        zcf.warnings && zcf.warnings.length ? React.createElement('div', { style: { marginTop: 5 } }, 'Warnings: ', zcf.warnings.join('; ')) : null
      ),
      React.createElement('div', { style: cardStyle },
        React.createElement('strong', null, 'Traffic'),
        React.createElement('div', { style: { marginTop: 6 } }, 'Raw frames: ', counters.rawFrames || 0),
        React.createElement('div', null, 'CZone packets: ', counters.packetsDecoded || 0),
        React.createElement('div', null, 'DC packets: ', counters.dcPackets || 0, '  •  AC packets: ', counters.acPackets || 0),
        React.createElement('div', null, 'Values published: ', counters.valuesPublished || 0),
        React.createElement('div', null, 'Unmapped: ', counters.unmapped || 0, '  •  Invalid: ', counters.invalidCzone || 0, '  •  Parse errors: ', counters.parseErrors || 0, '  •  Decode errors: ', counters.decodeErrors || 0)
      ),
      React.createElement('div', { style: cardStyle },
        React.createElement('strong', null, 'Last activity'),
        React.createElement('div', { style: { marginTop: 6 } }, 'Last DC packet: ', fmtTime(last.lastDcPacket && last.lastDcPacket.timestamp)),
        React.createElement('div', null, 'Last AC packet: ', fmtTime(last.lastAcPacket && last.lastAcPacket.timestamp)),
        React.createElement('div', null, 'Last published: ', fmtTime(last.lastPublished && last.lastPublished.timestamp)),
        counters.lastError ? React.createElement('div', { style: { marginTop: 5 } }, 'Last error: ', counters.lastError) : null
      ),
      React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('strong', null, 'Published circuits (', circuits.length, ')'),
        React.createElement('div', { style: { overflowX: 'auto', marginTop: 6 } },
          React.createElement('table', { style: tableStyle },
            React.createElement('thead', null,
              React.createElement('tr', null,
                React.createElement('th', { style: { textAlign: 'left', padding: '4px 6px' } }, 'Path'),
                React.createElement('th', { style: { textAlign: 'right', padding: '4px 6px' } }, 'A'),
                React.createElement('th', { style: { textAlign: 'right', padding: '4px 6px' } }, 'PGN'),
                React.createElement('th', { style: { textAlign: 'right', padding: '4px 6px' } }, 'Module'),
                React.createElement('th', { style: { textAlign: 'right', padding: '4px 6px' } }, 'Page'),
                React.createElement('th', { style: { textAlign: 'right', padding: '4px 6px' } }, 'Slot'),
                React.createElement('th', { style: { textAlign: 'right', padding: '4px 6px' } }, 'Source'),
                React.createElement('th', { style: { textAlign: 'left', padding: '4px 6px' } }, 'Last update')
              )
            ),
            React.createElement('tbody', null,
              circuits.map(function (circuit, index) {
                return React.createElement('tr', { key: circuit.path || index },
                  Cell(React, circuit.path),
                  Cell(React, circuit.current),
                  Cell(React, circuit.pgn),
                  Cell(React, circuit.module == null ? null : '0x' + Number(circuit.module).toString(16).padStart(2, '0')),
                  Cell(React, circuit.page),
                  Cell(React, circuit.slot),
                  Cell(React, circuit.source == null ? null : '0x' + Number(circuit.source).toString(16).padStart(2, '0')),
                  Cell(React, fmtTime(circuit.timestamp))
                )
              })
            )
          )
        )
      )
    )
  }

  function PluginConfigurationPanel (props) {
    var React = getReact()
    var configuration = props.configuration || {}
    var save = props.save
    var useState = React.useState
    var stateFile = useState(null)
    var file = stateFile[0]
    var setFile = stateFile[1]
    var stateInstalledPath = useState(configuration.zcfPath || '')
    var installedPath = stateInstalledPath[0]
    var setInstalledPath = stateInstalledPath[1]
    var stateBusy = useState(false)
    var busy = stateBusy[0]
    var setBusy = stateBusy[1]
    var stateMessage = useState('')
    var message = stateMessage[0]
    var setMessage = stateMessage[1]
    var stateError = useState('')
    var error = stateError[0]
    var setError = stateError[1]
    var stateTab = useState('configuration')
    var tab = stateTab[0]
    var setTab = stateTab[1]

    function upload () {
      if (!file) return Promise.resolve()
      setBusy(true)
      setMessage('')
      setError('')
      var form = new FormData()
      form.append('zcf', file, file.name)
      return fetch('/plugins/signalk-czone/zcf/upload', {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      }).then(function (response) {
        return response.text().then(function (body) {
          var data
          try { data = JSON.parse(body) } catch (_) { data = null }
          if (!response.ok) throw new Error(data && data.error ? data.error : body || ('HTTP ' + response.status))
          return data || {}
        })
      }).then(function (data) {
        if (data.zcfPath) setInstalledPath(data.zcfPath)
        if (data.configuration) save(Object.assign({}, configuration, data.configuration))
        setMessage(data.message || 'ZCF installed successfully. The plugin will restart.')
        setFile(null)
      }).catch(function (err) {
        setError(err && err.message ? err.message : String(err))
      }).finally(function () { setBusy(false) })
    }

    function onSave () {
      save({
        zcfPath: installedPath || configuration.zcfPath || '',
        logUnmapped: configuration.logUnmapped === true,
        debugRaw: configuration.debugRaw === true,
        allowCzoneWrite: configuration.allowCzoneWrite === true
      })
    }

    function setCzoneWrite (value) {
      save({
        zcfPath: installedPath || configuration.zcfPath || '',
        logUnmapped: configuration.logUnmapped === true,
        debugRaw: configuration.debugRaw === true,
        allowCzoneWrite: value
      })
    }

    var tabButtonStyle = function (active) {
      return { marginRight: 6, padding: '5px 10px', fontWeight: active ? 'bold' : 'normal' }
    }

    return React.createElement('div', null,
      React.createElement('div', { style: { marginBottom: 12 } },
        React.createElement('button', { type: 'button', style: tabButtonStyle(tab === 'configuration'), onClick: function () { setTab('configuration') } }, 'Configuration'),
        React.createElement('button', { type: 'button', style: tabButtonStyle(tab === 'diagnostics'), onClick: function () { setTab('diagnostics') } }, 'Diagnostics')
      ),
      tab === 'diagnostics' ? React.createElement(Diagnostics, props) : React.createElement('div', null,
        React.createElement('h4', null, 'CZone configuration'),
        React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('label', null, 'ZCF file'),
          React.createElement('br'),
          React.createElement('input', { type: 'file', accept: '.zcf,application/octet-stream', disabled: busy, onChange: function (e) { setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null) } }),
          React.createElement('div', { style: { marginTop: 6 } },
            React.createElement('button', { type: 'button', disabled: !file || busy, onClick: upload }, busy ? 'Uploading…' : 'Upload and install ZCF')
          )
        ),
        React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('label', null, 'Installed ZCF path'),
          React.createElement('br'),
          React.createElement('input', { type: 'text', value: installedPath || '', readOnly: true, style: { width: '100%' } })
        ),
        React.createElement('div', { style: { marginTop: 14, marginBottom: 12, padding: 12, border: '1px solid #ccc', borderRadius: 6 } },
          React.createElement('label', null,
            React.createElement('input', {
              type: 'checkbox',
              checked: configuration.allowCzoneWrite === true,
              disabled: busy,
              onChange: function (e) { setCzoneWrite(e.target.checked) }
            }),
            ' Enable CZone read/write control'
          ),
          React.createElement('div', { style: { marginTop: 6, fontSize: 12 } },
            'Allows this plugin to send commands to CZone devices. This can change circuit states, modes, and configuration. Enable only if you understand the risks.'
          ),
          React.createElement('div', { style: { marginTop: 10 } },
            React.createElement('button', {
              type: 'button',
              disabled: busy || configuration.allowCzoneWrite !== true,
              onClick: function () {}
            }, 'Read CZone configuration from network'),
            configuration.allowCzoneWrite !== true
              ? React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Enable CZone read/write control before reading configuration from the network. Reading the configuration requires sending a request to the CZone network.')
              : React.createElement('div', { style: { marginTop: 6, fontSize: 12 } }, 'Network configuration reading will be available when the CZone network read path is enabled.')
          )
        ),
        React.createElement('label', null,
          React.createElement('input', { type: 'checkbox', checked: configuration.logUnmapped === true, onChange: function (e) { save(Object.assign({}, configuration, { zcfPath: installedPath || configuration.zcfPath || '', logUnmapped: e.target.checked })) } }),
          ' Log unmapped circuits'
        ),
        React.createElement('br'),
        React.createElement('label', null,
          React.createElement('input', { type: 'checkbox', checked: configuration.debugRaw === true, onChange: function (e) { save(Object.assign({}, configuration, { zcfPath: installedPath || configuration.zcfPath || '', debugRaw: e.target.checked })) } }),
          ' Log completed raw CZone packets'
        ),
        React.createElement('div', { style: { marginTop: 12 } },
          React.createElement('button', { type: 'button', disabled: busy, onClick: onSave }, 'Save configuration')
        ),
        message ? React.createElement('div', { role: 'status', style: { marginTop: 8 } }, message) : null,
        error ? React.createElement('div', { role: 'alert', style: { marginTop: 8 } }, 'Upload failed: ' + error) : null
      )
    )
  }

  var modules = {
    './PluginConfigurationPanel': function () { return { default: PluginConfigurationPanel } }
  }

  return {
    get: function (request) {
      if (!modules[request]) return Promise.reject(new Error('Unknown exposed module: ' + request))
      return Promise.resolve(modules[request])
    },
    init: function () { return Promise.resolve() }
  }
})()
