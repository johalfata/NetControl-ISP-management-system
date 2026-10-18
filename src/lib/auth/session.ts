import { prisma, type Tx } from "../db";
import { generateToken, hashToken } from "../crypto";
import { getEnv } from "../env";
import { runtimeSettings } from "../settings/service";
import type { Actor, PortalActor } from "../permissions";

export const STAFF_COOKIE = "nc_session";
export const PORTAL_COOKIE = "nc_portal_session";

type SessionClient = Tx | typeof prisma;

export type CookieOptions = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};

/**
 * Nama tipe yang dipakai modul auth lain untuk opsi cookie sesi.
 * Nilai konkretnya identik dengan CookieOptions (dibuat oleh cookieOptions()).
 */
export type SessionCookie = CookieOptions;

function cookieOptions(name: string, value: string, maxAgeSec: number): CookieOptions {
  return {
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  };
}

/** Buat sesi staf. Mengembalikan token mentah + opsi cookie. */
export async function createStaffSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
  client: SessionClient = prisma,
): Promise<{ token: string; cookie: CookieOptions }> {
  const settings = await runtimeSettings(client);
  const ttlSec = settings.sessionTtlMinutes * 60;
  const token = generateToken(32);
  await client.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlSec * 1000),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, cookie: cookieOptions(STAFF_COOKIE, token, ttlSec) };
}

export async function createPortalSession(
  portalUserId: string,
  meta: { ip?: string | null; userAgent?: string | null },
  client: SessionClient = prisma,
): Promise<{ token: string; cookie: CookieOptions }> {
  const settings = await runtimeSettings(client);
  const ttlSec = settings.portalSessionTtlMinutes * 60;
  const token = generateToken(32);
  await client.customerPortalSession.create({
    data: {
      portalUserId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlSec * 1000),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, cookie: cookieOptions(PORTAL_COOKIE, token, ttlSec) };
}

export function clearCookie(name: string): CookieOptions {
  return cookieOptions(name, "", 0);
}

/** Sesi staf yang valid, atau null. Sesi kedaluwarsa/dicabut otomatis diabaikan. */
export async function resolveStaffSession(
  token: string | undefined,
  client: SessionClient = prisma,
): Promise<Actor | null> {
  if (!token) return null;
  const session = await client.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
        },
      },
    },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;
  return {
    kind: "user",
    userId: session.user.id,
    role: session.user.role,
    label: session.user.name || session.user.email,
  };
}

export async function resolvePortalSession(
  token: string | undefined,
  client: SessionClient = prisma,
): Promise<PortalActor | null> {
  if (!token) return null;
  const session = await client.customerPortalSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      portalUser: {
        select: {
          id: true,
          customerId: true,
          email: true,
          isActive: true,
          customer: { select: { name: true, status: true } },
        },
      },
    },
  });
  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.portalUser.isActive) return null;
  return {
    kind: "portal",
    portalUserId: session.portalUser.id,
    customerId: session.portalUser.customerId,
    label: session.portalUser.customer.name || session.portalUser.email,
  };
}

export async function revokeStaffSession(
  token: string,
  client: SessionClient = prisma,
): Promise<void> {
  await client.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokePortalSession(
  token: string,
  client: SessionClient = prisma,
): Promise<void> {
  await client.customerPortalSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Cabut seluruh sesi staf (mis. saat password diganti atau akun dinonaktifkan). */
export async function revokeAllUserSessions(
  userId: string,
  client: SessionClient = prisma,
): Promise<void> {
  await client.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllPortalSessions(
  portalUserId: string,
  client: SessionClient = prisma,
): Promise<void> {
  await client.customerPortalSession.updateMany({
    where: { portalUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Bersihkan sesi kedaluwarsa (dipanggil job maintenance). */
export async function purgeExpiredSessions(client: SessionClient = prisma): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [staff, portal] = await Promise.all([
    client.session.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    client.customerPortalSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);
  return staff.count + portal.count;
}