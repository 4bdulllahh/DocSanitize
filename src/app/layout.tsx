import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { siteConfig } from "@/config/site";
import { LOCALE_INIT_SCRIPT } from "@/i18n/locales";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// next/font downloads and self-hosts these at build time — no runtime request to Google.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Arabic letters (Geist has none). Its unicode-range means it's only downloaded when Arabic is shown.
const notoArabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  appleWebApp: { title: siteConfig.name, statusBarStyle: "default" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: siteConfig.name,
    title: `${siteConfig.name}: ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  twitter: { card: "summary" },
};

// Matches the header (--surface) in each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffcf2" },
    { media: "(prefers-color-scheme: dark)", color: "#2b2927" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT and LOCALE_INIT_SCRIPT set data-theme, lang and dir
    // on <html> before React hydrates.
    <html lang="en" dir="ltr" className={`${geistSans.variable} ${geistMono.variable} ${notoArabic.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
