import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
      <body className="min-h-full">
        {children}
        <Toaster />
        <Script src="/private-mode.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
