import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, parseQuery, readJson } from "@/lib/http";
import { listPayments, recordPayment, type CreatePaymentInput } from "@/lib/services/payments";
import { z } from "zod";

const querySchema = z.object({
  customerId: z.string().optional(),
  methodId: z.string().optional(),
  status: z.enum(["POSTED", "VOID"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const query = parseQuery(request, querySchema);
    const result = await listPayments(
      actor,
      {
        customerId: query.customerId,
        methodId: query.methodId,
        status: query.status,
        search: query.search,
      },
      {
        page: query.page ?? 1,
        pageSize: query.limit ?? 50,
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await readJson<CreatePaymentInput>(request);
    const payment = await recordPayment(actor, body);
    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
