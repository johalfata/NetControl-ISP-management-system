import { NextResponse } from "next/server";
import { clearCookie, PORTAL_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const cookie = clearCookie(PORTAL_COOKIE);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });
  return res;
}
