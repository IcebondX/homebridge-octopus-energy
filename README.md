# Homebridge Octopus Energy

Homebridge dynamic platform plugin that surfaces Octopus Energy smart meter import (and optionally export) power into HomeKit. It polls the official Octopus REST API for the latest interval and converts consumption (kWh) into an average watts value per interval.

## What you get
- Up to two accessories: **Octopus Import** (required) and **Octopus Export** (optional).
- Primary service is an `Outlet` so it stays visible in Apple Home. Apple Home will not show the energy data.
- Eve Energy-style characteristics for **instantaneous power (W)** and **today's total consumption (kWh)**. These display in Eve, Home+, and other advanced HomeKit apps.
- Polls immediately on startup and then every `pollSeconds`.
- Resilient logging and error handling; failures keep the last value instead of crashing Homebridge.

### App support
- Apple Home: shows the Outlet only (no power/energy UI).
- Eve / Home+: show live watts and a rolling “today” total (kWh) via Eve custom characteristics.

## Installation
```bash
# inside this folder
npm install
npm run build
# install globally into Homebridge
npm install -g .
```

Requires Node 18+ and Homebridge v1.7+.

## Configuration
Add the platform block to your Homebridge `config.json`:
```json
{
  "platform": "OctopusEnergyPlatform",
  "name": "Octopus Energy",
  "apiKey": "sk_live_your_key",
  "pollSeconds": 300,
  "import": {
    "name": "Octopus Import",
    "mpan": "YOUR_IMPORT_MPAN",
    "meterSerial": "IMPORT_SERIAL"
  },
  "export": {
    "name": "Octopus Export",
    "mpan": "YOUR_EXPORT_MPAN",
    "meterSerial": "EXPORT_SERIAL"
  }
}
```

Options:
- `apiKey` (required): Octopus API key (username in Basic Auth; password blank).
- `pollSeconds` (default 300, min 60): Polling interval in seconds.
- `import` (required): MPAN + meter serial for your import meter.
- `export` (optional): MPAN + meter serial for export; omit to skip export accessory.

## How it works
- Calls `GET https://api.octopus.energy/v1/electricity-meter-points/{MPAN}/meters/{SERIAL}/consumption/?page_size=1&order_by=-period_start` with Basic Auth.
- Accepts both `period_*` and `interval_*` fields.
- Converts the latest interval `consumption` (kWh) to watts: `watts = (kWh * 1000) / hours_in_interval`. A 30-minute interval uses 0.5 hours, so `watts = kWh * 2000`.
- Rolling daily total is calculated by summing today's intervals (UTC) from the same Octopus endpoint.
- Updates HomeKit immediately and then every `pollSeconds`.

## Scripts
- `npm run build` – compile TypeScript to `dist`.
- `npm run watch` – watch & rebuild.
- `npm run lint` – ESLint over `src`.
- `npm run clean` – remove `dist`.

## Notes
- If the Octopus API call fails, the accessory keeps the last good reading and logs a warning.
- Export is only created when both `mpan` and `meterSerial` are supplied.
- Daily total resets at midnight UTC and represents the sum of all intervals returned for today.
