import { EventEmitter } from 'events';
import type { Logging } from 'homebridge';
import EventSource from 'eventsource';

export interface TadoZoneState {
  id: string;
  name: string;
  currentTemperatureC: number | null;
  currentHumidityPercent: number | null;
  targetTemperatureC: number | null;
  /** Mirrors HAP CurrentHeatingCoolingState numbering directly: 0=OFF, 1=HEAT, 2=COOL. */
  heatingCoolingState: 0 | 1 | 2 | null;
  /** state.mode — zone enabled at all, independent of what it's currently doing. */
  enabled: boolean | null;
}

export class TadoLocalClient extends EventEmitter {
  private readonly baseUrl: string;
  private eventSource: EventSource | null = null;

  constructor(
    host: string,
    port: number,
    private readonly bearerToken: string,
    private readonly log: Logging,
  ) {
    super();
    this.baseUrl = `http://${host}:${port}`;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.bearerToken}` };
  }

  async getZones(): Promise<TadoZoneState[]> {
    const res = await fetch(`${this.baseUrl}/zones`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GET /zones failed: ${res.status} ${res.statusText}`);
    }
    return this.normalizeZones(await res.json());
  }

  /** Sets target temperature and implicitly enables the zone. */
  async setZoneTemperature(zoneId: string, temperatureC: number): Promise<void> {
    await this.postZoneSet(zoneId, { temperature: String(temperatureC) });
  }

  /** Uses the real heating_enabled param rather than a temperature=0 sentinel. */
  async disableZone(zoneId: string): Promise<void> {
    await this.postZoneSet(zoneId, { heating_enabled: 'false' });
  }

  private async postZoneSet(zoneId: string, params: Record<string, string>): Promise<void> {
    const url = new URL(`${this.baseUrl}/zones/${zoneId}/set`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url, { method: 'POST', headers: this.headers() });
    if (!res.ok) {
      throw new Error(`POST /zones/${zoneId}/set failed: ${res.status} ${res.statusText}`);
    }
  }

  /** Connects to GET /events and emits a normalized 'update' TadoZoneState for each parsed event. */
  connectEvents(): void {
    if (this.eventSource) {
      return;
    }
    this.eventSource = new EventSource(`${this.baseUrl}/events`, {
      headers: this.headers(),
    });
    this.eventSource.onmessage = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        // Unconfirmed shape — same caveat as normalizeZones(). Assumes the
        // event either *is* a zone object or wraps one under `.zone`.
        const raw = payload.zone ?? payload;
        for (const zone of this.normalizeZones({ zones: [raw] })) {
          this.emit('update', zone);
        }
      } catch (err) {
        this.log.warn('TadoLocal: could not parse /events payload — fix normalizeZones()', err);
      }
    };
    this.eventSource.onerror = (err) => {
      this.log.warn('TadoLocal: /events stream error (will keep retrying)', err);
    };
  }

  disconnectEvents(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private normalizeZones(body: unknown): TadoZoneState[] {
    const rawZones: any[] = (body as any)?.zones ?? (Array.isArray(body) ? body : []);

    return rawZones.map((z: any) => {
      const id = String(z.zone_id ?? z.id);
      const state = z.state ?? {};
      const mode = state.mode ?? z.mode;
      const cur_heating = state.cur_heating ?? z.heating;

      return {
        id,
        name: z.name ?? `Zone ${id}`,
        currentTemperatureC: state.cur_temp_c ?? state.current_temperature ?? null,
        currentHumidityPercent: state.hum_perc ?? null,
        targetTemperatureC: state.target_temp_c ?? state.target_temperature ?? null,
        heatingCoolingState:
          cur_heating === 0 || cur_heating === 1 || cur_heating === 2 ? cur_heating : null,
        enabled: mode === undefined || mode === null ? null : mode === 1 || mode === true,
      };
    });
  }
}
