import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { AetheraHero } from "@/components/landing/AetheraHero";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

const fraunces = Fraunces({
  style: ["normal", "italic"],
  subsets: ["latin", "vietnamese"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rescom — Từ câu hỏi, đến những góc nhìn lớn hơn.",
};

export default function Home() {
  return <AetheraHero fontClassName={`${inter.className} ${fraunces.variable}`} />;
}
