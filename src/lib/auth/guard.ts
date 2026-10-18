import { cookies, headers } from "next/headers";
import {
  PORTAL_COOKIE,
  STAFF_COOKIE,
  resolvePortalSession,
  resolveStaffSession,
} from "./session";
import {
  UnauthenticatedError,
  assertPermission,
  type Actor,
  type Permission,
  type PortalActor,
} from "../permissions";

/**
 * Penjaga akses untuk server component, route handler, dan server action.
 * Semua operasi terproteksi WAJIB melewati salah satu fungsi di sini.
 */

export async function currentActor(): Promise<Actor | null> {
  const store = await cookies();
  return resolveStaffSession(store.get(STAFF_COOKIE)?.value);
}

export async function requireActor(permission?: Permission): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new UnauthenticatedError();
  if (permission) assertPermission(actor, permission);
  return actor;
}

export async function currentPortalActor(): Promise<PortalActor | null> {
  const store = await cookies();
  return resolvePortalSession(store.get(PORTAL_COOKIE)?.value);
}

export async function requirePortalActor(): Promise<PortalActor> {
  const actor = await currentPortalActor();
  if (!actor) throw new UnauthenticatedError("Sesi portal tidak valid atau berakhir");
  return actor;
}

export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : h.get("x-real-ip");
  return { ip: ip ?? null, userAgent: h.get("user-agent") };
}