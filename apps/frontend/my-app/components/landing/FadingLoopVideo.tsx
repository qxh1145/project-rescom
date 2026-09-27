"use client";

import { useEffect, useRef } from "react";

const FADE_SECONDS = 0.5;
const RESTART_DELAY_MS = 100;

/**
 * Video that loops manually: fades in over the first 0.5s, fades out over the last 0.5s,
 * then restarts after a short pause so the loop seam is hidden.
 */
export function FadingLoopVideo({ src, className }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frame = 0;
    let restartTimer: number | undefined;

    // Opacity is written straight to the element so the 60fps updates skip React renders.
    const tick = () => {
      const { currentTime, duration } = video;
      if (duration > 0) {
        const remaining = duration - currentTime;
        let opacity = 1;
        if (currentTime < FADE_SECONDS) opacity = currentTime / FADE_SECONDS;
        else if (remaining < FADE_SECONDS) opacity = remaining / FADE_SECONDS;
        video.style.opacity = String(Math.min(1, Math.max(0, opacity)));
      }
      frame = requestAnimationFrame(tick);
    };

    const onEnded = () => {
      video.style.opacity = "0";
      restartTimer = window.setTimeout(() => {
        video.currentTime = 0;
        void video.play().catch(() => {});
      }, RESTART_DELAY_MS);
    };

    video.addEventListener("ended", onEnded);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(restartTimer);
      video.removeEventListener("ended", onEnded);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      muted
      playsInline
      preload="auto"
      className={className}
      style={{ opacity: 0 }}
    />
  );
}
