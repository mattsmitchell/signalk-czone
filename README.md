# signalk-czone

`signalk-czone` makes CZone electrical current information available to Signal K.

It listens to NMEA 2000 traffic, identifies CZone current messages, reassembles their Fast Packets, decodes the AC and DC current measurements, and uses the vessel's CZone ZCF configuration to determine which circuit each measurement belongs to. The resulting currents are published to Signal K using stable circuit-name-based paths, with AC/DC classification metadata for downstream systems such as InfluxDB.

The plugin accepts both raw YDWG02-style NMEA 2000 frames and parsed JSON/object NMEA 2000 frames. It also provides a dedicated ZCF upload configuration panel and diagnostics/status reporting for monitoring the decoder.

In plain English: **it watches the NMEA 2000 network for CZone electrical data, turns the raw CZone measurements into amps, identifies the CZone circuit they belong to, and makes those currents available throughout Signal K.**


<img width="2826" height="1220" alt="Image" src="https://github.com/user-attachments/assets/2768aea9-cbcd-446b-8010-0ed0aabc1865" />

## What it does

The plugin:

- listens to NMEA 2000 traffic without modifying Signal K Server, canboatjs, n2k-signalk, or global PGN definitions;
- supports both raw YDWG02-style frames and parsed JSON/object NMEA 2000 frames;
- identifies CZone AC and DC current messages;
- reassembles CZone Fast Packets;
- validates the CZone `27 99` payload format;
- decodes PGN 130817 (AC/ACOI) and PGN 130822 (DC/COI);
- uses the configured ZCF to map measurements to named CZone circuits;
- publishes stable Signal K paths such as `electrical.czone.Water_Heater_Port.current`;
- carries AC/DC classification metadata as `CZone-AC` or `CZone-DC`;
- provides ZCF upload and configuration persistence; and
- provides diagnostics/status information for troubleshooting and field testing.

The plugin is therefore a **CZone electrical-current decoder and Signal K integration**, rather than a general-purpose NMEA 2000 decoder.



## ZCF tank definitions

The canonical `signalk-czone-zcf` parser also exposes tank-monitor definitions from the installed ZCF. These definitions include tank names, calibration points, capacity, alarm/switch thresholds, delays, enable bitmaps, and configured severity codes.

For validation and diagnostics, the plugin exposes:

```text
GET /plugins/signalk-czone/monitoring/tanks
```

For example:

```bash
curl -s http://127.0.0.1:3000/plugins/signalk-czone/monitoring/tanks | jq
```

The response contains the active ZCF filename and a `tankMonitors` object with the parsed monitor definitions. This endpoint exposes **configuration only**; it does not yet represent live tank level or alarm state from NMEA 2000. Live CZone tank telemetry is a future task.

The existing electrical-monitoring definition endpoint remains:

```text
GET /plugins/signalk-czone/monitoring
```

## Design

The plugin does **not** modify Signal K Server, canboatjs, n2k-signalk, or any global PGN definitions.

At the input boundary it normalizes the NMEA 2000 frame representation, then extracts the CAN ID, reassembles Fast Packets, validates the CZone `27 99` payload, decodes PGNs 130822 (DC/COI) and 130817 (AC/ACOI), and applies the existing ZCF mapping.

The reusable `signalk-czone-zcf` library owns the ZCF parser and CZone configuration model. This plugin keeps only the runtime adapter needed to turn that model into Signal K paths and live NMEA 2000 telemetry mappings.

## ZCF upload

Version 0.2.2 replaces the unreliable generic RJSF `data-url` file field with a dedicated Signal K plugin configuration panel. The panel uses a real browser file input and uploads the selected `.zcf` file to the plugin's admin-only route:

`POST /plugins/signalk-czone/zcf/upload`

The plugin:

1. receives the multipart file directly;
2. requires a `.zcf` filename;
3. validates the temporary file using the existing `lib/zcf.js` parser;
4. atomically installs it in the plugin data directory;
5. updates the plugin configuration's `zcfPath` and restarts the plugin.

