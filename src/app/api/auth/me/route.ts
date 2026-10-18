import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth/guard";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const actor = await currentActor();
    if (!actor) {
      return NextResponse.json({ error: "Belum login", code: "UNAUTHENTICATED" }, { status: 401 });
    }
    return NextResponse.json({ user: actor });
  } catch (error) {
    return errorResponse(error);
  }
}
