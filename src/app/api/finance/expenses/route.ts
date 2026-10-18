import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, parseQuery, readJson } from "@/lib/http";
import { listExpenses, createExpense, type CreateExpenseInput } from "@/lib/services/finance";
import { z } from "zod";

const querySchema = z.object({
  categoryId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const query = parseQuery(request, querySchema);
    const result = await listExpenses(
      actor,
      {
        categoryId: query.categoryId,
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
    const body = await readJson<CreateExpenseInput>(request);
    const expense = await createExpense(actor, body);
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
