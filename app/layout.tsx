import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppServiceWorker } from "@/components/app-service-worker";
import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Notepad", template: "%s · Notepad" },
  description: "An invite-only notepad whose notes are Markdown files in your own GitHub repositories.",
  applicationName: "Notepad",
  // Drawn by scripts/generate-icons.mjs; the manifest's icons come from app/manifest.ts.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Installed on iOS, the status bar floats over the page, whose chrome pads itself clear (`pt-safe`).
  appleWebApp: { capable: true, title: "Notepad", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Paint under the notch and home indicator; chrome pads itself with the safe-area utilities.
  viewportFit: "cover",
  // The software keyboard shrinks the layout viewport (and `100dvh`) on Android as on iOS.
  interactiveWidget: "resizes-content",
  // Matches `--background` in globals.css, the color at the top of every screen.
  themeColor: "#191817",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("dark", GeistSans.variable, GeistMono.variable)}>
      <body className="font-sans antialiased">
        {children}
        <AppServiceWorker />
      </body>
    </html>
  );
}
