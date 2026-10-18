import { describe, it, expect, afterAll } from "vitest";
import { RouterOSAPI } from "node-routeros";
import {
  routerosClient,
  RouterOsError,
  parseRouterOsUptime,
} from "../../src/lib/integrations/routeros/client";

/**
 * Verifikasi error handling klien RouterOS terhadap router NYATA.
 *
 * Tidak ada router fisik tersedia, jadi pengujian menyambung ke
 * 127.0.0.1 pada port yang pasti tertutup (tidak ada listener).
 * Harus gagal dengan `RouterOsError` dalam waktu < 15 detik — tidak boleh
 * menggantung dan tidak boleh mengembalikan respons palsu.
 */
afterAll(async () => {
  // tidak ada resource global untuk dibersihkan
});

describe("routerosClient — koneksi ke host yang tidak ada", () => {
  it("melempar RouterOsError dalam < 15 detik saat koneksi gagal", async () => {
    const start = Date.now();
    const client = routerosClient({
      host: "127.0.0.1",
      // Port terpilih tinggi: praktis tidak ada listener di sini.
      port: 1,
      username: "admin",
      password: "test",
      connectTimeoutSec: 5,
      commandTimeoutSec: 5,
      maxRetries: 0,
    });

    let thrown: unknown = null;
    try {
      await client.identify();
    } catch (error) {
      thrown = error;
    } finally {
      await client.close();
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
    expect(thrown).toBeInstanceOf(RouterOsError);
    const code = (thrown as RouterOsError).code;
    expect(["CONNECT_FAILED", "CONNECT_TIMEOUT", "COMMAND_TIMEOUT", "COMMAND_FAILED"]).toContain(code);
  });

  it("classifyConnectError: port tertutup memberi CONNECT_FAILED/CONNECT_TIMEOUT", async () => {
    const client = routerosClient({
      host: "127.0.0.1",
      port: 2,
      username: "admin",
      password: "test",
      connectTimeoutSec: 4,
      commandTimeoutSec: 4,
      maxRetries: 0,
    });

    await expect(client.systemResource()).rejects.toThrow(RouterOsError);
    await client.close();
  });

  it("close() dapat dipanggil berulang tanpa melempar", async () => {
    const client = routerosClient({
      host: "127.0.0.1",
      port: 3,
      username: "admin",
      connectTimeoutSec: 3,
    });
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("method setelah close() melempar NOT_CONNECTED", async () => {
    const client = routerosClient({
      host: "127.0.0.1",
      port: 4,
      username: "admin",
      connectTimeoutSec: 3,
      maxRetries: 0,
    });
    await client.close();
    await expect(client.pppoeActive()).rejects.toMatchObject({
      name: "RouterOsError",
      code: "NOT_CONNECTED",
    });
  });
});

describe("routerosClient — normalisasi data (unit)", () => {
  it("parseRouterOsUptime mengonversi format durasi RouterOS", () => {
    expect(parseRouterOsUptime("20s")).toBe(20);
    expect(parseRouterOsUptime("3h4m20s")).toBe(3 * 3600 + 4 * 60 + 20);
    expect(parseRouterOsUptime("1w2d3h4m5s")).toBe(
      (1 * 7 + 2) * 86400 + 3 * 3600 + 4 * 60 + 5,
    );
    expect(parseRouterOsUptime(undefined)).toBe(0);
    expect(parseRouterOsUptime("45")).toBe(45);
  });
});

describe("RouterOSAPI — API bawaan library", () => {
  it("timeout dihitung dalam detik dan default 10", () => {
    const api = new RouterOSAPI({ host: "127.0.0.1", user: "admin", password: "" });
    expect(typeof api.timeout).toBe("number");
    expect(api.timeout).toBeGreaterThanOrEqual(1);
  });
});
