import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, readJson } from "@/lib/http";
import { addTicketComment, type AddCommentInput } from "@/lib/services/tickets";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const body = await readJson<AddCommentInput>(request);
    const comment = await addTicketComment(actor, id, body);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
