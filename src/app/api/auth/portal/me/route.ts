import { NextResponse } from "next/server";
import { currentPortalActor } from "@/lib/auth/guard";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const portalUser = await currentPortalActor();
    if (!portalUser) {
      return NextResponse.json({ error: "Sesi portal tidak valid", code: "UNAUTHENTICATED" }, { status: 401 });
    }
    return NextResponse.json({ portalUser });
  } catch (error) {
    return errorResponse(error);
  }
}
