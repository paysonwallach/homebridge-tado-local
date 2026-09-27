import type { PlatformAccessory, Service } from "homebridge";

import type { TadoLocalPlatform } from "./platform.js";
import type { TadoLocalClient, TadoZoneState } from "./client.js";
import {
  currentHeatingCoolingState,
  targetHeatingCoolingState,
} from "./zoneMapping.js";

export class TadoZoneAccessory {
  private readonly service: Service;
  private zone: TadoZoneState;

  constructor(
    private readonly platform: TadoLocalPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: TadoLocalClient,
    initialZone: TadoZoneState,
  ) {
    this.zone = initialZone;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "tado°")
      .setCharacteristic(this.platform.Characteristic.Model, "TadoLocal zone")
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        `zone-${initialZone.id}`,
      );

    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      initialZone.name,
    );

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(() => this.zone.currentTemperatureC ?? 0);

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.zone.currentHumidityPercent ?? 0);

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: 5, maxValue: 25, minStep: 0.5 })
      .onGet(() => this.zone.targetTemperatureC ?? 20)
      .onSet(async (value) => {
        const temperature = value as number;
        try {
          // Per the demo script's convention: setting a temperature (>=1)
          // also implicitly enables the zone. There's no evidence of a
          // separate "just enable, keep last temperature" call.
          await this.client.setZoneTemperature(this.zone.id, temperature);
          this.zone.targetTemperatureC = temperature;
          this.zone.enabled = true;
        } catch (err) {
          this.platform.log.error(
            `TadoLocal: failed to set target temperature for "${this.zone.name}"`,
            err,
          );
        }
      });

    this.service
      .getCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState,
      )
      .onGet(() => this.currentHeatingCoolingState());

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.OFF,
          this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
        ],
      })
      .onGet(() => this.targetHeatingCoolingState())
      .onSet(async (value) => {
        const wantsOff =
          value === this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        try {
          if (wantsOff) {
            await this.client.disableZone(this.zone.id);
            this.zone.enabled = false;
          } else {
            // Re-enable at the last known target temperature. There's no
            // confirmed endpoint for "enable without specifying a
            // temperature" — resending the last known target is the
            // closest equivalent given only set_temperature is confirmed
            // to work.
            const resumeTemp = this.zone.targetTemperatureC ?? 20;
            await this.client.setZoneTemperature(this.zone.id, resumeTemp);
            this.zone.enabled = true;
          }
        } catch (err) {
          this.platform.log.error(
            `TadoLocal: failed to change heating state for "${this.zone.name}"`,
            err,
          );
        }
      });

    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(
        () => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
      );
  }

  /** Called by the platform on every SSE update or fallback poll for this zone. */
  applyUpdate(zone: TadoZoneState): void {
    this.zone = zone;

    if (zone.currentTemperatureC !== null) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        zone.currentTemperatureC,
      );
    }
    if (zone.currentHumidityPercent !== null) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentRelativeHumidity,
        zone.currentHumidityPercent,
      );
    }
    if (zone.targetTemperatureC !== null) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetTemperature,
        zone.targetTemperatureC,
      );
    }
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      currentHeatingCoolingState(zone),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      targetHeatingCoolingState(zone),
    );
  }

  private currentHeatingCoolingState(): number {
    return currentHeatingCoolingState(this.zone);
  }

  private targetHeatingCoolingState(): number {
    return targetHeatingCoolingState(this.zone);
  }
}
