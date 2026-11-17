import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/shell/service-worker";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: { default: "myWallet", template: "%s · myWallet" },
  description: "Suivi de dépenses, tickets et créances.",
  robots: { index: false, follow: false },
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "myWallet", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0C0D0F",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The private-mode script may set data-private on <html> before hydration.
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose: private mode must apply before the first paint (ADR-044). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/private-mode.js" />
      </head>
      <body className="min-h-full">
        {children}
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
