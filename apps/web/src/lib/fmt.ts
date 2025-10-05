const LOCALE = "en-AU";
const TIME_ZONE = "Australia/Melbourne";

export function formatMoney(value: number, precision = 2): string {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  }).format(value);
  return `$${formatted}`;
}

export function formatNumber(value: number, precision = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  }).format(value);
}

export function formatHoursUntil(timestamp: number): string {
  const diffMs = timestamp * 1000 - Date.now();
  const hours = Math.max(0, Math.floor(diffMs / 3_600_000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `T-${days}d`;
  }
  return `T-${hours}h`;
}

export function formatDateShort(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = lookup.day ?? "";
  const month = lookup.month ?? "";
  let hour = lookup.hour ?? "";
  const minute = lookup.minute ?? "";
  if (hour === "24") {
    hour = "00";
  }
  return `${day} ${month}, ${hour}:${minute}`.trim();
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE
  }).format(date);
}
