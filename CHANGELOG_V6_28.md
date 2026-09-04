# POSEIDON V6.28

## Smart Safety Ball monitoring UI cleanup

- Removed browser Bluetooth pairing/device chooser and BLE diagnostic UI.
- Removed Safety Ball app link and developer-only diagnostic/test controls from the page.
- Focused the page on O2, CO, H2S, battery, latest receive time, GPS, alarms, and measurement history.
- Added Safety Ball device and calibration management for administrators.
- Added calibration date, next calibration date, calibration organization, serial number, and note.
- Added calibration status badges: valid, due within 30 days, expired, or not registered.
- Added summary cards for registered devices, recently received devices, alarms, and calibration attention.
- Measurement ingest remains protected by the existing POSEIDON login session; no separate Safety Ball API key is required.
