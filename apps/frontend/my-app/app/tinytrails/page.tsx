import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TinyTrailsLanding } from "@/components/landing/TinyTrailsLanding";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "404 - Page Not Found",
};

/** Full-screen TinyTrails 404 page. */
export default function TinyTrailsPage() {
  return <TinyTrailsLanding fontClassName={inter.className} />;
}
