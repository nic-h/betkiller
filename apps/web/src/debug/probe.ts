export function installProbe() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if ((window as any).__probeInstalled) return;
  (window as any).__probeInstalled = true;

  const trace: any[] = [];
  (window as any).__trace = trace;
  const orig = window.fetch.bind(window);

  const wrapped: typeof window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;
    const started = performance.now();
    const response = await orig(input, init);
    let size = 0;
    try {
      size = (await response.clone().arrayBuffer()).byteLength;
    } catch (error) {
      size = 0;
    }
    const entry = {
      t: Date.now(),
      url,
      ms: Math.round(performance.now() - started),
      size,
      status: response.status
    };
    trace.push(entry);
    window.dispatchEvent(new CustomEvent("probe", { detail: entry }));
    return response;
  };

  window.fetch = wrapped;

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    right: "8px",
    bottom: "8px",
    zIndex: "999999",
    background: "rgba(0, 0, 0, 0.8)",
    color: "#9f9",
    padding: "6px 8px",
    font: "12px Menlo, monospace",
    border: "1px solid #0f0",
  });
  box.textContent = "net 0 | ok";
  document.body.appendChild(box);

  let count = 0;
  let lastLen = -1;
  let stale = 0;

  window.addEventListener("probe", async () => {
    count += 1;
    const meta = await fetch("/api/context/meta").catch(() => null);
    let len = -1;
    if (meta) {
      try {
        const payload = await meta.json();
        len = typeof payload.count === "number" ? payload.count : -1;
      } catch (error) {
        len = -1;
      }
    }
    stale = len === lastLen ? stale + 1 : 0;
    lastLen = len;
    box.textContent = `net ${count} | ${stale >= 6 ? "STALE" : "ok"} | len ${len}`;
    box.style.color = stale >= 6 ? "#f99" : "#9f9";
    box.style.borderColor = stale >= 6 ? "#f00" : "#0f0";
  });
}
