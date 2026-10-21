'use strict'

// Which device a meter or sender reading may come from.
//
// NMEA 2000 instances are not unique across devices, so the same message
// with the same instance often comes from more than one device:
//   - a Victron charger or inverter sends a battery status (127508) on the
//     battery's instance as well as the shunt;
//   - a meter wired to a CZone module (bench Meter Interface, instance 0) and
//     another device using instance 0 for something else;
//   - one sender seen from two places.
// Without rules a reading flips between devices. The rules:
//   1. A meter or sender wired to a CZone module is read only from that
//      module's own address, learned from its status messages (27 99 <module>).
//   2. A third-party meter or sender (module 0 in the ZCF) is never read from
//      a CZone module's address.
//   3. A third-party DC meter: when devices declare their DC type for the
//      instance (127506), only a device declaring the meter's type is used;
//      for a battery, one that reports a state of charge beats one that does
//      not (a shunt beats a charger). Ties go to the lowest address, so the
//      choice is the same after every restart.
//   4. Otherwise the first device heard keeps the reading until it has been
//      quiet for QUIET_MS.

const QUIET_MS = 120e3
// Module status PGNs that carry "27 99 <module>": 65284, 65301, 65302, 65308.
const MODULE_STATUS_PGNS = new Set([65284, 65301, 65302, 65308])
const DC_TYPES = ['battery', 'alternator', 'converter', 'solar', 'wind']

function createSourcePicker ({ quietMs = QUIET_MS } = {}) {
  const moduleAddress = new Map() // CZone module dipswitch -> NMEA 2000 address
  const dcDeclared = new Map() // instance -> Map(address -> { dcType, soc, at })
  const owners = new Map() // reading key -> { device, at }

  function learn (frame) {
    if (!frame || !MODULE_STATUS_PGNS.has(frame.pgn) || !frame.data || frame.data.length < 3) return
    if (frame.data[0] !== 0x27 || frame.data[1] !== 0x99) return
    moduleAddress.set(frame.data[2], frame.source)
  }

  const isCzone = address => {
    for (const a of moduleAddress.values()) if (a === address) return true
    return false
  }

  // A device's 127506 for an instance: its DC type, and whether it reports a
  // state of charge.
  function noteDcDetailed (instance, address, dcTypeCode, hasSoc, now = Date.now()) {
    if (!dcDeclared.has(instance)) dcDeclared.set(instance, new Map())
    dcDeclared.get(instance).set(address, { dcType: DC_TYPES[dcTypeCode] || null, soc: !!hasSoc, at: now })
  }

  function chosenDcDevice (instance, dcType, now) {
    const devices = dcDeclared.get(instance)
    if (!devices) return undefined
    let best
    for (const [address, d] of devices) {
      if (now - d.at > quietMs || d.dcType !== dcType) continue
      const rank = dcType === 'battery' && d.soc ? 1 : 0
      if (!best || rank > best.rank || (rank === best.rank && address < best.address)) best = { address, rank }
    }
    return best ? best.address : undefined
  }

  // item: { key, module, dcType? } (module 0 or virtual = third-party);
  // address: the sending device's NMEA 2000 address, or a name such as
  // 'signalk' for a reading Signal K itself sends.
  function allowed (item, address, now = Date.now()) {
    const wired = Number.isInteger(item.module) && item.module !== 0 && item.virtual !== true
    if (wired) return moduleAddress.has(item.module) && moduleAddress.get(item.module) === address
    if (isCzone(address)) return false
    if (item.dcType && Number.isInteger(item.instance)) {
      const chosen = chosenDcDevice(item.instance, item.dcType, now)
      if (chosen !== undefined) {
        if (address !== chosen) return false
        owners.set(item.key, { device: address, at: now })
        return true
      }
    }
    const owner = owners.get(item.key)
    if (owner && owner.device !== address && now - owner.at < quietMs) return false
    owners.set(item.key, { device: address, at: now })
    return true
  }

  function clear () { moduleAddress.clear(); dcDeclared.clear(); owners.clear() }

  return { learn, noteDcDetailed, allowed, isCzone, moduleAddress: m => moduleAddress.get(m), clear }
}

module.exports = { createSourcePicker, QUIET_MS, MODULE_STATUS_PGNS }
