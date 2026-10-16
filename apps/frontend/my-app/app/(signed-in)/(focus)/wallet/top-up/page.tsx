import type { Metadata } from "next";
import { TopUpEntry } from "./components/TopUpEntry";

export const metadata: Metadata = {
  title: "Nạp điểm | Rescom",
};

export default function TopUpPage() {
  return <TopUpEntry />;
}
