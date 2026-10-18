import type { Role } from "@prisma/client";

/**
 * Daftar izin. Setiap operasi terproteksi di server memanggil
 * `assertPermission(actor, "…")`. Tidak ada pemeriksaan izin yang hanya
 * dilakukan di UI.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "customers.view",
  "customers.manage",
  "customers.archive",
  "customers.import",
  "customers.export",
  "plans.view",
  "plans.manage",
  "subscriptions.view",
  "subscriptions.manage",
  "billing.view",
  "billing.manage",
  "billing.void",
  "payments.view",
  "payments.manage",
  "payments.void",
  "finance.view",
  "finance.manage",
  "routers.view",
  "routers.manage",
  "routers.control",
  "network.view",
  "network.manage",
  "topology.view",
  "topology.manage",
  "tickets.view",
  "tickets.manage",
  "notifications.view",
  "notifications.manage",
  "notifications.send",
  "reports.view",
  "reports.export",
  "audit.view",
  "jobs.view",
  "jobs.run",
  "settings.view",
  "settings.manage",
  "users.view",
  "users.manage",
  "portal.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READONLY: Permission[] = [
  "dashboard.view",
  "customers.view",
  "plans.view",
  "subscriptions.view",
  "billing.view",
  "payments.view",
  "finance.view",
  "routers.view",
  "network.view",
  "topology.view",
  "tickets.view",
  "notifications.view",
  "reports.view",
  "settings.view",
];

const TECHNICIAN: Permission[] = [
  ...READONLY,
  "customers.manage",
  "tickets.manage",
  "routers.control",
  "network.manage",
  "topology.manage",
  "jobs.run",
];

const BILLING: Permission[] = [
  ...READONLY,
  "customers.manage",
  "customers.import",
  "customers.export",
  "subscriptions.manage",
  "billing.manage",
  "payments.manage",
  "finance.manage",
  "notifications.send",
  "reports.export",
  "tickets.manage",
];

const ADMIN: Permission[] = [
  ...BILLING,
  ...TECHNICIAN,
  "customers.archive",
  "plans.manage",
  "billing.void",
  "payments.void",
  "routers.manage",
  "notifications.manage",
  "audit.view",
  "jobs.view",
  "jobs.run",
  "settings.manage",
  "users.view",
  "users.manage",
  "portal.manage",
];

const OWNER: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: Array.from(new Set(OWNER)),
  ADMIN: Array.from(new Set(ADMIN)),
  BILLING: Array.from(new Set(BILLING)),
  TECHNICIAN: Array.from(new Set(TECHNICIAN)),
  READONLY: Array.from(new Set(READONLY)),
};

export type Actor = {
  kind: "user";
  userId: string;
  role: Role;
  label: string;
};

export type PortalActor = {
  kind: "portal";
  portalUserId: string;
  customerId: string;
  label: string;
};

export type SystemActor = {
  kind: "system" | "webhook";
  label: string;
};

export type AnyActor = Actor | PortalActor | SystemActor;

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function assertUserActor(actor: AnyActor): asserts actor is Actor {
  if (actor.kind !== "user") {
    throw new PermissionError("Operasi ini memerlukan akun staf");
  }
}

export function assertPermission(actor: AnyActor, permission: Permission): void {
  if (actor.kind !== "user") {
    throw new PermissionError(
      `Aktor ${actor.kind} tidak memiliki izin ${permission}`,
    );
  }
  if (!hasPermission(actor.role, permission)) {
    throw new PermissionError(
      `Peran ${actor.role} tidak memiliki izin ${permission}`,
    );
  }
}

export class PermissionError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";
  constructor(message = "Sesi tidak valid atau telah berakhir") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ValidationError extends Error {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";
  readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  readonly code = "CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConfigurationError extends Error {
  readonly status = 503;
  readonly code = "NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}