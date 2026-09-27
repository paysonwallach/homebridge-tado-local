import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { Logging } from "homebridge";

// Hoisted by Vitest above the imports below, regardless of source position —
// kept at the top for clarity. The client only ever does
// `new EventSource(url, opts)` then assigns .onmessage/.onerror, so the
// mock just needs to be a plain constructable object those can be set on,
// not a real SSE connection.
vi.mock("eventsource", () => ({
  default: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    return this;
  }),
}));

import EventSource from "eventsource";
import { TadoLocalClient } from "../src/client.js";

const mockLog: Logging = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  prefix: "test",
} as unknown as Logging;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

describe("TadoLocalClient.getZones", () => {
  beforeEach(() => {
    (global as unknown as { fetch: Mock }).fetch = vi.fn();
  });

  it("normalizes a real-shaped /zones response (per the demo CLI script)", async () => {
    (global.fetch as Mock).mockResolvedValue(
      jsonResponse({
        zones: [
          {
            zone_id: 1,
            name: "Living Room",
            state: {
              cur_temp_c: 19.5,
              target_temp_c: 21,
              hum_perc: 44,
              cur_heating: 1,
              mode: 1,
            },
          },
          {
            zone_id: 2,
            name: "Bedroom",
            state: {
              cur_temp_c: 17.2,
              target_temp_c: 17,
              hum_perc: 50,
              cur_heating: 0,
              mode: 0,
            },
          },
        ],
        homes: [{ id: 1, name: "Home" }],
      }),
    );

    const zones = await new TadoLocalClient(
      "10.0.0.42",
      4407,
      "token",
      mockLog,
    ).getZones();

    expect(zones).toEqual([
      {
        id: "1",
        name: "Living Room",
        currentTemperatureC: 19.5,
        currentHumidityPercent: 44,
        targetTemperatureC: 21,
        heatingCoolingState: 1,
        enabled: true,
      },
      {
        id: "2",
        name: "Bedroom",
        currentTemperatureC: 17.2,
        currentHumidityPercent: 50,
        targetTemperatureC: 17,
        heatingCoolingState: 0,
        enabled: false,
      },
    ]);
  });

  it("falls back to the pre-script field names if a response uses them instead", async () => {
    (global.fetch as Mock).mockResolvedValue(
      jsonResponse({
        zones: [
          {
            id: 5,
            name: "Kitchen",
            state: { current_temperature: 20, target_temperature: 22 },
          },
        ],
      }),
    );

    const zones = await new TadoLocalClient(
      "10.0.0.42",
      4407,
      "token",
      mockLog,
    ).getZones();

    expect(zones[0]).toMatchObject({
      id: "5",
      currentTemperatureC: 20,
      targetTemperatureC: 22,
    });
  });

  it("handles a bare array response (no {zones: [...]} wrapper)", async () => {
    (global.fetch as Mock).mockResolvedValue(
      jsonResponse([{ zone_id: 9, name: "Attic", state: { cur_temp_c: 15 } }]),
    );

    const zones = await new TadoLocalClient(
      "10.0.0.42",
      4407,
      "token",
      mockLog,
    ).getZones();

    expect(zones).toEqual([
      {
        id: "9",
        name: "Attic",
        currentTemperatureC: 15,
        currentHumidityPercent: null,
        targetTemperatureC: null,
        heatingCoolingState: null,
        enabled: null,
      },
    ]);
  });

  it("throws with the status on a non-ok response", async () => {
    (global.fetch as Mock).mockResolvedValue(jsonResponse({}, false, 500));

    await expect(
      new TadoLocalClient("10.0.0.42", 4407, "token", mockLog).getZones(),
    ).rejects.toThrow("GET /zones failed: 500");
  });
});

describe("TadoLocalClient writes", () => {
  beforeEach(() => {
    (global as unknown as { fetch: Mock }).fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({}));
  });

  it("setZoneTemperature POSTs to /zones/{id}/set with temperature as a query param, not a JSON body", async () => {
    const client = new TadoLocalClient(
      "10.0.0.42",
      4407,
      "secret-token",
      mockLog,
    );
    await client.setZoneTemperature("7", 21.5);

    const [url, opts] = (global.fetch as Mock).mock.calls[0];
    expect(url.toString()).toBe(
      "http://10.0.0.42:4407/zones/7/set?temperature=21.5",
    );
    expect(opts).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
    expect(opts.body).toBeUndefined();
  });

  it("disableZone sends heating_enabled=false as a query param (the real field, confirmed live)", async () => {
    const client = new TadoLocalClient("10.0.0.42", 4407, "token", mockLog);
    await client.disableZone("3");

    const [url] = (global.fetch as Mock).mock.calls[0];
    expect(url.toString()).toBe(
      "http://10.0.0.42:4407/zones/3/set?heating_enabled=false",
    );
  });

  it("throws with the status on a failed write", async () => {
    (global.fetch as Mock).mockResolvedValue(jsonResponse({}, false, 400));
    const client = new TadoLocalClient("10.0.0.42", 4407, "token", mockLog);

    await expect(client.setZoneTemperature("1", 20)).rejects.toThrow(
      "POST /zones/1/set failed: 400",
    );
  });
});

describe("TadoLocalClient.connectEvents", () => {
  // Explicit reset here rather than relying on vitest.config.ts's
  // clearMocks setting reaching this run — it evidently wasn't, so
  // EventSource.mock.instances was accumulating across tests in this block.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a normalized update for a parsed SSE message", () => {
    const client = new TadoLocalClient("10.0.0.42", 4407, "token", mockLog);
    const updates: unknown[] = [];
    client.on("update", (z) => updates.push(z));

    client.connectEvents();
    const instance = (EventSource as unknown as Mock).mock.instances[0] as {
      onmessage: (ev: { data: string }) => void;
    };
    instance.onmessage({
      data: JSON.stringify({
        zone: {
          zone_id: 9,
          name: "Hallway",
          state: { cur_temp_c: 18, mode: 1, cur_heating: 1 },
        },
      }),
    });

    expect(updates).toEqual([
      expect.objectContaining({
        id: "9",
        name: "Hallway",
        currentTemperatureC: 18,
        enabled: true,
      }),
    ]);
  });

  it("logs a warning instead of throwing on an unparsable payload", () => {
    const client = new TadoLocalClient("10.0.0.42", 4407, "token", mockLog);
    client.connectEvents();
    const instance = (EventSource as unknown as Mock).mock.instances[0] as {
      onmessage: (ev: { data: string }) => void;
    };

    expect(() => instance.onmessage({ data: "not json" })).not.toThrow();
    expect(mockLog.warn).toHaveBeenCalled();
  });

  it("is idempotent — a second connectEvents() call does not open a second connection", () => {
    const client = new TadoLocalClient("10.0.0.42", 4407, "token", mockLog);
    client.connectEvents();
    client.connectEvents();

    expect((EventSource as unknown as Mock).mock.instances).toHaveLength(1);
  });
});
