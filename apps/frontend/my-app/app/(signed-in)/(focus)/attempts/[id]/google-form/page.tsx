import type { Metadata } from "next";
import { GoogleFormAttempt } from "./components/GoogleFormAttempt";

export const metadata: Metadata = {
  title: "Khảo sát Google Forms — Rescom",
};

/**
 * Figma page 5 (55:7) "Google Forms + mã hoàn thành". Reached from the
 * marketplace after `POST /surveys/:id/attempts` for an EXTERNAL survey.
 */
export default async function GoogleFormAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `key`: a different attempt starts from a fresh draft/countdown.
  return <GoogleFormAttempt key={id} attemptId={id} />;
}
