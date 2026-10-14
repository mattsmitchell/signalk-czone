# ZCF test fixtures

These six canonical boat configurations are copied byte-for-byte from
[mattsmitchell/signalk-czone-zcf](https://github.com/mattsmitchell/signalk-czone-zcf/tree/4991170ac20a3506bfcc1131b2c7dd025c4a983c/test/fixtures)
at commit `4991170ac20a3506bfcc1131b2c7dd025c4a983c`, matching the pinned parser dependency.

They are test inputs only and are excluded from the npm package by its `files` list.
Keeping them here makes `npm test` independent of fixture downloads and ensures
fixture-backed integration tests cannot silently skip. Update them intentionally
alongside the corresponding parser expectations.
