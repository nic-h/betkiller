import type { Metadata } from "next";
import "../styles/globals.css";
import { Suspense } from "react";
import { TopNav } from "@/components/TopNav";
import { Providers } from "@/components/Providers";

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
            <header className="bk-sticky bk-top-0 bk-z-40 bk-bg-brand-bg/80 bk-backdrop-blur bk-border-b bk-border-brand-ring/60">
              <div className="bk-max-w-7xl bk-mx-auto bk-px-6">
                <Suspense fallback={<div className="bk-h-12" />}> 
                  <TopNav />
                </Suspense>
              </div>
            </header>
            <div className="bk-max-w-7xl bk-mx-auto bk-px-6 bk-py-8">
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
