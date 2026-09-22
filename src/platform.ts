import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { TadoLocalClient, TadoZoneState } from './client.js';
import { TadoZoneAccessory } from './platformAccessory.js';

export const PLATFORM_NAME = 'TadoLocal';
export const PLUGIN_NAME = 'homebridge-tado-local';

export class TadoLocalPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  private readonly client: TadoLocalClient;
  private readonly zoneAccessories = new Map<string, TadoZoneAccessory>();
  private pollTimer?: NodeJS.Timeout;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    if (!config.host || !config.bearerToken) {
      this.log.error('TadoLocal: "host" and "bearerToken" are required in config — platform disabled.');
      this.client = null as unknown as TadoLocalClient; // never used past this point
      return;
    }

    this.client = new TadoLocalClient(
      config.host as string,
      (config.port as number) ?? 4407,
      config.bearerToken as string,
      log,
    );

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      this.client.disconnectEvents();
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  /** Homebridge calls this for every cached accessory on startup — required by the platform API. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
    if (!this.client) {
      return;
    }

    let zones: TadoZoneState[];
    try {
      zones = await this.client.getZones();
    } catch (err) {
      this.log.error('TadoLocal: initial GET /zones failed, will retry on next poll', err);
      zones = [];
    }

    for (const zone of zones) {
      this.upsertAccessory(zone);
    }

    // Remove cached accessories for zones that no longer exist upstream.
    const currentUuids = new Set(zones.map((z) => this.uuidFor(z.id)));
    for (const cached of this.accessories) {
      if (!currentUuids.has(cached.UUID)) {
        this.log.info(`TadoLocal: removing stale accessory ${cached.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
      }
    }

    this.client.connectEvents();
    this.client.on('update', (zone: TadoZoneState) => {
      this.zoneAccessories.get(zone.id)?.applyUpdate(zone);
    });

    const intervalSeconds = (this.config.pollIntervalSeconds as number) ?? 60;
    this.pollTimer = setInterval(() => this.pollFallback(), intervalSeconds * 1000);
  }

  private async pollFallback(): Promise<void> {
    try {
      const zones = await this.client.getZones();
      for (const zone of zones) {
        this.zoneAccessories.get(zone.id)?.applyUpdate(zone);
      }
    } catch (err) {
      this.log.warn('TadoLocal: fallback poll failed', err);
    }
  }

  private uuidFor(zoneId: string): string {
    return this.api.hap.uuid.generate(`tado-local-zone-${zoneId}`);
  }

  private upsertAccessory(zone: TadoZoneState): void {
    const uuid = this.uuidFor(zone.id);
    const existing = this.accessories.find((a) => a.UUID === uuid);

    if (existing) {
      existing.displayName = zone.name;
      this.zoneAccessories.set(zone.id, new TadoZoneAccessory(this, existing, this.client, zone));
      return;
    }

    this.log.info(`TadoLocal: adding zone "${zone.name}"`);
    const accessory = new this.api.platformAccessory(zone.name, uuid);
    this.zoneAccessories.set(zone.id, new TadoZoneAccessory(this, accessory, this.client, zone));
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
  }
}
