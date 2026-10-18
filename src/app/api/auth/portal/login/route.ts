import { NextResponse } from "next/server";
import { authenticatePortal, type LoginRequest } from "@/lib/auth/login";
import { errorResponse, readJson } from "@/lib/http";
import { requestContext } from "@/lib/auth/guard";

export async function POST(request: Request) {
  try {
    const body = await readJson<LoginRequest>(request);
    const ctx = await requestContext();
    const result = await authenticatePortal({
      email: body.email,
      password: body.password,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: "LOGIN_FAILED", retryAfterSec: result.retryAfterSec },
        { status: 401 }
      );
    }
    const res = NextResponse.json({ ok: true, customerName: result.customerName });
    res.cookies.set(result.cookie.name, result.cookie.value, {
      httpOnly: result.cookie.httpOnly,
      sameSite: result.cookie.sameSite,
      secure: result.cookie.secure,
      path: result.cookie.path,
      maxAge: result.cookie.maxAge,
    });
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
