import type { Metadata } from "next";
import { BIZ_UDPMincho, BIZ_UDPGothic } from "next/font/google";
import { Footer } from "@/components/newspaper";
import "./globals.css";

const newspaper = BIZ_UDPMincho({ subsets: ["latin"], weight: ["700"], display: "swap", variable: "--font-newspaper" });
const body = BIZ_UDPGothic({ subsets: ["latin"], weight: ["400", "700"], display: "swap", variable: "--font-body" });
export const metadata: Metadata = {
  title: { default: "良良タイムズ｜小さな足跡を、ニュースに", template: "%s｜良良タイムズ" },
  description: "良良記者が毎月届ける、仲間の挑戦と支え合いの新聞。",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja" className={`${newspaper.variable} ${body.variable}`}><body><a className="skip-link" href="#main">本文へ移動</a><div className="paper">{children}<Footer/></div></body></html>;
}
