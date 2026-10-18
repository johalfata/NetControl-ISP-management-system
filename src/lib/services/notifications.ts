import { prisma, type Tx } from "../db";

import { requireSecret } from "../secrets";
import { sendWhatsAppMessage, normalizePhoneNumber } from "../integrations/fonnte";
import { NotificationChannel, NotificationStatus, type NotificationMessage } from "@prisma/client";

export type QueueNotificationInput = {
  templateCode: string;
  to: string;
  customerId?: string;
  invoiceId?: string;
  ticketId?: string;
  variables: Record<string, string>;
  idempotencyKey: string;
};

export async function queueNotification(
  input: QueueNotificationInput,
  client: Tx | typeof prisma = prisma,
): Promise<NotificationMessage> {
  const existing = await client.notificationMessage.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return existing;
  }

  const template = await client.notificationTemplate.findUnique({
    where: { code: input.templateCode },
  });
  if (!template || !template.isActive) {
    throw new Error(`Template notifikasi dengan kode ${input.templateCode} tidak ditemukan atau nonaktif`);
  }

  let body = template.bodyTemplate;
  for (const [key, val] of Object.entries(input.variables)) {
    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
  }

  const normalizedTo = normalizePhoneNumber(input.to);

  const message = await client.notificationMessage.create({
    data: {
      channel: NotificationChannel.WHATSAPP,
      templateCode: input.templateCode,
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      ticketId: input.ticketId,
      toAddress: normalizedTo,
      body,
      status: NotificationStatus.QUEUED,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: 3,
    },
  });

  return message;
}

export async function processNotificationQueue(
  limit = 20,
  client: Tx | typeof prisma = prisma,
): Promise<{ processed: number; success: number; failed: number }> {
  const token = await getFonnteTokenSafe(client);
  if (!token) {
    return { processed: 0, success: 0, failed: 0 };
  }

  const now = new Date();
  const messages = await client.notificationMessage.findMany({
    where: {
      OR: [
        { status: NotificationStatus.QUEUED },
        {
          status: NotificationStatus.FAILED,
          attempts: { lt: 3 },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
      ],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let successCount = 0;
  let failCount = 0;

  for (const msg of messages) {
    const attemptNo = msg.attempts + 1;
    const res = await sendWhatsAppMessage({
      token,
      target: msg.toAddress,
      message: msg.body,
    });

    const newStatus = res.status ? NotificationStatus.SENT : NotificationStatus.FAILED;
    const nextAttemptAt = res.status ? null : new Date(Date.now() + attemptNo * 5 * 60 * 1000); // Exponential backoff

    await client.notificationMessage.update({
      where: { id: msg.id },
      data: {
        status: newStatus,
        attempts: attemptNo,
        lastError: res.reason ?? null,
        sentAt: res.status ? new Date() : msg.sentAt,
        failedAt: res.status ? null : new Date(),
        nextAttemptAt,
      },
    });

    await client.notificationAttempt.create({
      data: {
        messageId: msg.id,
        attemptNo,
        status: newStatus,
        responseRedacted: JSON.stringify(res.detail ?? {}),
        error: res.reason ?? null,
      },
    });

    if (res.status) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  return {
    processed: messages.length,
    success: successCount,
    failed: failCount,
  };
}

export async function retryFailedNotifications(
  client: Tx | typeof prisma = prisma,
): Promise<{ retried: number }> {
  const result = await client.notificationMessage.updateMany({
    where: {
      status: NotificationStatus.FAILED,
      attempts: { lt: 3 },
    },
    data: {
      status: NotificationStatus.QUEUED,
      nextAttemptAt: null,
    },
  });

  return { retried: result.count };
}

async function getFonnteTokenSafe(client: Tx | typeof prisma): Promise<string | null> {
  try {
    return await requireSecret("integrations.fonnte.token", client);
  } catch {
    return null;
  }
}