Only the installed path is stored in plugin configuration; the binary file is not placed in the JSON configuration.

Signal K plugin routes registered directly with `registerWithRouter()` are admin-only by default, which is appropriate for changing the vessel's CZone configuration.

## Confirm before turning on or off

Some circuits must not go off by a slip of a finger: a freezer, the instruments, or the circuit that powers the Signal K server, the network or the display in use. Other circuits may also need protection against an accidental ON. The ZCF does not say which circuits need either protection, so they are nominated independently in the plugin configuration panel under **Confirm before turning off** and **Confirm before turning on**.

A nominated circuit shows a padlock after its name in the webapp. Before the protected action, the webapp asks "Turn off …?" with **Keep on** / **Turn off**, or "Turn on …?" with **Keep off** / **Turn on**, before sending anything.

A Signal K PUT carries only the value and cannot say that the user was asked. By default, a protected ON or OFF PUT is answered with status 400 and nothing is sent to CZone. The independent **Let other apps turn these circuits on/off** settings can allow those PUTs where required.

CZone keypads and displays are not affected, and neither are modes: a mode switches what the CZone configuration says it switches.

After the user confirms, the webapp uses the plugin's own route:

`POST /plugins/signalk-czone/circuits/<slug>/on?confirm=1`

`POST /plugins/signalk-czone/circuits/<slug>/off?confirm=1`

Without `confirm=1` (or `{"confirm": true}` in the body) the protected route answers `409` with `{"needsConfirm": true}`. A dimmer level of 0 is treated as OFF; a positive dimmer level while the circuit is OFF (or its state has not yet been observed) is treated as ON.

Settings: `confirmOff` and `confirmOn` are lists of `{ "circuit": "<name>" }`, matched by circuit name or slug without regard to case. `confirmOffAllowElsewhere` and `confirmOnAllowElsewhere` are independent booleans, both defaulting to `false`.

### Configuration

Open **Server → Plugin Config → CZone**. The two nomination lists are independent:

- **Confirm before turning on** — add circuits where an accidental ON should require confirmation.
- **Confirm before turning off** — add circuits where an accidental OFF should require confirmation.

Choose a circuit from **Add a circuit** to nominate it; use **Remove** to remove a nomination. There is no separate Save button: each add/remove is persisted immediately.

Each list also has its own **Let other apps turn these circuits on/off** option. Leave it unticked to reject unconfirmed Signal K PUTs for that protected action; tick it when another Signal K app must be allowed to perform that action without presenting the CZone webapp confirmation.

Open CZone webapp pages update automatically when either nomination list changes. The plugin publishes a settings revision when the changed configuration is applied; connected pages receive it over their existing Signal K WebSocket connection and immediately re-read the circuit list. Padlocks and confirmation behaviour therefore update without reloading the page.

A circuit may be nominated in either list or in both.

## AC 130817

Observed CZone format:

- payload: 28 bytes
- bytes 0-1: `27 99`
- byte 2: page
- byte 3: CZone module
- bytes 4-27: 8 × 3-byte slots
- for the validated Water Heater Port mapping (`F8 / page 0 / slot 0`), the first byte of the slot is current in 0.2 A/count: `0x28` = 40 = 8.0 A

The other two bytes of each AC slot are deliberately left opaque until validated.

## DC 130822

The DC/COI slot format has been corrected from the earlier packed-value interpretation. Each 3-byte record is decoded independently:

```text
byte 0  → current
byte 1  → low byte of secondary value
byte 2  → high byte of secondary value
```

The current is:

```text
current_A = byte0 × 0.1
```

The secondary value is a little-endian 16-bit value:

```text
value_raw = byte1 | (byte2 << 8)
```

The observed/validated CZone level encoding is:

