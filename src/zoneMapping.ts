import type { TadoZoneState } from './client.js';

export function currentHeatingCoolingState(
  zone: Pick<TadoZoneState, 'enabled' | 'heatingCoolingState'>,
): 0 | 1 | 2 {
  if (zone.enabled === false) {
    return 0;
  }
  return zone.heatingCoolingState ?? 0;
}

export function targetHeatingCoolingState(zone: Pick<TadoZoneState, 'enabled'>): 0 | 1 {
  return zone.enabled ? 1 : 0;
}
