import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { MswProvider } from "@/components/providers/MswProvider";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-be-vietnam-pro",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RESCOM — Nền Tảng Trao Đổi Khảo Sát Học Thuật",
  description:
    "Nền tảng hai chiều kết nối sinh viên trao đổi khảo sát nghiên cứu học thuật dựa trên cơ chế điểm thưởng và cộng đồng tương trợ.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <MswProvider>{children}</MswProvider>
      </body>
    </html>
  );
}