| `value_raw` | Interpretation | Percentage |
| ---: | --- | ---: |
| `0x0400` / 1024 | OFF | 0% |
| `0x0401`–`0x07E7` | DIMMED | `(value_raw - 1024) / 10` |
| `0x07E8` / 2024 | ON / 100% | 100% |
| `0x07E9`–`0x0800` | ON | 100% |
| other values | UNKNOWN | — |

The dimmed encoding has been checked against controlled observations at 60%, 75%, 80%, 90%, and 100%. The parser now uses byte 0 exclusively for current, avoiding the previous interpretation that combined all three bytes into a packed current value and could produce implausibly high readings on dimmed circuits.

The decoded secondary state and percentage are retained in the plugin diagnostics for each tracked DC circuit. The public Signal K current path remains unchanged (`electrical.czone.<circuit>.current`).

## Trends

The plugin records each circuit's current and the webapp charts it: the arrow at the end of a circuit row opens that circuit's trend at the top of the page, for the last 1 h, 24 h, 7 d, 31 d, 90 d or 1 y, or for any period chosen under **Custom**.

**What is stored.** The latest value of every `electrical.czone.<circuit>.current` path is sampled every 10 seconds, however often CZone repeats it, and written to plain CSV files in two tiers:

| Tier | File | Row | Used for |
| --- | --- | --- | --- |
| Full detail | `<series>/<YYYY-MM-DD>.csv` | `timestamp_ms,value` | charts up to 48 h |
| Ten-minute summary | `<series>/summary/<YYYY-MM>.csv` | `bucket_ms,min,avg,max` | longer charts: the line is the average, the band is min to max |

Full detail is written on change (plus the last unchanged sample before a change, and at least every 10 minutes), so a circuit that sits at 0 A adds a few kilobytes of data a day (one file per circuit per day, so on a FAT card at least one cluster each). A circuit that stops reporting for a minute is no longer recorded, so a module that drops off the bus shows as a gap, not a flat line. Samples are buffered and appended once a minute.

**Where it goes.**

- `trendDirectory`, if set.
- On a Victron GX: an SD card or USB stick only, in `signalk-czone/trends` on the card. The GX's internal flash is never written. Without a card, or with a card Signal K cannot write to, nothing is recorded and the configuration panel says why. See "Trends on an SD card or USB stick" in `README-VenusOS.md`.
- Anywhere else: `trends` in the plugin's data folder.

**How long it is kept.** Nothing is deleted by age unless `trendRetentionDays` is set (31, 90 or 365 days of full detail; summaries stay). When free space falls below a reserve (the larger of 5% and 200 MB on a card; the larger of 10% and 1 GB on a disk shared with the system) the oldest full-detail days are removed first and the oldest summary months only after that, so recording never stops.

**Settings** (in the configuration panel under **Trends**): `trendsEnabled` (default `true`), `trendDirectory` (default blank = automatic), `trendRetentionDays` (default `0` = until storage runs low).

**Routes.**

- `GET /plugins/signalk-czone/trend?path=<Signal K path>&range=1h|24h|7d|31d|90d|1y`, or `&from=<ms>&to=<ms>` for a custom period. Answers `{ available, tier, start, end, gapMs, data, latest }`, where `data` rows are `[t, value]` (full detail) or `[t, avg, min, max]` (summaries, or full detail reduced to about 400 points), and `latest` is the live value while the circuit is reporting.
- `GET /plugins/signalk-czone/trend/status` answers where trends are going, free space, and how many circuits are being recorded, or the reason trends are off.

## Installation

This release is self-contained. It includes `index.js`, `package.json`, `README.md`, `LICENSE`, `lib/nmea2000.js`, the ZCF parser in `lib/zcf.js`, and the configuration panel in `public/`.

For a manual install, extract the archive directly into `/root/.signalk/node_modules/signalk-czone` (the archive has files at its root), then restart Signal K.

For an npm-style install from the tarball, use:

```bash
cd /root/.signalk/node_modules
npm install /path/to/signalk-czone-0.3.0-beta.5.tar.gz --omit=dev
```

