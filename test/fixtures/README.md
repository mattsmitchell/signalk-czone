# ZCF test fixtures

These six canonical boat configurations are copied byte-for-byte from
[mattsmitchell/signalk-czone-zcf](https://github.com/mattsmitchell/signalk-czone-zcf/tree/4991170ac20a3506bfcc1131b2c7dd025c4a983c/test/fixtures)
at commit `4991170ac20a3506bfcc1131b2c7dd025c4a983c`, matching the pinned parser dependency.

They are test inputs only and are excluded from the npm package by its `files` list.
Keeping them here makes `npm test` independent of fixture downloads and ensures
fixture-backed integration tests cannot silently skip. Update them intentionally
alongside the corresponding parser expectations.

Two more come from the test boats of the monitoring work, for the senders and
meters on their Inputs and Meters tabs:

- `Compass-Rose-03.10.26.zcf`: Compass Rose, 3 October 2026. Four third-party
  temperatures (Ruuvi tags bridged by the Cerbo), a third-party fuel tank and
  an atmospheric pressure sender, two DC and two AC meters.
- `TestBench-2026-10-01.zcf`: the CZone test bench, 1 October 2026. A Ruuvi
  tag and a Victron temperature sensor as third-party senders, a Victron shunt
  and a Meter Interface's DC and AC meters.
