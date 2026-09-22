import { describe, it, expect } from 'vitest';
import { currentHeatingCoolingState, targetHeatingCoolingState } from '../src/zoneMapping.js';

describe('currentHeatingCoolingState', () => {
  it('reflects heatingCoolingState directly when the zone is enabled', () => {
    expect(currentHeatingCoolingState({ enabled: true, heatingCoolingState: 0 })).toBe(0);
    expect(currentHeatingCoolingState({ enabled: true, heatingCoolingState: 1 })).toBe(1);
    expect(currentHeatingCoolingState({ enabled: true, heatingCoolingState: 2 })).toBe(2);
  });

  it('forces OFF when the zone is disabled, regardless of heatingCoolingState', () => {
    expect(currentHeatingCoolingState({ enabled: false, heatingCoolingState: 1 })).toBe(0);
  });

  it('defaults to OFF when heatingCoolingState is unknown', () => {
    expect(currentHeatingCoolingState({ enabled: true, heatingCoolingState: null })).toBe(0);
    expect(currentHeatingCoolingState({ enabled: null, heatingCoolingState: null })).toBe(0);
  });
});

describe('targetHeatingCoolingState', () => {
  it('is HEAT when enabled, OFF otherwise', () => {
    expect(targetHeatingCoolingState({ enabled: true })).toBe(1);
    expect(targetHeatingCoolingState({ enabled: false })).toBe(0);
    expect(targetHeatingCoolingState({ enabled: null })).toBe(0);
  });
});
