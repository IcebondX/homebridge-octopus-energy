# Homebridge Octopus Energy

Homebridge platform plugin that surfaces Octopus Energy SMETS2 import (and optional export) meters into HomeKit. It polls the Octopus public API, converts interval kWh readings into watts, and exposes Eve-style energy characteristics (instantaneous watts and today's total kWh). Apple Home will show the Outlet accessory; rich energy data appears in Eve, Home+, and other advanced HomeKit apps.

## Requirements
- Node.js >= 18
- Homebridge >= 1.7
- Octopus API key plus MPAN and meter serial(s)

## Installation
### Homebridge UI X
1. Open **Config UI X** -> **Plugins**.
2. Search for `homebridge-octopus-energy`.
3. Install and restart Homebridge.

### npm (global)
```bash
npm i -g homebridge-octopus-energy
```

## Configuration
Add to `config.json` (or use the UI form powered by `config.schema.json`):
```json
{
  "platform": "OctopusEnergy",
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

Notes:
- Import is required; export is optional (requires both MPAN and meter serial).
- Polls immediately on startup, then every `pollSeconds` (min 60s).
- Eve characteristics expose live watts and a rolling "today" total (kWh). Apple Home will not show these values, but Eve/Home+ will.

## What it does
- Calls the Octopus REST API for electricity consumption.
- Converts the latest interval kWh to watts; sums today's intervals for total kWh.
- Exposes an `Outlet` service for Home visibility plus Eve Energy characteristics for power and total energy.
- Keeps last values if the API fails and logs warnings instead of crashing.

## Links
- GitHub: https://github.com/icebondx/homebridge-octopus-energy
- Issues: https://github.com/icebondx/homebridge-octopus-energy/issues

## License
MIT
