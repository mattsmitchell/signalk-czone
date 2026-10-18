# Changelog

## 0.3.0-beta.15

- Preserves plugin settings when uploading a ZCF or selecting a network configuration (#32).
- Publishes switch-input states for Signal Interface, COI and Control X PLUS modules (#30).
- Adds the Navico chartplotter touch layout, drag scrolling and reduced redraw cost (#31).
- Updates the canonical ZCF parser to 0.1.0-beta.2 for newer Configuration Tool layouts and corrected tank settings.

## 0.3.0-beta.14

- Adds bidirectional CZone links to Shelly Gen2+ switches and Victron GX outputs, with startup, confirmation and relay-function safeguards.
- Restores Navico chartplotter compatibility with Chromium 69 syntax and flex-spacing fallbacks.

## 0.3.0-beta.13

- Adds a fullscreen icon beside the CZone / Boat Systems branding, with expand/collapse states and accessible labels.
- Adds standalone tablet home-screen launch assets and safe-area spacing.
- Documents signalk-ssl setup, trusted CA certificate installation and device reboot steps for HTTPS app launch.

## 0.3.0-beta.12

- Keeps the connection indicator disconnected when circuit-list REST refreshes succeed but the live WebSocket is down; shows connecting/reconnecting status and the snapshot time.

## 0.3.0-beta.11

- Uses the npm `latest` tag for default installation and App Store updates while retaining the BETA version and listing labels.

- Routes circuit current to known physical output owners instead of groups referencing those outputs, restoring Starlink current and correcting Port Fresh Water Pump and Meitaki Nav. AIS attribution.
- Preserves existing current mappings when output ownership is ambiguous and adds regression coverage across all six ZCF fixtures.

## 0.3.0-beta.10

- Adds opt-in circuit current trends with preset and custom chart periods, CSV storage, summaries and retention settings.
- Restricts GX trend storage to mounted SD cards or USB sticks, including custom folders and card removal checks.
- Preserves live circuit amps through webapp refreshes, including when trend recording is disabled.
- Documents Cerbo GX SD card write permissions and persistent boot setup.
- Includes canonical test fixtures, repairs stale integration tests and tests simulated GX low-space operation.

## 0.3.0-beta.9

- Marks the App Store listing as CZone (BETA).
- Pins the shared ZCF parser to npm version 0.1.0-beta.1 instead of GitHub main.
- Lists the plugin in both digital switching and NMEA 2000 categories.
- Requires explicit enablement after initial configuration.
- Includes the App Store icon and changelog in the npm package.
- Updates beta installation instructions and repository/support metadata.

Earlier changes are documented in README.md.
