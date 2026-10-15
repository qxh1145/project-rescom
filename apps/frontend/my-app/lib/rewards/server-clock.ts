/**
 * Server clock and countdown helpers. Pure module.
 */

export function serverOffset(serverTimeIso: string, receivedAtMs = Date.now()): number {
  const serverMs = Date.parse(serverTimeIso);
  if (Number.isNaN(serverMs)) return 0;
  return serverMs - receivedAtMs;
}

export interface RemainingTime {
  totalSeconds: number;
  hh: string;
  mm: string;
  ss: string;
}

export function remaining(endsAtIso: string, nowMs = Date.now()): RemainingTime {
  const targetMs = Date.parse(endsAtIso);
  if (Number.isNaN(targetMs)) {
    return { totalSeconds: 0, hh: "00", mm: "00", ss: "00" };
  }
  // ceil: 0 only once the target has actually passed (never up to 999 ms early).
  const totalSeconds = Math.ceil(Math.max(0, targetMs - nowMs) / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    totalSeconds,
    hh: String(hours).padStart(2, "0"),
    mm: String(minutes).padStart(2, "0"),
    ss: String(seconds).padStart(2, "0"),
  };
}

export function countdownMinuteKey(totalSeconds: number): number {
  return Math.max(0, Math.ceil(totalSeconds / 60));
}

export function countdownAnnouncement(totalSeconds: number, kind: "ends" | "starts"): string {
  if (totalSeconds <= 0) {
    return kind === "ends" ? "Flash Sale đã kết thúc" : "Flash Sale đã bắt đầu";
  }

  // Same rounding as countdownMinuteKey, so the text only changes with the key.
  const totalMinutes = countdownMinuteKey(totalSeconds);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  let timeString = "";
  if (hours > 0 && minutes > 0) {
    timeString = `${hours} giờ ${minutes} phút`;
  } else if (hours > 0) {
    timeString = `${hours} giờ`;
  } else {
    timeString = `${minutes} phút`;
  }

  return kind === "ends"
    ? `Flash Sale kết thúc sau ${timeString}`
    : `Flash Sale bắt đầu sau ${timeString}`;
}
