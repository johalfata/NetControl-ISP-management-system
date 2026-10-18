import { NextResponse } from "next/server";
import { handleWebhook } from "@/lib/services/webhooks";
import { errorResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let payload: unknown = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { raw: rawBody };
    }
    const signatureHeader = request.headers.get("x-fonnte-signature") || request.headers.get("x-signature");
    const eventType = request.headers.get("x-event-type") || "whatsapp_callback";
    const replayKey = request.headers.get("x-replay-key") || `${Date.now()}-${Math.random()}`;

    const delivery = await handleWebhook({
      source: "fonnte",
      eventType,
      replayKey,
      signatureHeader,
      rawBody,
      payload,
    });

    return NextResponse.json({ success: true, deliveryId: delivery.id, status: delivery.status });
  } catch (error) {
    return errorResponse(error);
  }
}
