import bcrypt from "bcryptjs";
import { ValidationError } from "../permissions";

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

const COMMON_WEAK = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "admin123",
  "administrator",
  "netcontrol",
  "letmein123",
]);

/** Kebijakan password; panjang minimum dari setelan keamanan. */
export function assertPasswordPolicy(password: string, minLength: number): void {
  if (password.length < minLength) {
    throw new ValidationError(`Password minimal ${minLength} karakter`);
  }
  if (password.length > 72) {
    throw new ValidationError("Password maksimal 72 karakter");
  }
  const lower = password.toLowerCase();
  if (COMMON_WEAK.has(lower)) {
    throw new ValidationError("Password terlalu umum; gunakan kombinasi yang lebih kuat");
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password));
  if (classes.length < 3) {
    throw new ValidationError(
      "Password harus memuat minimal 3 jenis karakter (huruf kecil, huruf besar, angka, simbol)",
    );
  }
}

/** Password acak untuk akun yang dibuatkan admin (wajib ganti saat login pertama). */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const symbols = "!@#$%^&*-_=+";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  out += symbols[bytes[12]! % symbols.length];
  out += String(bytes[13]! % 10);
  out += String(bytes[14]! % 10);
  return out;
}