import { prisma, type Tx } from "../../db";
import { openSecret, sealSecret, secretFingerprint, type SealedSecret } from "../../crypto";
import { ConfigurationError, NotFoundError, type AnyActor } from "../../permissions";
import { recordAudit } from "../../audit";
import { routerosClient, RouterOsError, type RouterOsResource } from "./client";
import type { Router } from "@prisma/client";

/**
 * Tes & pencatatan kesehatan router.
 *
 * Kredensial API router disimpan terenkripsi pada baris Router itu sendiri
 * (kolom `secretCiphertext`/`secretIv`/`secretAuthTag` + `secretFingerprint`
 * AES-256-GCM dari `src/lib/crypto.ts`). Alasannya:
 *   1. kredensial terikat 1:1 ke sebuah router, sehingga kolom pada model
 *      Router adalah tempat paling alami (bukan tabel global SecretSetting
 *      yang dipakai untuk integrasi tingkat aplikasi seperti Fonnte);
 *   2. relasi langsung memastikan kredensial ikut terhapus bersama router;
 *   3. `secretFingerprint` memungkinkan UI menampilkan "sudah dikonfigurasi"
 *      tanpa membuka ciphertext.
 *
 * Password tidak pernah masuk audit log; `recordAudit` tetap menerima
 * metadata yang sudah diredaksi secara eksplisit di sini.
 */

export type RouterCredentials = {
  username: string;
  password: string;
  port: number;
  useTls: boolean;
};

/** Enkripsi password API dan kembalikan kolom siap disimpan ke Router. */
export function sealRouterPassword(password: string): SealedSecret & { fingerprint: string } {
  return { ...sealSecret(password), fingerprint: secretFingerprint(password) };
}

/** Baca password API terenkripsi dari baris Router. */
export function readRouterPassword(router: Pick<Router, "secretCiphertext" | "secretIv" | "secretAuthTag">): string | null {
  if (!router.secretCiphertext || !router.secretIv || !router.secretAuthTag) return null;
  try {
    return openSecret({
      ciphertext: router.secretCiphertext,
      iv: router.secretIv,
      authTag: router.secretAuthTag,
    });
  } catch (error) {
    throw new ConfigurationError(
      `Gagal mendekripsi kredensial router. ENCRYPTION_KEY mungkin berubah: ${
        error instanceof Error ? error.message : "tidak diketahui"
      }`,
    );
  }
}

export type RouterHealthResult = {
  routerId: string;
  code: string;
  name: string;
  host: string;
  status: "UP" | "DOWN";
  ok: boolean;
  identity: string | null;
  version: string | null;
  uptimeSec: number | null;
  resource: RouterOsResource | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: Date;
};

/**
 * Sambungkan ke router, ambil identitas + resource, lalu simpan hasilnya ke
 * baris Router (`lastStatus`, `lastCheckedAt`, `identity`, `version`,
 * `uptimeSec`, `lastError`).
 *
 * READ-ONLY terhadap jaringan: hanya membaca `/system/identity/print` dan
 * `/system/resource/print`. Pemanggil dari route handler sebaiknya memakai
 * izin `routers.view` (atau `routers.manage` untuk konfigurasi).
 */
export async function testRouterConnection(
  actor: AnyActor,
  routerId: string,
  client: Tx | typeof prisma = prisma,
): Promise<RouterHealthResult> {
  const router = await client.router.findUnique({ where: { id: routerId } });
  if (!router) throw new NotFoundError(`Router dengan id "${routerId}" tidak ditemukan`);

  const password = readRouterPassword(router);
  if (password === null) {
    throw new ConfigurationError(
      `Kredensial API router "${router.code}" belum dikonfigurasi`,
    );
  }

  const startedAt = Date.now();
  let status: "UP" | "DOWN" = "UP";
  let identity: string | null = null;
  let version: string | null = null;
  let uptimeSec: number | null = null;
  let resource: RouterOsResource | null = null;
  let errorMessage: string | null = null;

  try {
    const ros = routerosClient({
      host: router.host,
      port: router.apiPort,
      username: router.username,
      password,
      useTls: router.useTls,
    });
    try {
      const [id, res] = await Promise.all([ros.identify(), ros.systemResource()]);
      identity = id.name;
      resource = res;
      version = res.version || null;
      uptimeSec = res.uptimeSec;
    } finally {
      await ros.close();
    }
  } catch (error) {
    status = "DOWN";
    errorMessage = error instanceof RouterOsError
      ? `[${error.code}] ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  }

  const latencyMs = status === "UP" ? Math.max(Date.now() - startedAt, 0) : null;

  await client.router.update({
    where: { id: routerId },
    data: {
      lastStatus: status,
      lastCheckedAt: new Date(),
      lastError: errorMessage,
      identity,
      version,
      uptimeSec,
    },
  });

  await recordAudit(
    actor,
    {
      action: "router.connect.test",
      entityType: "Router",
      entityId: routerId,
      metadata: {
        code: router.code,
        host: router.host,
        port: router.apiPort,
        username: router.username,
        status,
        identity,
        version,
        latencyMs,
        error: errorMessage,
      },
    },
    client,
  );

  return {
    routerId,
    code: router.code,
    name: router.name,
    host: router.host,
    status,
    ok: status === "UP",
    identity,
    version,
    uptimeSec,
    resource,
    latencyMs,
    error: errorMessage,
    checkedAt: new Date(),
  };
}
