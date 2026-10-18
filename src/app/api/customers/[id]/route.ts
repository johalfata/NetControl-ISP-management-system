import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, readJson } from "@/lib/http";
import { getCustomer, updateCustomer, archiveCustomer, type UpdateCustomerInput } from "@/lib/services/customers";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const customer = await getCustomer(actor, id);
    return NextResponse.json({ customer });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const body = await readJson<UpdateCustomerInput>(request);
    const customer = await updateCustomer(actor, id, body);
    return NextResponse.json({ customer });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const customer = await archiveCustomer(actor, id);
    return NextResponse.json({ customer, message: "Pelanggan diarsipkan" });
  } catch (error) {
    return errorResponse(error);
  }
}
