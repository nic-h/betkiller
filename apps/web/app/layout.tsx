import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Context Edge",
  description: "On-chain dashboard for Context Markets"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div id="bk-root" className="bk-min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
