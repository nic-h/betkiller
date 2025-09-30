import type { Metadata } from "next";
import "../styles/globals.css";
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "context.dash",
  description: "Live edge finder across Context Markets"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bk-bg-bg bk-text-text bk-font-sans">
        <Providers>
          <div id="bk-root" className="bk-min-h-screen">
            <Suspense fallback={<div className="bk-h-24" />}>
              <AppHeader />
            </Suspense>
            <div className="bk-max-w-7xl bk-mx-auto bk-px-6 bk-py-8">
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
