"use client";

import { useEffect } from "react";
import { wrapFetch } from "../src/debug/allowlistFetch";
import { installProbe } from "../src/debug/probe";

export function DebugProbe() {
  useEffect(() => {
    wrapFetch();
    installProbe();
  }, []);

  return null;
}
