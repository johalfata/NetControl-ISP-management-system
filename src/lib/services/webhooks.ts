import { prisma, type Tx } from "../db";
import { hmacSha256Hex, timingSafeEqualHex } from "../crypto";
import { WebhookStatus, type WebhookDelivery } from "@prisma/client";

export type HandleWebhookInput = {
  source: string;
  eventType: string;
  replayKey: string;
  signatureHeader?: string | null;
  rawBody: string;
  payload: unknown;
  secret?: string;
};

export function verifyWebhookSignature(signatureHeader: string | undefined | null, rawBody: string, secret: string): boolean {
  if (!signatureHeader) return false;
  // Support formats like "sha256=hex" or raw hex
  const cleanSig = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const expectedSig = hmacSha256Hex(secret, rawBody);
  return timingSafeEqualHex(cleanSig, expectedSig);
}

export async function handleWebhook(
  input: HandleWebhookInput,
  client: Tx | typeof prisma = prisma,
): Promise<WebhookDelivery> {
  const existing = await client.webhookDelivery.findUnique({
    where: { replayKey: input.replayKey },
  });
  if (existing) {
    return existing;
  }

  let signatureValid = true;
  if (input.secret) {
    signatureValid = verifyWebhookSignature(input.signatureHeader, input.rawBody, input.secret);
  }

  const status = signatureValid ? WebhookStatus.RECEIVED : WebhookStatus.REJECTED;
  const error = signatureValid ? null : "Invalid webhook signature";

  const delivery = await client.webhookDelivery.create({
    data: {
      source: input.source,
      eventType: input.eventType,
      replayKey: input.replayKey,
      signatureValid,
      status,
      payload: input.payload ? JSON.parse(JSON.stringify(input.payload)) : undefined,
      error,
    },
  });

  if (signatureValid) {
    // Process webhook event dispatch asynchronously or synchronously
    try {
      await dispatchWebhookEvent(delivery, client);
      await client.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookStatus.PROCESSED,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await client.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookStatus.FAILED,
          error: errorMessage,
        },
      });
    }
  }

  const finalDelivery = await client.webhookDelivery.findUnique({
    where: { id: delivery.id },
  });

  if (!finalDelivery) {
    throw new Error(`Webhook delivery ${delivery.id} not found after processing`);
  }

  return finalDelivery;
}

async function dispatchWebhookEvent(delivery: WebhookDelivery, _client: Tx | typeof prisma): Promise<void> {
  // Dispatch based on source and eventType
  if (delivery.source === "n8n" || delivery.source === "fonnte") {
    // Handle specific webhook events if needed
  }
}
