/**
 * Utilitas waktu. Semua nilai disimpan UTC; perhitungan "tanggal bisnis"
 * (tanggal tagih, periode invoice, batas hari) dilakukan pada zona waktu
 * bisnis yang dikonfigurasi agar perilaku konsisten di server mana pun.
 */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMsAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/**
 * Konversi komponen waktu lokal zona `timeZone` menjadi instant UTC.
 * Menangani DST dengan dua iterasi koreksi offset ( cukup untuk zona IANA umum).
 */
export function zonedToUtc(
  timeZone: string,
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let instant = new Date(guess - offsetMsAt(new Date(guess), timeZone));
  instant = new Date(guess - offsetMsAt(instant, timeZone));
  return instant;
}

/** Awal hari (00:00) pada zona bisnis, dikembalikan sebagai instant UTC. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  return zonedToUtc(timeZone, { year: p.year, month: p.month, day: p.day });
}

export function endOfZonedDay(instant: Date, timeZone: string): Date {
  const start = startOfZonedDay(instant, timeZone);
  return new Date(start.getTime() + 24 * 3600 * 1000 - 1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Tambah bulan kalender pada komponen tanggal, dengan clamp ke akhir bulan. */
export function addMonthsToParts(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const totalMonths = (year * 12 + (month - 1)) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  const clamped = Math.min(day, daysInMonth(nextYear, nextMonth));
  return { year: nextYear, month: nextMonth, day: clamped };
}

export function addMonthsZoned(instant: Date, timeZone: string, delta: number): Date {
  const p = zonedParts(instant, timeZone);
  const next = addMonthsToParts(p.year, p.month, p.day, delta);
  return zonedToUtc(timeZone, { ...next, hour: p.hour, minute: p.minute, second: p.second });
}

export function addDaysZoned(instant: Date, timeZone: string, days: number): Date {
  const p = zonedParts(instant, timeZone);
  const base = Date.UTC(p.year, p.month - 1, p.day + days);
  const shifted = new Date(base);
  return zonedToUtc(timeZone, {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export type DayBoundary = { start: Date; end: Date };

/** Rentang [start, end) untuk sebuah hari menurut zona bisnis. */
export function zonedDayBounds(instant: Date, timeZone: string): DayBoundary {
  const start = startOfZonedDay(instant, timeZone);
  return { start, end: addDaysZoned(start, timeZone, 1) };
}

/** Rentang [start, end) untuk bulan kalender pada zona bisnis. */
export function zonedMonthBounds(instant: Date, timeZone: string): DayBoundary {
  const p = zonedParts(instant, timeZone);
  const start = zonedToUtc(timeZone, { year: p.year, month: p.month, day: 1 });
  const next = addMonthsToParts(p.year, p.month, 1, 1);
  const end = zonedToUtc(timeZone, { year: next.year, month: next.month, day: 1 });
  return { start, end };
}

/** Kunci periode `YYYY-MM` menurut zona bisnis (dipakai idempotensi invoice). */
export function zonedPeriodKey(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Awal hari bisnis ke-`day` pada bulan berjalan/bulan berikutnya. */
export function zonedBillingDate(
  timeZone: string,
  reference: Date,
  billingDay: number,
  monthOffset = 0,
): Date {
  const p = zonedParts(reference, timeZone);
  const target = addMonthsToParts(p.year, p.month, Math.min(billingDay, 28), monthOffset);
  return zonedToUtc(timeZone, target);
}

export function zonedDayDifference(later: Date, earlier: Date, timeZone: string): number {
  const a = startOfZonedDay(later, timeZone).getTime();
  const b = startOfZonedDay(earlier, timeZone).getTime();
  return Math.round((a - b) / (24 * 3600 * 1000));
}

export function formatZonedDate(
  instant: Date,
  timeZone: string,
  locale: string,
  pattern: string,
): string {
  const p = zonedParts(instant, timeZone);
  const monthShort = new Intl.DateTimeFormat(locale, { timeZone, month: "short" }).format(instant);
  const monthLong = new Intl.DateTimeFormat(locale, { timeZone, month: "long" }).format(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    yyyy: String(p.year),
    yy: String(p.year).slice(-2),
    MM: pad(p.month),
    M: String(p.month),
    dd: pad(p.day),
    d: String(p.day),
    MMM: monthShort,
    MMMM: monthLong,
    HH: pad(p.hour),
    mm: pad(p.minute),
    ss: pad(p.second),
  };
  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|mm|ss/g, (token) => map[token] ?? token);
}

export function formatZonedDateTime(
  instant: Date,
  timeZone: string,
  locale: string,
  pattern: string,
): string {
  return formatZonedDate(instant, timeZone, locale, `${pattern} HH:mm`);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}