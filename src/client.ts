import { EventEmitter } from "events";
import type { Logging } from "homebridge";
import EventSource from "eventsource";

interface RawZoneState {
  mode?: unknown;
  cur_heating?: unknown;
  cur_temp_c?: unknown;
  current_temperature?: unknown;
  hum_perc?: unknown;
  target_temp_c?: unknown;
  target_temperature?: unknown;
}

interface RawZone {
  zone_id?: unknown;
  id?: unknown;
  name?: unknown;
  state?: RawZoneState;
  mode?: unknown;
  heating?: unknown;
}

interface HasZones {
  zones: RawZone[];
}

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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
    const res = await fetch(`${this.baseUrl}/zones`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`GET /zones failed: ${res.status} ${res.statusText}`);
    }
    return this.normalizeZones(await res.json());
  }

  /** Sets target temperature and implicitly enables the zone. */
  async setZoneTemperature(
    zoneId: string,
    temperatureC: number,
  ): Promise<void> {
    await this.postZoneSet(zoneId, { temperature: String(temperatureC) });
  }

  /** Uses the real heating_enabled param rather than a temperature=0 sentinel. */
  async disableZone(zoneId: string): Promise<void> {
    await this.postZoneSet(zoneId, { heating_enabled: "false" });
  }

  private async postZoneSet(
    zoneId: string,
    params: Record<string, string>,
  ): Promise<void> {
    const url = new URL(`${this.baseUrl}/zones/${zoneId}/set`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url, { method: "POST", headers: this.headers() });
    if (!res.ok) {
      throw new Error(
        `POST /zones/${zoneId}/set failed: ${res.status} ${res.statusText}`,
      );
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
        const payload: unknown = JSON.parse(ev.data);
        // Unconfirmed shape — same caveat as normalizeZones(). Assumes the
        // event either *is* a zone object or wraps one under `.zone`.
        const raw =
          typeof payload === "object" && payload !== null && "zone" in payload
            ? (payload as { zone: unknown }).zone
            : payload;
        for (const zone of this.normalizeZones({ zones: [raw as RawZone] })) {
          this.emit("update", zone);
        }
      } catch (err) {
        this.log.warn(
          "TadoLocal: could not parse /events payload — fix normalizeZones()",
          err,
        );
      }
    };
    this.eventSource.onerror = (err) => {
      this.log.warn(
        "TadoLocal: /events stream error (will keep retrying)",
        err,
      );
    };
  }

  disconnectEvents(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private normalizeZones(body: unknown): TadoZoneState[] {
    const rawZones: RawZone[] =
      (body as HasZones)?.zones ?? (Array.isArray(body) ? body : []);

    return rawZones.map((z: RawZone) => {
      const id = String(z.zone_id ?? z.id);
      const state = z.state ?? {};
      const mode = state.mode ?? z.mode;
      const cur_heating = state.cur_heating ?? z.heating;

      return {
        id,
        name: asString(z.name) ?? `Zone ${id}`,
        currentTemperatureC:
          asNumber(state.cur_temp_c) ?? asNumber(state.current_temperature),
        currentHumidityPercent: asNumber(state.hum_perc),
        targetTemperatureC:
          asNumber(state.target_temp_c) ??
          asNumber(state.target_temperature),
        heatingCoolingState:
          cur_heating === 0 || cur_heating === 1 || cur_heating === 2
            ? cur_heating
            : null,
        enabled:
          mode === undefined || mode === null
            ? null
            : mode === 1 || mode === true,
      };
    });
  }
}
