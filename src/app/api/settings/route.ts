import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { errorResponse, readJson } from "@/lib/http";
import { getAllSettings, saveSettings } from "@/lib/settings/service";
import type { SettingKey } from "@/lib/settings/registry";

export async function GET() {
  try {
    await requireActor("settings.manage");
    const settings = await getAllSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireActor("settings.manage");
    const body = await readJson<{ changes: { key: SettingKey; value: unknown }[] }>(request);
    await saveSettings(actor, body.changes);
    const settings = await getAllSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return errorResponse(error);
  }
}
