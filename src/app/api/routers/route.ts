import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, readJson } from "@/lib/http";
import { listRouters, createRouter, type CreateRouterInput } from "@/lib/services/routers";

export async function GET() {
  try {
    const _actor = await requireActor();
    const routers = await listRouters();
    return NextResponse.json({ routers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await readJson<CreateRouterInput>(request);
    const router = await createRouter(actor, body);
    return NextResponse.json({ router }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
