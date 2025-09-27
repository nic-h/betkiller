const ALLOW = [/^\/api\/context/, /^https?:\/\/context\.markets/i];

export function wrapFetch() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if ((window as any).__fetchWrapped) return;
  const orig = window.fetch.bind(window);
  const guard: typeof window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;
    if (!ALLOW.some((rx) => rx.test(url))) {
      throw new Error("blocked non-context source");
    }
    return orig(input as any, init);
  };
  (window as any).__fetchWrapped = true;
  window.fetch = guard;
}
