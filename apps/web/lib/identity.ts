export function shortenAddress(address: string | null | undefined): string {
  if (!address) return "-";
  const trimmed = address.trim();
  if (trimmed.length <= 10) return trimmed.toLowerCase();
  const lower = trimmed.toLowerCase();
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`;
}

type IdentityInput = {
  address?: string | null;
  username?: string | null;
  displayName?: string | null;
  xHandle?: string | null;
  ens?: string | null;
};

function sanitize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatHandle(value: string): string {
  const normalized = value.startsWith("@") ? value.slice(1) : value;
  return `@${normalized}`;
}

export function resolveIdentity(input: IdentityInput): string {
  const address = sanitize(input.address);
  const username = sanitize(input.username) ?? sanitize(input.displayName);
  const handle = sanitize(input.xHandle);
  const ens = sanitize(input.ens);

  if (username) return username;
  if (handle) return formatHandle(handle);
  if (ens) return ens.toLowerCase();
  return shortenAddress(address);
}
