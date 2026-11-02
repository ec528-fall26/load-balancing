import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Load balancing simulator",
  description:
    "Explore how traffic and server capacity affect waiting, latency, and rejected requests.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
