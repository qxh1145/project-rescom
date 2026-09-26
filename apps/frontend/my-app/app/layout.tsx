import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
