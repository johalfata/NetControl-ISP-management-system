import { z } from "zod";
import { prisma, type Tx } from "../db";
import { assertPermission, type AnyActor } from "../permissions";
import { recordAudit } from "../audit";
import { allocateDocumentNumber } from "./numbering";
import { TicketPriority, TicketStatus, TicketSource, type Ticket, type TicketComment, type TicketEvent, type Prisma } from "@prisma/client";

export const createTicketSchema = z.object({
  customerId: z.string().optional(),
  categoryId: z.string().optional(),
  subject: z.string().min(1, "Subjek tiket wajib diisi"),
  description: z.string().min(1, "Deskripsi tiket wajib diisi"),
  priority: z.nativeEnum(TicketPriority).default("NORMAL"),
  source: z.nativeEnum(TicketSource).default("STAFF"),
  assignedToId: z.string().optional(),
  routerId: z.string().optional(),
  deviceNodeId: z.string().optional(),
  incidentId: z.string().optional(),
  slaDueAt: z.coerce.date().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = createTicketSchema.partial().extend({
  status: z.nativeEnum(TicketStatus).optional(),
});

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const addCommentSchema = z.object({
  body: z.string().min(1, "Isi komentar wajib diisi"),
  isInternal: z.boolean().default(false),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;

export const assignTicketSchema = z.object({
  assignedToId: z.string().nullable(),
});

export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

export const changeStatusSchema = z.object({
  status: z.nativeEnum(TicketStatus),
  note: z.string().optional(),
});

export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export type TicketView = Ticket & {
  customerName?: string | null;
  categoryName?: string | null;
  assignedName?: string | null;
  commentsCount?: number;
};

const TICKET_NUMBER_CONFIG = {
  format: "TICK-{YYYY}{MM}-{SEQ:4}",
  prefix: "TICK",
  resetPeriod: "MONTHLY" as const,
  scope: "TICKET",
};

export async function listTickets(
  filter: { status?: TicketStatus; priority?: TicketPriority; customerId?: string; assignedToId?: string; search?: string } = {},
  client: Tx | typeof prisma = prisma,
): Promise<TicketView[]> {
  const where: Prisma.TicketWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.priority) where.priority = filter.priority;
  if (filter.customerId) where.customerId = filter.customerId;
  if (filter.assignedToId) where.assignedToId = filter.assignedToId;
  if (filter.search) {
    where.OR = [
      { subject: { contains: filter.search, mode: "insensitive" } },
      { number: { contains: filter.search, mode: "insensitive" } },
      { description: { contains: filter.search, mode: "insensitive" } },
    ];
  }

  const tickets = await client.ticket.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      category: { select: { name: true } },
      assignedTo: { select: { name: true } },
      _count: { select: { comments: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return tickets.map((t) => ({
    ...t,
    customerName: t.customer?.name ?? null,
    categoryName: t.category?.name ?? null,
    assignedName: t.assignedTo?.name ?? null,
    commentsCount: t._count.comments,
  }));
}

export async function getTicket(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<Ticket & { comments: (TicketComment & { authorUser: { name: string } | null })[]; events: TicketEvent[]; customer: { name: string; code: string; phone: string | null } | null; assignedTo: { name: string } | null }> {
  const ticket = await client.ticket.findUnique({
    where: { id },
    include: {
      comments: {
        include: { authorUser: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      events: {
        orderBy: { createdAt: "asc" },
      },
      customer: { select: { name: true, code: true, phone: true } },
      assignedTo: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  if (!ticket) {
    throw new Error(`Tiket dengan ID ${id} tidak ditemukan`);
  }

  return ticket;
}

export async function createTicket(
  actor: AnyActor,
  input: CreateTicketInput,
  client: Tx | typeof prisma = prisma,
): Promise<Ticket> {
  assertPermission(actor, "tickets.manage");
  const parsed = createTicketSchema.parse(input);

  const now = new Date();
  const number = await allocateDocumentNumber(client, TICKET_NUMBER_CONFIG, now);

  const actorUserId = actor.kind === "user" ? actor.userId : null;

  const ticket = await client.ticket.create({
    data: {
      number,
      customerId: parsed.customerId,
      categoryId: parsed.categoryId,
      subject: parsed.subject,
      description: parsed.description,
      priority: parsed.priority,
      source: parsed.source,
      assignedToId: parsed.assignedToId,
      routerId: parsed.routerId,
      deviceNodeId: parsed.deviceNodeId,
      incidentId: parsed.incidentId,
      slaDueAt: parsed.slaDueAt,
      createdById: actorUserId,
    },
  });

  await client.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: "CREATED",
      toValue: ticket.status,
      actorUserId,
      note: `Tiket dibuat dengan nomor ${number}`,
    },
  });

  await recordAudit(
    actor,
    {
      action: "ticket.create",
      entityType: "Ticket",
      entityId: ticket.id,
      metadata: { number: ticket.number, subject: ticket.subject },
    },
    client,
  );

  return ticket;
}

export async function updateTicket(
  actor: AnyActor,
  id: string,
  input: UpdateTicketInput,
  client: Tx | typeof prisma = prisma,
): Promise<Ticket> {
  assertPermission(actor, "tickets.manage");
  const parsed = updateTicketSchema.parse(input);

  const existing = await client.ticket.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Tiket dengan ID ${id} tidak ditemukan`);
  }

  const { status, ...rest } = parsed;
  const ticket = await client.ticket.update({
    where: { id },
    data: rest,
  });

  if (status && status !== existing.status) {
    await changeTicketStatus(actor, id, { status, note: "Status diperbarui via update" }, client);
  }

  await recordAudit(
    actor,
    {
      action: "ticket.update",
      entityType: "Ticket",
      entityId: id,
      metadata: { number: ticket.number },
    },
    client,
  );

  return ticket;
}

export async function addTicketComment(
  actor: AnyActor,
  ticketId: string,
  input: AddCommentInput,
  client: Tx | typeof prisma = prisma,
): Promise<TicketComment> {
  assertPermission(actor, "tickets.manage");
  const parsed = addCommentSchema.parse(input);

  const authorType = actor.kind === "portal" ? "PORTAL" : "STAFF";
  const authorUserId = actor.kind === "user" ? actor.userId : null;
  const authorPortalUserId = actor.kind === "portal" ? actor.portalUserId : null;
  const actorUserId = actor.kind === "user" ? actor.userId : null;

  const comment = await client.ticketComment.create({
    data: {
      ticketId,
      authorType,
      authorUserId,
      authorPortalUserId,
      body: parsed.body,
      isInternal: parsed.isInternal,
    },
  });

  await client.ticketEvent.create({
    data: {
      ticketId,
      type: "COMMENT_ADDED",
      actorUserId,
      note: `Komentar baru oleh ${actor.label}`,
    },
  });

  return comment;
}

export async function assignTicket(
  actor: AnyActor,
  ticketId: string,
  input: AssignTicketInput,
  client: Tx | typeof prisma = prisma,
): Promise<Ticket> {
  assertPermission(actor, "tickets.manage");
  const parsed = assignTicketSchema.parse(input);

  const existing = await client.ticket.findUnique({ where: { id: ticketId } });
  if (!existing) {
    throw new Error(`Tiket dengan ID ${ticketId} tidak ditemukan`);
  }

  const actorUserId = actor.kind === "user" ? actor.userId : null;

  const ticket = await client.ticket.update({
    where: { id: ticketId },
    data: { assignedToId: parsed.assignedToId },
  });

  await client.ticketEvent.create({
    data: {
      ticketId,
      type: "ASSIGNED",
      fromValue: existing.assignedToId,
      toValue: parsed.assignedToId,
      actorUserId,
      note: `Penugasan diubah ke ${parsed.assignedToId ?? "Tidak ditugaskan"}`,
    },
  });

  await recordAudit(
    actor,
    {
      action: "ticket.assign",
      entityType: "Ticket",
      entityId: ticketId,
      metadata: { assignedToId: parsed.assignedToId },
    },
    client,
  );

  return ticket;
}

export async function changeTicketStatus(
  actor: AnyActor,
  ticketId: string,
  input: ChangeStatusInput,
  client: Tx | typeof prisma = prisma,
): Promise<Ticket> {
  assertPermission(actor, "tickets.manage");
  const parsed = changeStatusSchema.parse(input);

  const existing = await client.ticket.findUnique({ where: { id: ticketId } });
  if (!existing) {
    throw new Error(`Tiket dengan ID ${ticketId} tidak ditemukan`);
  }

  const now = new Date();
  const updateData: Prisma.TicketUpdateInput = {
    status: parsed.status,
  };

  if (parsed.status === "RESOLVED" && !existing.resolvedAt) {
    updateData.resolvedAt = now;
  }
  if (parsed.status === "CLOSED" && !existing.closedAt) {
    updateData.closedAt = now;
    if (!existing.resolvedAt) {
      updateData.resolvedAt = now;
    }
  }

  const actorUserId = actor.kind === "user" ? actor.userId : null;

  const ticket = await client.ticket.update({
    where: { id: ticketId },
    data: updateData,
  });

  await client.ticketEvent.create({
    data: {
      ticketId,
      type: "STATUS_CHANGED",
      fromValue: existing.status,
      toValue: parsed.status,
      actorUserId,
      note: parsed.note ?? `Status diubah dari ${existing.status} ke ${parsed.status}`,
    },
  });

  await recordAudit(
    actor,
    {
      action: "ticket.status_change",
      entityType: "Ticket",
      entityId: ticketId,
      metadata: { from: existing.status, to: parsed.status },
    },
    client,
  );

  return ticket;
}

export async function deleteTicket(
  actor: AnyActor,
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<{ id: string; number: string }> {
  assertPermission(actor, "tickets.manage");
  const ticket = await client.ticket.findUnique({
    where: { id },
    select: { id: true, number: true },
  });
  if (!ticket) {
    throw new Error(`Tiket dengan ID ${id} tidak ditemukan`);
  }

  await client.ticket.delete({ where: { id } });

  await recordAudit(
    actor,
    {
      action: "ticket.delete",
      entityType: "Ticket",
      entityId: id,
      metadata: { number: ticket.number },
    },
    client,
  );

  return ticket;
}
