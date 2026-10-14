'use strict'

// Test-only preload: expose Venus OS detection and a filesystem below its reserve.
// Trend unit tests must use their injected platform/space providers on this host.
const fs = require('fs')
const exists = fs.existsSync
fs.existsSync = function (p) { return p === '/opt/victronenergy' || exists.call(this, p) }
fs.statfsSync = () => ({ bavail: 0, blocks: 1000000, bsize: 4096 })
