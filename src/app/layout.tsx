import type { Metadata } from "next";
import { Noto_Serif_JP } from "next/font/google";
import { Footer } from "@/components/newspaper";
import "./globals.css";

const newspaper = Noto_Serif_JP({ subsets: ["latin"], weight: ["400", "600", "700", "900"], display: "swap", variable: "--font-newspaper" });
export const metadata: Metadata = {
  title: { default: "良良タイムズ｜小さな足跡を、ニュースに", template: "%s｜良良タイムズ" },
  description: "良良記者が毎月届ける、仲間の挑戦と支え合いの新聞。",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja" className={newspaper.variable}><body><a className="skip-link" href="#main">本文へ移動</a><div className="paper">{children}<Footer/></div></body></html>;
}
