"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Menu, X } from "lucide-react";
import { PAPER_TEXTURE } from "./paper-texture";

const NAV_ITEMS = ["About Us", "Programs", "Reviews", "FAQ", "Contacts"];

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260713_234424_b1332b69-2e69-4302-8dbc-40f86846afbd.mp4";

const BACKGROUND_MASK = "linear-gradient(to bottom, black 45%, rgba(0,0,0,0.35) 100%)";

function Logo() {
  return (
    <div className="flex items-center gap-1">
      <div className="grid grid-cols-2 gap-0.5">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-white rounded-full" />
        ))}
      </div>
      <span className="text-white font-bold text-lg sm:text-xl ml-1">TinyTrails</span>
    </div>
  );
}

export function TinyTrailsLanding({ fontClassName }: { fontClassName?: string }) {
  const textRef = useRef<HTMLDivElement>(null);
  const [scaleY, setScaleY] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);

  // Stretch the "404" so it fills the viewport height; offsetHeight ignores transforms, so no feedback loop.
  useEffect(() => {
    function measure() {
      const height = textRef.current?.offsetHeight;
      if (height) setScaleY(window.innerHeight / height);
    }
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      className={`${fontClassName ?? ""} relative w-full h-screen overflow-hidden flex flex-col antialiased`}
      style={{ background: "linear-gradient(to bottom, #F7901E, #FBA743)" }}
    >
      {/* Background "404" + oval */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ opacity: 0.24, maskImage: BACKGROUND_MASK, WebkitMaskImage: BACKGROUND_MASK }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={textRef}
            className="font-black leading-none tracking-tighter whitespace-nowrap"
            style={{
              color: "#FFFFFF",
              fontSize: "clamp(200px, 48vw, 800px)",
              transform: `scale(1.15, ${scaleY * 1.4})`,
            }}
          >
            404
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="rounded-full h-[22vh] sm:h-[26vh] md:h-[50vh]"
            style={{
              backgroundColor: "#FFFFFF",
              width: "clamp(120px, 20vw, 400px)",
              transform: `scaleY(${scaleY})`,
              transformOrigin: "center",
            }}
          />
        </div>
      </div>

      {/* Paper grain */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay"
        style={{ backgroundImage: PAPER_TEXTURE, opacity: 0.2 }}
        aria-hidden="true"
      />

      {/* Sparkle */}
      <svg
        className="absolute z-10 pointer-events-none animate-pulse"
        style={{ left: "67%", top: "29%", width: "clamp(24px, 3.4vw, 56px)", height: "clamp(32px, 4.6vw, 76px)" }}
        viewBox="0 0 24 32"
        fill="#FFFFFF"
        aria-hidden="true"
      >
        <path d="M12 0C12.7 10 14.6 14.8 24 16 14.6 17.2 12.7 22 12 32 11.3 22 9.4 17.2 0 16 9.4 14.8 11.3 10 12 0Z" />
      </svg>

      {/* Navigation */}
      <nav className="relative z-20 flex flex-row items-center justify-between px-4 sm:px-6 md:px-12 py-4 sm:py-5">
        <Logo />
        <div className="hidden md:flex gap-1">
          {NAV_ITEMS.map((item) => (
            <a
              key={item}
              href="#"
              className="px-4 py-1.5 text-sm font-medium rounded-full bg-white hover:opacity-90 transition-colors"
              style={{ color: "#F16524" }}
            >
              {item}
            </a>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-controls="tinytrails-menu"
          className="flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-white hover:opacity-90 transition-colors"
          style={{ backgroundColor: "#F16524" }}
        >
          <Menu className="w-4 h-4" />
          <span className="text-sm font-medium hidden sm:inline">Menu</span>
        </button>
      </nav>

      {/* Menu overlay */}
      <div
        id="tinytrails-menu"
        className={`fixed inset-0 z-50 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          menuOpen ? "visible" : "invisible"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!menuOpen}
      >
        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-500 ${
            menuOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setMenuOpen(false)}
        />
        <div
          className={`absolute top-0 right-0 h-full w-full sm:w-[380px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            menuOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{ background: "linear-gradient(135deg, #FF6B1A 0%, #FF9642 100%)" }}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <Logo />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="w-10 h-10 rounded-full bg-white/20 text-white hover:bg-white/30 flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col gap-3 px-6 pt-4">
            {NAV_ITEMS.map((item, i) => (
              <a
                key={item}
                href="#"
                onClick={() => setMenuOpen(false)}
                className={`px-6 py-4 text-lg font-semibold text-white rounded-2xl bg-white/10 hover:bg-white/20 transition-all duration-300 ${
                  menuOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
                style={{ transitionDelay: menuOpen ? `${150 + i * 60}ms` : "0ms" }}
              >
                {item}
              </a>
            ))}
          </div>

          <div
            className={`absolute bottom-0 left-0 right-0 p-6 transition-opacity duration-500 ${
              menuOpen ? "opacity-100" : "opacity-0"
            }`}
            style={{ transitionDelay: menuOpen ? "450ms" : "0ms" }}
          >
            <Link
              href="/"
              target="_top"
              onClick={() => setMenuOpen(false)}
              className="w-full py-4 rounded-full bg-white font-semibold text-base flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform"
              style={{ color: "#F16524" }}
            >
              <ArrowLeft className="w-5 h-5" />
              Go back home
            </Link>
          </div>
        </div>
      </div>

      {/* Center video */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ marginTop: "calc(-6vh - 40px)" }}
      >
        <div className="w-[120vw] h-[85vh] sm:w-[70vw] sm:h-[70vh] md:w-[62vw] md:h-[78vh]">
          <video
            src={VIDEO_SRC}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-contain pointer-events-none mix-blend-darken"
          />
        </div>
      </div>

      {/* Bottom content */}
      <div className="relative z-30 mt-auto pb-8 sm:pb-16 flex flex-col items-center text-center px-4">
        <h1 className="text-white text-xl sm:text-2xl md:text-3xl font-semibold leading-snug tracking-tight mb-4 sm:mb-5">
          Oops, something went wrong!
          <br />
          This page does not exist.
        </h1>
        <Link
          href="/"
          target="_top"
          className="inline-flex items-center gap-2 px-6 py-3 sm:px-8 sm:py-3.5 rounded-full text-white font-medium text-sm sm:text-base hover:scale-105 hover:shadow-lg transition-all"
          style={{ backgroundColor: "#F16524" }}
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          Go back home
        </Link>
      </div>
    </div>
  );
}
