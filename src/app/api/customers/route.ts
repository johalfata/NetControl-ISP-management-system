import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, parseQuery, readJson } from "@/lib/http";
import { createCustomer, listCustomers, type CreateCustomerInput } from "@/lib/services/customers";
import { z } from "zod";

const querySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  planId: z.string().optional(),
  routerId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const query = parseQuery(request, querySchema);
    const result = await listCustomers(
      actor,
      {
        search: query.search,
        status: query.status,
        planId: query.planId,
        routerId: query.routerId,
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
    const body = await readJson<CreateCustomerInput>(request);
    const customer = await createCustomer(actor, body);
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