The package uses the canonical `signalk-czone-zcf` GitHub dependency from its `main` branch for current development and testing. Do not modify Signal K Server or canboatjs.

Then restart Signal K.

After restart, open Server -> Plugin Config -> CZone. The custom configuration panel should show **Upload and install ZCF**.

For diagnostics:

```bash
journalctl -u signalk --since "2 minutes ago" --no-pager | grep CZONE
```

Set `debugRaw` true temporarily if completed 28-byte packets need to be inspected.

Also can see on the configuration tab some the most recent messages
<img width="1242" height="1442" alt="Image" src="https://github.com/user-attachments/assets/d318f74a-cd27-4fe9-aafb-7bacd6131c51" />


## 0.2.4 startup fix

0.2.4 restores the ZCF loading function used during plugin startup. The configured ZCF is loaded and validated before the plugin registers its raw NMEA2000 listener. A missing or invalid configured ZCF prevents startup with a clear error instead of a JavaScript `load is not defined` error.


## 0.2.5 configuration persistence fix

After a successful ZCF upload, 0.2.5 explicitly persists the new `zcfPath` before restarting the plugin. The configuration panel also updates its displayed installed path immediately and uses that path for subsequent configuration saves, so the UI and the plugin startup configuration stay aligned.


## 0.3.0-beta.7

This beta corrects the PGN 130822 DC/COI three-byte record decoder using the validated CZone wire format described above. DC current now comes from record byte 0 at 0.1 A/count, while bytes 1-2 are decoded as a little-endian secondary level value. Diagnostics now expose the decoded DC level state and percentage alongside the current value.

The public Signal K circuit-current paths are unchanged.

## 0.3.0-beta.5

This beta keeps the stable circuit-name Signal K paths and diagnostics/status reporting, and adds explicit AC/DC classification metadata for downstream consumers such as InfluxDB.

### Diagnostics and status

The plugin configuration panel includes a **Diagnostics** tab alongside **Configuration**. The diagnostics view polls the plugin status periodically and is intended to make field testing and troubleshooting possible without inspecting the source code.

The status reports:

- running state and uptime
- active ZCF filename, path, and size
- total circuits and current mappings
- current-mapping counts by PGN
- raw NMEA2000 frame count
- completed CZone Fast Packet count
- DC and AC packet counts
- published-value count
- raw-frame parse errors
- invalid CZone packet count
- startup/decode errors
- unmapped DC and AC circuit counts
- Fast Packets currently in progress
- last DC packet, last AC packet, and last published value
- ZCF parser warnings
- per-circuit last observed value and update time
- per-circuit diagnostic mapping information including module, page, slot, source address, and PGN

The plugin also exposes a diagnostics route at:

```text
/diagnostics
```

Use the **Diagnostics** tab in the Signal K plugin configuration panel for normal access.

### Stable circuit naming

Published current paths use the ZCF circuit name rather than the CZone module/channel or page/slot:

```text
electrical.czone.<circuit>.current
```

For example:

```text
electrical.czone.100L_Fridge.current
electrical.czone.200L_Fridge.current
electrical.czone.AIS.current
electrical.czone.Water_Heater_Port.current
electrical.czone.Starlink.current
```

The circuit name is the stable public Signal K identity. Module, channel, page, and slot are retained as diagnostic mapping information and must not be treated as the public circuit identity.

Circuit names are sanitized for Signal K paths by trimming whitespace and replacing runs of spaces/punctuation with `_`, with leading/trailing `_` removed.

### AC/DC classification

The public current paths remain stable and unchanged:

```text
electrical.czone.<circuit>.current
```

Each published value is additionally classified as AC or DC through Signal K source/path metadata.

The source identity is:

```text
CZone-AC
CZone-DC
```

This allows `signalk-to-influxdb2` to expose the distinction through its InfluxDB `source` tag without adding `AC` or `DC` to the circuit path.

For the supplied ZCF:

