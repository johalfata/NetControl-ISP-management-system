import { RouterOSAPI, RosException } from "node-routeros";

/**
 * Klien RouterOS (MikroTik) yang aman dan tangguh terhadap kegagalan.
 *
 * Setiap method melempar `RouterOsError` dengan `code` yang deterministik
 * sehingga pemanggil (route handler / job) dapat memetakan kesalahan ke
 * respons HTTP atau aksi remediasi yang tepat:
 *
 * - `CONNECT_TIMEOUT`   — koneksi tidak terbentuk dalam connectTimeout.
 * - `AUTH_FAILED`       — kredensial ditolak oleh router.
 * - `COMMAND_FAILED`    — perintah ditolak (trap) atau waktu habis di command.
 * - `NOT_CONNECTED`     — method dipanggil setelah koneksi ditutup.
 *
 * Path API (`/system/identity`, `/ppp/active`, ...) identik untuk RouterOS v6
 * dan v7; perbedaannya hanya nama field respons. Semua output dinormalisasi ke
 * bentuk di bawah agar service layer tidak perlu tahu versi router.
 *
 * PEMAKAIAN: panggil `close()` setelah selesai (gunakan `try/finally` atau
 * `using`). Method control (disconnect/disable/enable) tidak boleh dipakai
 * dari alur read-only monitoring.
 */

const DEFAULT_CONNECT_TIMEOUT_SEC = 10;
const DEFAULT_COMMAND_TIMEOUT_SEC = 15;

export type RouterOsErrorCode =
  | "CONNECT_TIMEOUT"
  | "CONNECT_FAILED"
  | "AUTH_FAILED"
  | "COMMAND_FAILED"
  | "COMMAND_TIMEOUT"
  | "NOT_CONNECTED";

export class RouterOsError extends Error {
  readonly code: RouterOsErrorCode;
  readonly cause: unknown;
  constructor(code: RouterOsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "RouterOsError";
    this.code = code;
    this.cause = cause;
  }
}

export type RouterOsClientOptions = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  useTls?: boolean;
  /** Batas waktu pembentukan koneksi + login, dalam detik. */
  connectTimeoutSec?: number;
  /** Batas waktu setiap perintah (baca maupun tulis), dalam detik. */
  commandTimeoutSec?: number;
  /**
   * Retry terbatas untuk perintah baca yang gagal karena koneksi terputus
   * di tengah jalan. Default 2. Selalu 0 untuk perintah yang mengubah
   * konfigurasi (disconnect/disable/enable) — sekali gagal, tidak diulang.
   */
  maxRetries?: number;
};

export type RouterOsIdentity = {
  name: string;
};

export type RouterOsResource = {
  uptimeSec: number;
  version: string;
  boardName: string;
  cpuLoadPct: number;
  freeMemoryBytes: bigint;
  totalMemoryBytes: bigint;
  freeHddBytes: bigint | null;
  totalHddBytes: bigint | null;
  cpuCount: number | null;
  architectureName: string | null;
};

export type RouterOsPppoeActive = {
  id: string;
  name: string;
  service: string;
  callerId: string | null;
  address: string | null;
  uptimeSec: number;
  rxBytes: bigint;
  txBytes: bigint;
};

export type RouterOsPppoeProfile = {
  name: string;
  rateLimitRxKbps: number | null;
  rateLimitTxKbps: number | null;
  isDefault: boolean;
};

export type RouterOsInterfaceTraffic = {
  name: string;
  rxBytes: bigint;
  txBytes: bigint;
  rxRateBps: bigint | null;
  txRateBps: bigint | null;
  linkUp: boolean;
  running: boolean;
  mtu: number | null;
};

export type RouterOsPppoeSecret = {
  id: string;
  name: string;
  profile: string | null;
  service: string | null;
  remoteAddress: string | null;
  disabled: boolean;
  comment: string | null;
};

type RosRow = Record<string, string | undefined>;

/** `true` bila nilai RouterOS yang umum berarti ya/aktif. */
function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "yes" || value === "1";
}

function toBigInt(value: string | undefined, fallback = 0n): bigint {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = value.trim();
  // RouterOS kadang mengirim "1234567B" / "2MiB" untuk field memori.
  const match = /^(\d+)([KMG]i?)?B?$/.exec(normalized);
  if (match) {
    const n = BigInt(match[1] as string);
    const unit = match[2];
    const mult = unit === "K" ? 1024n : unit === "Ki" ? 1024n
      : unit === "M" ? 1024n * 1024n : unit === "Mi" ? 1024n * 1024n
      : unit === "G" ? 1024n * 1024n * 1024n : unit === "Gi" ? 1024n * 1024n * 1024n
      : 1n;
    return n * mult;
  }
  try {
    return BigInt(normalized);
  } catch {
    return fallback;
  }
}

