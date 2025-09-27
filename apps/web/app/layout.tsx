import type { Metadata } from "next";
import "../styles/globals.css";
import { DebugProbe } from "../components/DebugProbe";

export const metadata: Metadata = {
  title: "Betkiller Dash",
  description: "On-chain dashboard for Context Markets"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DebugProbe />
        <div id="bk-root" className="bk-min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
