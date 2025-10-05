export type ProfileSnapshot = {
  displayName?: string | null;
  xHandle?: string | null;
};

export const shortAddr = (address?: string | null): string => {
  if (!address) return "";
  const trimmed = address.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
};

export const resolveName = (profile?: ProfileSnapshot | null, address?: string | null): string => {
  if (profile?.displayName) return profile.displayName;
  if (profile?.xHandle) {
    const handle = profile.xHandle.replace(/^@+/, "");
    return `@${handle}`;
  }
  return shortAddr(address);
};