function toInt(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/** Konversi durasi RouterOS ("1w2d3h4m5s", "3h4m20s", "20s") ke detik. */
export function parseRouterOsUptime(value: string | undefined): number {
  if (!value) return 0;
  const parts = /^((\d+)w)?((\d+)d)?((\d+)h)?((\d+)m)?((\d+)s)?$/.exec(value.trim());
  if (!parts) {
    const seconds = Number.parseFloat(value);
    return Number.isFinite(seconds) ? Math.trunc(seconds) : 0;
  }
  const weeks = Number(parts[2] ?? 0);
  const days = Number(parts[4] ?? 0);
  const hours = Number(parts[6] ?? 0);
  const minutes = Number(parts[8] ?? 0);
  const seconds = Number(parts[10] ?? 0);
  return (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds;
}

function normalizeResource(row: RosRow): RouterOsResource {
  const freeMemory = toBigInt(row["free-memory"]);
  const totalMemory = toBigInt(row["total-memory"]);
  return {
    uptimeSec: parseRouterOsUptime(row["uptime"]),
    // v6: "version", v7: "version" — sama; board: v6 "board-name", v7 "board-name".
    version: row["version"] ?? "",
    boardName: row["board-name"] ?? row["board"] ?? "",
    cpuLoadPct: toInt(row["cpu-load"]),
    freeMemoryBytes: freeMemory,
    totalMemoryBytes: totalMemory,
    freeHddBytes: row["free-hdd-space"] === undefined ? null : toBigInt(row["free-hdd-space"]),
    totalHddBytes: row["total-hdd-space"] === undefined ? null : toBigInt(row["total-hdd-space"]),
    cpuCount: row["cpu-count"] === undefined ? null : toInt(row["cpu-count"]),
    architectureName: row["architecture-name"] ?? null,
  };
}

function normalizePppoeActive(row: RosRow): RouterOsPppoeActive {
  return {
    id: row[".id"] ?? "",
    name: row["name"] ?? "",
    service: row["service"] ?? "pppoe",
    callerId: row["caller-id"] ?? null,
    address: row["address"] ?? null,
    uptimeSec: parseRouterOsUptime(row["uptime"]),
    rxBytes: toBigInt(row["bytes-in"] ?? row["rx-byte"]),
    txBytes: toBigInt(row["bytes-out"] ?? row["tx-byte"]),
  };
}

function normalizeInterface(row: RosRow): RouterOsInterfaceTraffic {
  return {
    name: row["name"] ?? "",
    rxBytes: toBigInt(row["rx-byte"] ?? row["rx-bytes"]),
    txBytes: toBigInt(row["tx-byte"] ?? row["tx-bytes"]),
    rxRateBps: row["rx-rate"] === undefined ? null : toBigInt(row["rx-rate"]),
    txRateBps: row["tx-rate"] === undefined ? null : toBigInt(row["tx-rate"]),
    linkUp: isTruthy(row["link-up"]),
    running: isTruthy(row["running"]),
    mtu: row["mtu"] === undefined ? null : toInt(row["mtu"], 1500),
  };
}

function normalizeSecret(row: RosRow): RouterOsPppoeSecret {
  return {
    id: row[".id"] ?? "",
    name: row["name"] ?? "",
    profile: row["profile"] ?? null,
    service: row["service"] ?? null,
    remoteAddress: row["remote-address"] ?? null,
    disabled: isTruthy(row["disabled"]),
    comment: row["comment"] ?? null,
  };
}

export type RouterOsClient = {
  /** `/system/identity/print` — read-only. */
  identify(): Promise<RouterOsIdentity>;
  /** `/system/resource/print` — read-only. */
  systemResource(): Promise<RouterOsResource>;
  /** `/ppp/active/print` — read-only. */
  pppoeActive(): Promise<RouterOsPppoeActive[]>;
  /** `/ppp/profile/print` — read-only. */
  pppoeProfiles(): Promise<RouterOsPppoeProfile[]>;
  /** `/interface/print` — read-only. */
  interfaceTraffic(names?: string[]): Promise<RouterOsInterfaceTraffic[]>;
  /** `/ppp/secret/print` untuk satu pengguna — read-only. */
  pppoeSecret(name: string): Promise<RouterOsPppoeSecret | null>;
  /**
   * `/ppp/active/remove` — KONTROL: memutus sesi PPPoE aktif.
   * Tidak diulang bila gagal (idempotensi di sisi pemanggil).
   */
  disconnectPppoeSession(nameOrId: string): Promise<void>;
  /**
   * `/ppp/secret/enable` — KONTROL: mengaktifkan kembali rahasia PPPoE.
   */
  enablePppoeSecret(nameOrId: string): Promise<void>;
  /**
   * `/ppp/secret/disable` — KONTROL: menonaktifkan rahasia PPPoE (isolir).
   */
  disablePppoeSecret(nameOrId: string): Promise<void>;
  /** Tutup koneksi socket. Aman dipanggil berulang. */
  close(): Promise<void>;
};

function classifyConnectError(error: unknown): RouterOsError {
  if (error instanceof RouterOsError) return error;
  if (error instanceof RosException) {
    const errno = error.errno;
    if (errno === "CANTLOGIN") {
      return new RouterOsError("AUTH_FAILED", "Kredensial RouterOS ditolak oleh router", error);
    }
    if (errno === "SOCKTMOUT" || errno === "ETIMEDOUT") {
      return new RouterOsError("CONNECT_TIMEOUT", "Koneksi RouterOS waktu habis (timeout)", error);
    }
    return new RouterOsError("CONNECT_FAILED", `Koneksi RouterOS gagal: ${errno}`, error);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed?\s*out/i.test(message)) {
    return new RouterOsError("CONNECT_TIMEOUT", "Koneksi RouterOS waktu habis (timeout)", error);
  }
  return new RouterOsError("CONNECT_FAILED", `Koneksi RouterOS gagal: ${message}`, error);
}

function classifyCommandError(error: unknown): RouterOsError {
  if (error instanceof RouterOsError) return error;
  if (error instanceof RosException) {
    const errno = error.errno;
    if (errno === "CANTLOGIN") {
      return new RouterOsError("AUTH_FAILED", "Kredensial RouterOS ditolak oleh router", error);
    }
    if (errno === "SOCKTMOUT" || errno === "ETIMEDOUT" || errno === "ECONNRESET") {
      return new RouterOsError("COMMAND_TIMEOUT", "Perintah RouterOS waktu habis atau koneksi terputus", error);
    }
    return new RouterOsError("COMMAND_FAILED", `Perintah RouterOS gagal: ${errno}`, error);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed?\s*out/i.test(message)) {
    return new RouterOsError("COMMAND_TIMEOUT", `Perintah RouterOS waktu habis: ${message}`, error);
  }
  return new RouterOsError("COMMAND_FAILED", `Perintah RouterOS gagal: ${message}`, error);
}

export function routerosClient(options: RouterOsClientOptions): RouterOsClient {
  const connectTimeoutSec = options.connectTimeoutSec ?? DEFAULT_CONNECT_TIMEOUT_SEC;
  const commandTimeoutSec = options.commandTimeoutSec ?? DEFAULT_COMMAND_TIMEOUT_SEC;
  const maxRetries = options.maxRetries ?? 2;

  const api = new RouterOSAPI({
    host: options.host,
    port: options.port ?? (options.useTls ? 8729 : 8728),
    user: options.username,
    password: options.password ?? "",
    timeout: Math.max(connectTimeoutSec, 1),
    tls: options.useTls ? {} : undefined,
    keepalive: false,
  });

  let connected = false;
  let closed = false;

  async function connect(): Promise<void> {
    if (connected) return;
    if (closed) {
      throw new RouterOsError("NOT_CONNECTED", "Klien RouterOS sudah ditutup");
    }
    try {
      await api.connect();
      connected = true;
    } catch (error) {
      throw classifyConnectError(error);
    }
  }

  /**
   * Jalankan satu perintah read-only. Koneksi dipasang ulang (sekali) bila
   * socket terputus di tengah jalan — pola umum pada jaringan tidak stabil.
   * Konektivitas buruk menyebabkan error akhirnya, bukan data palsu.
   */
  async function read<T>(command: string, params?: string[], retries = maxRetries): Promise<T[]> {
    await connect();
    try {
      const rows = await withTimeout(api.write(command, params ?? []), commandTimeoutSec);
      return rows as unknown as T[];
    } catch (error) {
      const classified = classifyCommandError(error);
      const reconnectable =
        classified.code === "COMMAND_TIMEOUT" || classified.code === "CONNECT_FAILED";
      if (retries <= 0 || !reconnectable) throw classified;
      connected = false;
      try {
        await api.close();
      } catch {
        // socket sudah rusak — biarkan
      }
      await connect();
      return read<T>(command, params, retries - 1);
    }
  }

  /** Perintah KONTROL: tidak pernah diulang. */
  async function write(command: string, params: string[]): Promise<void> {
    await connect();
    try {
      await withTimeout(api.write(command, params), commandTimeoutSec);
    } catch (error) {
      connected = false;
      throw classifyCommandError(error);
    }
  }

  return {
    async identify(): Promise<RouterOsIdentity> {
      const rows = await read<RosRow>("/system/identity/print");
      const row = rows[0] ?? {};
      return { name: row["name"] ?? options.host };
    },

    async systemResource(): Promise<RouterOsResource> {
      const rows = await read<RosRow>("/system/resource/print");
      const row = rows[0] ?? {};
      return normalizeResource(row);
    },

    async pppoeActive(): Promise<RouterOsPppoeActive[]> {
      const rows = await read<RosRow>("/ppp/active/print");
      return rows.map(normalizePppoeActive);
    },

    async pppoeProfiles(): Promise<RouterOsPppoeProfile[]> {
      const rows = await read<RosRow>("/ppp/profile/print");
      return rows.map((row) => {
        const limit = row["rate-limit"] ?? "";
        // RouterOS: "rxRate/txRate" (mis. "10M/20M") atau nilai tunggal.
        const [rxPart, txPart] = limit.split("/");
        return {
          name: row["name"] ?? "",
          rateLimitRxKbps: rxPart ? parseRateKbps(rxPart) : null,
          rateLimitTxKbps: txPart ? parseRateKbps(txPart) : rxPart ? parseRateKbps(rxPart) : null,
          isDefault: isTruthy(row["default"]),
        };
      });
    },

    async interfaceTraffic(names?: string[]): Promise<RouterOsInterfaceTraffic[]> {
      const params = names && names.length > 0 ? names.map((n) => `?name=${n}`) : undefined;
      const rows = await read<RosRow>("/interface/print", params);
      return rows.map(normalizeInterface);
    },

    async pppoeSecret(name: string): Promise<RouterOsPppoeSecret | null> {
      const rows = await read<RosRow>("/ppp/secret/print", [`?name=${name}`]);
      const row = rows.find((r) => r["name"] === name);
      return row ? normalizeSecret(row) : null;
    },

    async disconnectPppoeSession(nameOrId: string): Promise<void> {
      const target = await resolveActiveId(nameOrId);
      await write("/ppp/active/remove", [target.startsWith("*") ? `=.id=${target}` : `=.id=${target}`]);
    },

    async enablePppoeSecret(nameOrId: string): Promise<void> {
      const target = await resolveSecretId(nameOrId);
      await write("/ppp/secret/enable", [`=.id=${target}`]);
    },

    async disablePppoeSecret(nameOrId: string): Promise<void> {
      const target = await resolveSecretId(nameOrId);
      await write("/ppp/secret/disable", [`=.id=${target}`]);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      connected = false;
      try {
        await api.close();
      } catch {
        // Penutupan socket tidak perlu melempar.
      }
    },
  };

  /**
   * `/ppp/active/remove` butuh `.id` internal (mis. "*1"), bukan username.
   * Cari dulu di tabel aktif; bila tidak ada, asumsikan pemanggil memberi
   * `.id` mentah — biarkan router yang menolak bila salah.
   */
  async function resolveActiveId(nameOrId: string): Promise<string> {
    if (nameOrId.startsWith("*")) return nameOrId;
    const rows = await read<RosRow>("/ppp/active/print", [`?name=${nameOrId}`]);
    const row = rows.find((r) => r["name"] === nameOrId);
    const id = row?.[".id"];
    if (!id) {
      throw new RouterOsError(
        "COMMAND_FAILED",
        `Sesi PPPoE "${nameOrId}" tidak ditemukan di tabel aktif`,
      );
    }
    return id;
  }

  /** `/ppp/secret/enable|disable` butuh `.id` internal rahasia. */
  async function resolveSecretId(nameOrId: string): Promise<string> {
    if (nameOrId.startsWith("*")) return nameOrId;
    const rows = await read<RosRow>("/ppp/secret/print", [`?name=${nameOrId}`]);
    const row = rows.find((r) => r["name"] === nameOrId);
    const id = row?.[".id"];
    if (!id) {
      throw new RouterOsError(
        "COMMAND_FAILED",
        `Rahasia PPPoE "${nameOrId}" tidak ditemukan`,
      );
    }
    return id;
  }
}

/** Ubah token rate RouterOS ("10M", "512K", "2G", "5M5M") menjadi kbps. */
function parseRateKbps(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([kKmMgG])?$/.exec(value.trim());
  if (!match) return 0;
  const n = Number.parseFloat(match[1] as string);
  const unit = (match[2] ?? "").toLowerCase();
  const kbps = unit === "k" ? n : unit === "m" ? n * 1024 : unit === "g" ? n * 1024 * 1024 : n / 1000;
  return Math.max(Math.trunc(kbps), 0);
}

/**
 * `api.write()` tidak punya deadline sendiri; bungkus dengan timer agar
 * perintah yang menggantung tidak menyumbat pool worker. Mengembalikan
 * reject dengan RosException SOCKTMOUT supaya terklasifikasi sebagai timeout.
 */
function withTimeout<T>(promise: Promise<T>, seconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RosException("SOCKTMOUT", { seconds }));
    }, seconds * 1000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
