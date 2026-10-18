import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse } from "@/lib/http";
import { generateInvoicesForPeriod } from "@/lib/services/billing";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params: _params }: RouteParams) {
  try {
    const actor = await requireActor();
    const body = (await request.json().catch(() => ({}))) as {
      targetDate?: string;
      dryRun?: boolean;
    };

    const targetDate = body.targetDate ? new Date(body.targetDate) : new Date();
    const result = await generateInvoicesForPeriod(actor, {
      targetDate,
      dryRun: body.dryRun ?? false,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
