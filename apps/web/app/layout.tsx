import type { Metadata } from "next";
import "../styles/globals.css";
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
          <div id="bk-root" className="bk-min-h-screen bk-py-8">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
