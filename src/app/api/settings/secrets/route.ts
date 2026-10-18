import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, readJson } from "@/lib/http";
import { listSecretStatus, setSecret, deleteSecret } from "@/lib/secrets";
import type { SecretSettingKey } from "@/lib/settings/registry";

export async function GET() {
  try {
    await requireActor("settings.manage");
    const secrets = await listSecretStatus();
    return NextResponse.json({ secrets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor("settings.manage");
    const body = await readJson<{ key: SecretSettingKey; value: string }>(request);
    await setSecret(actor, body.key, body.value);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireActor("settings.manage");
    const url = new URL(request.url);
    const key = url.searchParams.get("key") as SecretSettingKey;
    if (!key) {
      return NextResponse.json({ error: "Key wajib diisi", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    await deleteSecret(actor, key);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
