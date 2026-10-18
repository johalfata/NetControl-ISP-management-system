import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse } from "@/lib/http";
import { pollRouter } from "@/lib/services/metrics";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const result = await pollRouter(actor, id);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
