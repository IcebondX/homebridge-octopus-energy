import { API, APIEvent, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { OctopusMeterAccessory, MeterConfig, MeterSide } from './accessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { EveCharacteristics, getEveCharacteristics } from './eve';

interface MeterEntry {
  name?: string;
  mpan: string;
  meterSerial: string;
}

interface OctopusPlatformConfig extends PlatformConfig {
  apiKey: string;
  pollSeconds?: number;
  import: MeterEntry;
  export?: MeterEntry;
}

export class OctopusEnergyPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly Eve: EveCharacteristics;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly managed: OctopusMeterAccessory[] = [];
  private readonly pollSeconds: number;

  constructor(
    public readonly log: Logger,
    public readonly config: OctopusPlatformConfig,
    public readonly api: API,
  ) {
    this.Eve = getEveCharacteristics(this.api);
    this.pollSeconds = Math.max(60, typeof config?.pollSeconds === 'number' ? config.pollSeconds : 300);

    if (!config || !config.apiKey) {
      this.log.error('Missing apiKey in configuration; plugin will not start.');
    }

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.log.debug('Finished launching, starting discovery');
      this.discoverMeters();
    });

    this.api.on(APIEvent.SHUTDOWN, () => {
      this.managed.forEach((meter) => meter.stopPolling());
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restored accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private discoverMeters(): void {
    if (!this.config || !this.config.apiKey) {
      return;
    }

    if (!this.config.import) {
      this.log.error('Import meter configuration missing.');
      return;
    }

    this.registerMeter('import', this.config.import);

    if (this.config.export) {
      if (this.config.export.mpan && this.config.export.meterSerial) {
        this.registerMeter('export', this.config.export);
      } else {
        this.log.warn('Export configuration incomplete; skipping export accessory.');
      }
    }
  }

  private registerMeter(side: MeterSide, meter: MeterEntry): void {
    const name = meter.name || (side === 'import' ? 'Octopus Import' : 'Octopus Export');
    const uuid = this.api.hap.uuid.generate(`${side}-${meter.mpan}-${meter.meterSerial}`);

    const existing = this.accessories.find((accessory) => accessory.UUID === uuid);

    let accessory: PlatformAccessory;
    if (existing) {
      accessory = existing;
      accessory.displayName = name;
      this.log.info('Updating cached accessory', name);
    } else {
      accessory = new this.api.platformAccessory(name, uuid);
      this.log.info('Registering new accessory', name);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    accessory.context.meter = {
      side,
      mpan: meter.mpan,
      meterSerial: meter.meterSerial,
      name,
    } as MeterConfig;

    const octopusAccessory = new OctopusMeterAccessory(
      this,
      accessory,
      accessory.context.meter,
      this.config.apiKey,
      this.pollSeconds,
    );

    this.managed.push(octopusAccessory);
    this.api.updatePlatformAccessories([accessory]);
  }
}
