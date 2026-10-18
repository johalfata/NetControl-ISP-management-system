import { prisma } from "../db";
import { assertPasswordPolicy, hashPassword, verifyPassword } from "./password";
import {
  createPortalSession,
  createStaffSession,
  revokeAllPortalSessions,
  revokeAllUserSessions,
  type SessionCookie,
} from "./session";
import { runtimeSettings } from "../settings/service";
import { recordAudit } from "../audit";
import {
  UnauthenticatedError,
  ValidationError,
  type Actor,
  type PortalActor,
} from "../permissions";
import {
  consumeRateLimit,
  rateLimitKeyForIdentity,
  rateLimitKeyForIp,
  resetRateLimit,
} from "../rate-limit";

export type LoginRequest = {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type LoginResult =
  | {
      ok: true;
      cookie: SessionCookie;
      user: { id: string; email: string; name: string; role: string; mustChangePassword: boolean };
    }
  | { ok: false; error: string; retryAfterSec?: number };

function publicLoginError(): string {
  // Pesan seragam untuk mencegah enumerasi akun.
  return "Email atau password salah";
}

export async function authenticateStaff(request: LoginRequest): Promise<LoginResult> {
  const email = request.email.trim().toLowerCase();
  if (!email || !request.password) {
    return { ok: false, error: publicLoginError() };
  }

  const ipLimit = consumeRateLimit(rateLimitKeyForIp("staff-login", request.ip ?? null), 20, 300);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      error: `Terlalu banyak percobaan dari alamat ini. Coba lagi dalam ${ipLimit.retryAfterSec} detik.`,
      retryAfterSec: ipLimit.retryAfterSec,
    };
  }
  const identityLimit = consumeRateLimit(rateLimitKeyForIdentity("staff-login", email), 10, 300);
  if (!identityLimit.allowed) {
    return {
      ok: false,
      error: `Terlalu banyak percobaan untuk akun ini. Coba lagi dalam ${identityLimit.retryAfterSec} detik.`,
      retryAfterSec: identityLimit.retryAfterSec,
    };
  }

  const settings = await runtimeSettings();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Lakukan hash dummy agar waktu respons tidak membocorkan keberadaan akun.
    await verifyPassword(request.password, "$2a$12$0000000000000000000000000000000000000000000000000000");
    return { ok: false, error: publicLoginError() };
  }
  if (!user.isActive) {
    return { ok: false, error: "Akun dinonaktifkan. Hubungi administrator." };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const retry = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    return {
      ok: false,
      error: `Akun terkunci sementara. Coba lagi dalam ${retry} detik.`,
      retryAfterSec: retry,
    };
  }

  const valid = await verifyPassword(request.password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginCount + 1;
    const shouldLock = attempts >= settings.loginMaxAttempts;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + settings.lockoutMinutes * 60_000)
          : null,
      },
    });
    await recordAudit(
      { kind: "system", label: "auth" },
      {
        action: shouldLock ? "auth.login.locked" : "auth.login.failed",
        entityType: "User",
        entityId: user.id,
        ip: request.ip ?? null,
        metadata: { email, attempts },
      },
    );
    if (shouldLock) {
      return {
        ok: false,
        error: `Akun terkunci sementara ${settings.lockoutMinutes} menit setelah ${settings.loginMaxAttempts} percobaan gagal.`,
        retryAfterSec: settings.lockoutMinutes * 60,
      };
    }
    return { ok: false, error: publicLoginError() };
  }

  const { cookie } = await createStaffSession(user.id, {
    ip: request.ip ?? null,
    userAgent: request.userAgent ?? null,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  resetRateLimit(rateLimitKeyForIdentity("staff-login", email));

  await recordAudit(
    { kind: "user", userId: user.id, role: user.role, label: user.name },
    {
      action: "auth.login.success",
      entityType: "User",
      entityId: user.id,
      ip: request.ip ?? null,
    },
  );

  return {
    ok: true,
    cookie,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function authenticatePortal(request: LoginRequest): Promise<
  | {
      ok: true;
      cookie: SessionCookie;
      customerName: string;
    }
  | { ok: false; error: string; retryAfterSec?: number }
> {
  const email = request.email.trim().toLowerCase();
  if (!email || !request.password) return { ok: false, error: publicLoginError() };

  const ipLimit = consumeRateLimit(rateLimitKeyForIp("portal-login", request.ip ?? null), 20, 300);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      error: `Terlalu banyak percobaan. Coba lagi dalam ${ipLimit.retryAfterSec} detik.`,
      retryAfterSec: ipLimit.retryAfterSec,
    };
  }

  const settings = await runtimeSettings();
  const portalUser = await prisma.customerPortalUser.findUnique({
    where: { email },
    include: { customer: { select: { id: true, name: true, status: true } } },
  });

  if (!portalUser) {
    await verifyPassword(request.password, "$2a$12$0000000000000000000000000000000000000000000000000000");
    return { ok: false, error: publicLoginError() };
  }
  if (!portalUser.isActive) {
    return { ok: false, error: "Akun portal dinonaktifkan. Hubungi layanan pelanggan." };
  }
  if (portalUser.lockedUntil && portalUser.lockedUntil.getTime() > Date.now()) {
    const retry = Math.ceil((portalUser.lockedUntil.getTime() - Date.now()) / 1000);
    return { ok: false, error: `Akun terkunci sementara. Coba lagi dalam ${retry} detik.`, retryAfterSec: retry };
  }

  const valid = await verifyPassword(request.password, portalUser.passwordHash);
  if (!valid) {
    const attempts = portalUser.failedLoginCount + 1;
    const shouldLock = attempts >= settings.loginMaxAttempts;
    await prisma.customerPortalUser.update({
      where: { id: portalUser.id },
      data: {
        failedLoginCount: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + settings.lockoutMinutes * 60_000) : null,
      },
    });
    return { ok: false, error: shouldLock ? "Akun terkunci sementara." : publicLoginError() };
  }

  const { cookie } = await createPortalSession(portalUser.id, {
    ip: request.ip ?? null,
    userAgent: request.userAgent ?? null,
  });
  await prisma.customerPortalUser.update({
    where: { id: portalUser.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await recordAudit(
    { kind: "portal", portalUserId: portalUser.id, customerId: portalUser.customerId, label: portalUser.customer.name },
    { action: "portal.login.success", entityType: "CustomerPortalUser", entityId: portalUser.id, ip: request.ip ?? null },
  );
  return { ok: true, cookie, customerName: portalUser.customer.name };
}

/** Ganti password sendiri; mencabut semua sesi lain. */
export async function changeOwnPassword(
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const settings = await runtimeSettings();
  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user) throw new UnauthenticatedError();
  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) throw new ValidationError("Password saat ini tidak sesuai");
  if (input.newPassword === input.currentPassword) {
    throw new ValidationError("Password baru harus berbeda dari password saat ini");
  }
  assertPasswordPolicy(input.newPassword, settings.passwordMinLength);
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  await revokeAllUserSessions(user.id);
  await recordAudit(actor, {
    action: "auth.password.change",
    entityType: "User",
    entityId: user.id,
  });
}

export async function changeOwnPortalPassword(
  actor: PortalActor,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const settings = await runtimeSettings();
  const portalUser = await prisma.customerPortalUser.findUnique({
    where: { id: actor.portalUserId },
  });
  if (!portalUser) throw new UnauthenticatedError();
  const valid = await verifyPassword(input.currentPassword, portalUser.passwordHash);
  if (!valid) throw new ValidationError("Password saat ini tidak sesuai");
  assertPasswordPolicy(input.newPassword, settings.passwordMinLength);
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.customerPortalUser.update({
    where: { id: portalUser.id },
    data: { passwordHash, mustChangePassword: false },
  });
  await revokeAllPortalSessions(portalUser.id);
  await recordAudit(
    { kind: "portal", portalUserId: portalUser.id, customerId: portalUser.customerId, label: actor.label },
    { action: "portal.password.change", entityType: "CustomerPortalUser", entityId: portalUser.id },
  );
}