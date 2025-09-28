import type { Metadata } from "next";
import "../styles/globals.css";
import { TopNav } from "@/components/TopNav";
import { Providers } from "@/components/Providers";
import { getSavedViews } from "@/lib/db";

export const metadata: Metadata = {
  title: "Betkiller Dash",
  description: "On-chain dashboard for Context Markets"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const savedViews = getSavedViews();
  return (
    <html lang="en">
      <body className="bg-bg text-text font-sans">
        <Providers>
          <div id="bk-root" className="bk-min-h-screen">
            <header className="bk-sticky bk-top-0 bk-z-40 bk-bg-brand-bg/80 bk-backdrop-blur bk-border-b bk-border-brand-ring/60">
              <div className="bk-max-w-7xl bk-mx-auto bk-px-6">
                <TopNav initialSavedViews={savedViews} />
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
