import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Starlight Agent Launchpad",
    template: "%s · Starlight Agent Launchpad",
  },
  description:
    "An inspectable Vercel cockpit and Railway operator boundary for bounded agent workflows.",
  applicationName: "Starlight Agent Launchpad",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
