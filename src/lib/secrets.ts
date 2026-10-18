import { prisma, type Tx } from "./db";
import { openSecret, sealSecret, secretFingerprint } from "./crypto";
import { Prisma } from "@prisma/client";
import { ConfigurationError, ValidationError, type Actor } from "./permissions";

import { SECRET_SETTING_BY_KEY, type SecretSettingKey } from "./settings/registry";

export type SecretStatus = {
  key: string;
  isSet: boolean;
  fingerprint: string | null;
  updatedAt: Date | null;
};

async function writeSecret(
  actor: Actor,
  key: string,
  plaintext: string,
  client: Tx | typeof prisma,
): Promise<void> {
  const sealed = sealSecret(plaintext);
  const fingerprint = secretFingerprint(plaintext);
  const existing = await client.secretSetting.findUnique({ where: { key } });
  await client.secretSetting.upsert({
    where: { key },
    create: {
      key,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      fingerprint,
      updatedById: actor.userId,
    },
    update: {
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      fingerprint,
      updatedById: actor.userId,
    },
  });
  await client.settingHistory.create({
    data: {
      key,
      oldValue: (existing ? { fingerprint: existing.fingerprint } : Prisma.DbNull) as Prisma.InputJsonValue,
      newValue: { fingerprint } as Prisma.InputJsonValue,

      isSecretKey: true,
      changedById: actor.userId,
    },
  });
  await client.auditLog.create({
    data: {
      actorType: "USER",
      actorId: actor.userId,
      actorLabel: actor.label,
      action: existing ? "secret.update" : "secret.create",
      entityType: "SecretSetting",
      entityId: key,
      metadata: { fingerprint },
    },
  });
}

/** Simpan kredensial integrasi (terenkripsi). Nilai tidak pernah dikembalikan ke UI. */
export async function setSecret(
  actor: Actor,
  key: SecretSettingKey,
  plaintext: string,
  client?: Tx,
): Promise<void> {
  if (!SECRET_SETTING_BY_KEY[key]) {
    throw new ValidationError(`Kredensial tidak dikenal: ${key}`);
  }
  if (plaintext.trim().length === 0) {
    throw new ValidationError("Nilai kredensial tidak boleh kosong");
  }
  if (plaintext.length > 4096) {
    throw new ValidationError("Nilai kredensial terlalu panjang");
  }
  if (client) {
    await writeSecret(actor, key, plaintext, client);
    return;
  }
  await prisma.$transaction((tx) => writeSecret(actor, key, plaintext, tx));
}

export async function deleteSecret(
  actor: Actor,
  key: SecretSettingKey,
  client?: Tx,
): Promise<void> {
  const run = async (tx: Tx) => {
    const existing = await tx.secretSetting.findUnique({ where: { key } });
    if (!existing) return;
    await tx.secretSetting.delete({ where: { key } });
    await tx.settingHistory.create({
      data: {
        key,
      oldValue: { fingerprint: existing.fingerprint } as Prisma.InputJsonValue,
      newValue: Prisma.DbNull,


        isSecretKey: true,
        changedById: actor.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: "USER",
        actorId: actor.userId,
        actorLabel: actor.label,
        action: "secret.delete",
        entityType: "SecretSetting",
        entityId: key,
      },
    });
  };
  if (client) await run(client);
  else await prisma.$transaction(run);
}

/** Baca kredensial untuk dipakai server-side. Melempar bila belum dikonfigurasi. */
export async function requireSecret(
  key: SecretSettingKey,
  client: Tx | typeof prisma = prisma,
): Promise<string> {
  const value = await getSecret(key, client);
  if (!value) {
    const def = SECRET_SETTING_BY_KEY[key];
    throw new ConfigurationError(
      `Kredensial "${def?.label ?? key}" belum dikonfigurasi. Buka Pengaturan → Integrasi.`,
    );
  }
  return value;
}

export async function getSecret(
  key: SecretSettingKey,
  client: Tx | typeof prisma = prisma,
): Promise<string | null> {
  const row = await client.secretSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return openSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
  } catch (error) {
    throw new ConfigurationError(
      `Gagal mendekripsi kredensial "${key}". ENCRYPTION_KEY mungkin berubah: ${
        error instanceof Error ? error.message : "tidak diketahui"
      }`,
    );
  }
}

export async function listSecretStatus(
  client: Tx | typeof prisma = prisma,
): Promise<SecretStatus[]> {
  const rows = await client.secretSetting.findMany({
    select: { key: true, fingerprint: true, updatedAt: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.keys(SECRET_SETTING_BY_KEY).map((key) => {
    const row = byKey.get(key);
    return {
      key,
      isSet: Boolean(row),
      fingerprint: row?.fingerprint ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}