import fetch from 'node-fetch';
import { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { OctopusEnergyPlatform } from './platform';

export type MeterSide = 'import' | 'export';

export interface MeterConfig {
  name: string;
  mpan: string;
  meterSerial: string;
  side: MeterSide;
}

interface ConsumptionRecord {
  consumption?: number;
  interval_start?: string;
  interval_end?: string;
  period_start?: string;
  period_end?: string;
}

interface ConsumptionResponse {
  results?: ConsumptionRecord[];
}

export class OctopusMeterAccessory {
  private outletService: Service;
  private evePower: ReturnType<Service['getCharacteristic']> | null = null;
  private eveTotal: ReturnType<Service['getCharacteristic']> | null = null;
  private lastWatts = 0;
  private lastTotalKWh = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly platform: OctopusEnergyPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly meter: MeterConfig,
    private readonly apiKey: string,
    private readonly pollSeconds: number,
  ) {
    const { Service, Characteristic } = this.platform;

    const info = this.accessory.getService(Service.AccessoryInformation);
    info?.setCharacteristic(Characteristic.Manufacturer, 'Octopus Energy');
    info?.setCharacteristic(Characteristic.Model, `${meter.side.toUpperCase()} meter`);
    info?.setCharacteristic(Characteristic.SerialNumber, meter.meterSerial);

    const outlet = this.accessory.getService(Service.Outlet)
      || this.accessory.addService(Service.Outlet);
    outlet.setCharacteristic(Characteristic.Name, meter.name);
    outlet.updateCharacteristic(Characteristic.On, true);
    outlet.updateCharacteristic(Characteristic.OutletInUse, true);
    outlet.getCharacteristic(Characteristic.On).onSet(async () => {
      // This accessory is read-only; keep it "on" for Home UI presence.
      outlet.updateCharacteristic(Characteristic.On, true);
    });
    this.outletService = outlet;

    this.evePower = this.ensureEveCharacteristic(this.platform.Eve.Power);
    this.eveTotal = this.ensureEveCharacteristic(this.platform.Eve.TotalConsumption);

    this.lastWatts = typeof this.accessory.context.lastWatts === 'number' ? this.accessory.context.lastWatts : 0;
    this.lastTotalKWh = typeof this.accessory.context.totalKWh === 'number' ? this.accessory.context.totalKWh : 0;
    this.updateCachedCharacteristics();

    this.platform.api.on('shutdown', () => this.stopPolling());
  }

  public startPolling(): void {
    if (this.timer) {
      return;
    }

    this.refreshNow().catch((error) => {
      this.platform.log.warn(`Initial fetch failed for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`);
    });

    this.timer = setInterval(() => {
      this.refreshNow().catch((error) => {
        this.platform.log.warn(`Refresh failed for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.pollSeconds * 1000);
  }

  public stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private ensureEveCharacteristic(charType: WithUUID<new () => Characteristic>) {
    try {
      return this.outletService.getCharacteristic(charType);
    } catch (error) {
      try {
        return this.outletService.addCharacteristic(charType);
      } catch (innerError) {
        this.platform.log.warn(`Failed to register Eve characteristic on ${this.meter.name}: ${
          innerError instanceof Error ? innerError.message : String(innerError)
        }`);
        return null;
      }
    }
  }

  private async refreshNow(): Promise<void> {
    await this.refreshPower();
    await this.refreshTotal();
  }

  private async refreshPower(): Promise<void> {
    try {
      const watts = await this.fetchLatestWatts();
      this.lastWatts = watts;
      this.accessory.context.lastWatts = watts;

      const safeValue = Math.max(0, watts);
      if (this.evePower) {
        this.evePower.updateValue(safeValue as CharacteristicValue);
      }
      this.updateCachedCharacteristics();
      this.platform.log.debug(`${this.meter.name} Eve power updated to ${safeValue.toFixed(2)} W`);
    } catch (error) {
      this.platform.log.warn(`Failed to update power for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async refreshTotal(): Promise<void> {
    try {
      const totalKWh = await this.fetchTodayTotalKWh();
      this.lastTotalKWh = totalKWh;
      this.accessory.context.totalKWh = totalKWh;

      if (this.eveTotal) {
        this.eveTotal.updateValue(totalKWh as CharacteristicValue);
      }
      this.updateCachedCharacteristics();
      this.platform.log.debug(`${this.meter.name} Eve total updated to ${totalKWh.toFixed(3)} kWh (today)`);
    } catch (error) {
      this.platform.log.warn(`Failed to update total consumption for ${this.meter.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async fetchLatestWatts(): Promise<number> {
    const url = `https://api.octopus.energy/v1/electricity-meter-points/${this.meter.mpan}/meters/${this.meter.meterSerial}/consumption/?page_size=1&order_by=-period_start`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ConsumptionResponse;
    const record = payload.results?.[0];
    if (!record) {
      throw new Error('No consumption records returned');
    }

    const consumption = record.consumption;
    if (typeof consumption !== 'number') {
      throw new Error('Consumption value missing or invalid');
    }

    const intervalStart = record.interval_start ?? record.period_start;
    const intervalEnd = record.interval_end ?? record.period_end;

    let intervalHours = 0.5;
    if (intervalStart && intervalEnd) {
      const start = Date.parse(intervalStart);
      const end = Date.parse(intervalEnd);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        const hours = (end - start) / (1000 * 60 * 60);
        if (hours > 0) {
          intervalHours = hours;
        }
      }
    }

    const watts = (consumption * 1000) / intervalHours;
    return Math.max(0, Math.round(watts * 100) / 100);
  }

  private async fetchTodayTotalKWh(): Promise<number> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

    const params = new URLSearchParams({
      page_size: '250',
      order_by: 'period_start',
      period_from: start.toISOString(),
      period_to: end.toISOString(),
    });

    const url = `https://api.octopus.energy/v1/electricity-meter-points/${this.meter.mpan}/meters/${this.meter.meterSerial}/consumption/?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      this.platform.log.debug(`Total consumption request failed (${response.status}) for ${this.meter.name}: ${url}`);
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ConsumptionResponse;
    const records = payload.results ?? [];

    let total = 0;
    for (const record of records) {
      if (typeof record.consumption === 'number') {
        total += record.consumption;
      }
    }

    return Math.max(0, Math.round(total * 1000) / 1000);
  }

  private updateCachedCharacteristics(): void {
    if (this.evePower) {
      this.evePower.updateValue(Math.max(0, this.lastWatts) as CharacteristicValue);
    }
    if (this.eveTotal) {
      this.eveTotal.updateValue(Math.max(0, this.lastTotalKWh) as CharacteristicValue);
    }
  }
}
