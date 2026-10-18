import { redact, redactPhone } from "../crypto";

export type FonnteSendOptions = {
  token: string;
  target: string;
  message: string;
  countryCode?: string;
};

export type FonnteResponse = {
  status: boolean;
  reason?: string;
  detail?: unknown;
};

const FONNTE_API_URL = "https://api.fonnte.com/send";
const FONNTE_DEVICE_URL = "https://api.fonnte.com/device";

export async function sendWhatsAppMessage(options: FonnteSendOptions): Promise<FonnteResponse> {
  const { token, target, message } = options;
  const normalizedTarget = normalizePhoneNumber(target);

  const formData = new URLSearchParams();
  formData.append("target", normalizedTarget);
  formData.append("message", message);
  if (options.countryCode) {
    formData.append("countryCode", options.countryCode);
  }

  try {
    const res = await fetch(FONNTE_API_URL, {
      method: "POST",
      headers: {
        Authorization: token,
      },
      body: formData,
    });

    const data = (await res.json().catch(() => ({ status: false, reason: "Invalid JSON response from Fonnte" }))) as FonnteResponse;

    if (!res.ok || !data.status) {
      console.error("[fonnte] Gagal mengirim WhatsApp:", redact({ target: redactPhone(normalizedTarget), reason: data.reason }));
    }

    return {
      status: Boolean(data.status),
      reason: data.reason,
      detail: redact(data),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[fonnte] Kesalahan jaringan/HTTP:", redact({ target: redactPhone(normalizedTarget), error: errorMessage }));
    return {
      status: false,
      reason: errorMessage,
    };
  }
}

export async function testConnection(token: string): Promise<{ success: boolean; message: string; detail?: unknown }> {
  try {
    const res = await fetch(FONNTE_DEVICE_URL, {
      method: "POST",
      headers: {
        Authorization: token,
      },
    });

    const data = (await res.json().catch(() => ({ status: false, reason: "Invalid JSON response" }))) as FonnteResponse;
    const success = Boolean(res.ok && data.status);

    return {
      success,
      message: success ? "Koneksi Fonnte berhasil" : (data.reason ?? "Koneksi Fonnte gagal"),
      detail: redact(data),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    return "62" + digits.slice(1);
  }
  if (digits.startsWith("8")) {
    return "62" + digits;
  }
  if (digits.startsWith("62")) {
    return digits;
  }
  return digits;
}
