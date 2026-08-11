import type { Metadata } from "next";
import { headers } from "next/headers";
import { PwaRegister } from "@/components/pwa-register";
import { KioskUuidShortcut } from "@/components/kiosk-uuid-shortcut";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: { default: "Snapore — Photobooth Operating System", template: "%s · Snapore" },
    description: "Offline-first photobooth control center untuk capture, compose, sync, dan print.",
    applicationName: "Snapore",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Snapore" },
    openGraph: {
      type: "website",
      title: "Snapore — Offline-first Photobooth OS",
      description: "Capture locally. Print reliably. Sync when ready.",
      images: [{ url: "/og.png", width: 1792, height: 896, alt: "Snapore offline-first photobooth operating system" }],
    },
    twitter: { card: "summary_large_image", images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body suppressHydrationWarning><PwaRegister />{children}<KioskUuidShortcut /></body>
    </html>
  );
}
