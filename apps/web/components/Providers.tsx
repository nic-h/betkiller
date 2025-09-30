import type { ReactNode } from "react";

import { DensityProvider } from "@/components/DensityProvider";
import { RangeProvider } from "@/components/RangeProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RangeProvider>
      <DensityProvider>{children}</DensityProvider>
    </RangeProvider>
  );
}
