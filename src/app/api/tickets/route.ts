import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, parseQuery, readJson } from "@/lib/http";
import { listTickets, createTicket, type CreateTicketInput } from "@/lib/services/tickets";
import { z } from "zod";

const querySchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  customerId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const _actor = await requireActor();
    const query = parseQuery(request, querySchema);
    const tickets = await listTickets({
      status: query.status,
      priority: query.priority,
      customerId: query.customerId,
      assignedToId: query.assignedToId,
      search: query.search,
    });
    return NextResponse.json({ tickets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await readJson<CreateTicketInput>(request);
    const ticket = await createTicket(actor, body);
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
