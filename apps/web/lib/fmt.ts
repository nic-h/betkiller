export function formatMoney(value: number, precision = 2): string {
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
  return `$${formatted}`;
}

export function formatNumber(value: number, precision = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
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
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