- PGN `130822` is the DC/COI current decoder and uses 0.1 A/count.
- PGN `130817` is the AC/ACOI current decoder and uses 0.2 A/count for the validated AC current field.
- Module `0xF8` is classified as the validated AC mapping used by the supplied ZCF.
- Module `0x28` records are excluded from the CZone circuit-current mapping.

The AC slot's remaining two bytes are intentionally left opaque until additional fields are validated.

### Optional: InfluxDB verification

The InfluxDB examples in this section are optional and only apply if the Signal K server is also running and configured with the `signalk-to-influxdb2` plugin. `signalk-czone` does not connect to or write directly to InfluxDB; it publishes the Signal K values and AC/DC source metadata that `signalk-to-influxdb2` can store.

If `signalk-to-influxdb2` is not installed and configured, the commands below will not return CZone data.

A quick check of the classification metadata can be performed with:

```bash
influx query '
from(bucket: "DataBucket")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "electrical.czone.Water_Heater_Port.current")
  |> limit(n: 10)
'   --host http://127.0.0.1:8086   --org SugarShack   --token "$INFLUX_TOKEN"
```

The Water Heater Port circuit should carry:

```text
source = CZone-AC
```

A DC circuit such as Starlink should carry:

```text
source = CZone-DC
```

A combined check can group the CZone current series by classification:

```bash
influx query '
from(bucket: "DataBucket")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement =~ /^electrical\.czone\./)
  |> keep(columns: ["_measurement", "_time", "_value", "source"])
  |> group(columns: ["source"])
'   --host http://127.0.0.1:8086   --org SugarShack   --token "$INFLUX_TOKEN"
```
Something like this can be created in grafana from the influxDB data

<img width="2900" height="1708" alt="Image" src="https://github.com/user-attachments/assets/92c458b3-6709-44be-ba49-d4029791c0d3" />

For the supplied ZCF, the current mappings are 83 DC mappings and 8 AC mappings. This count describes the supplied ZCF only; it is not a protocol requirement.

### Raw NMEA2000 transport

The decoder is intentionally transport-independent after the raw CAN frame is obtained.

The current Signal K integration listens to:

```text
canboatjs:rawoutput
```

It parses the raw YDWG02 line into timestamp, CAN ID, source address, PGN, and CAN data bytes.

CZone PGNs `130817` and `130822` are then reassembled as Fast Packets before CZone payload validation and ZCF lookup.

The decoder does not hard-code a CZone source address. The source address is part of the Fast Packet stream key because the same PGN can appear from different source addresses.

The plugin does not patch Signal K Server, canboatjs, n2k-signalk, or global PGN definitions.

### ZCF upload and persistence

The custom configuration panel uploads a `.zcf` file through:

```text
POST /plugins/signalk-czone/zcf/upload
```

After validation, the plugin installs the file in its plugin data directory, persists the active `zcfPath`, and restarts using the new configuration.

Only the installed path is stored in plugin configuration; the binary ZCF is not stored in JSON.

### Version history

- **0.2.2** — replaced the unreliable generic RJSF `data-url` upload with a dedicated configuration-panel uploader.
- **0.2.4** — restored the ZCF startup loading function and made invalid/missing ZCF configuration fail clearly.
- **0.2.5** — fixed ZCF path persistence and configuration-panel path handling.
- **0.3.0-beta.1** — first self-contained beta with the working ZCF parser, raw NMEA2000/CZone decoder, configuration panel, and validated ZCF upload/persistence.
- **0.3.0-beta.2** — changed public Signal K current paths to stable ZCF circuit names.
- **0.3.0-beta.3** — added backend diagnostics/status reporting.
- **0.3.0-beta.4** — added the Diagnostics tab/page to the configuration UI.
- **0.3.0-beta.5** — added explicit AC/DC source classification for downstream telemetry storage while retaining stable circuit-name paths and the diagnostics/status tooling.

The beta is intended for extended real-world testing before a stable `0.3.0` release.
