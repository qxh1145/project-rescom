import type { CSSProperties } from "react";
import {
  COMPOSED_MASCOTS,
  MASCOT_REFERENCE_HEIGHT,
  type ComposedMascotName,
  type MascotLayer,
} from "./mascot-layers";

/**
 * Figma page 19 "Bộ mascot" (70:446) — 21 expressions, all drawn on the same
 * 210 × 230 canvas, so width is always derived from the height.
 * Files come from `public/brand/mascots/<name>.svg`. `think`, `confused` and
 * `sleep` carry text glyphs ("?", "z") that Figma cannot flatten, so they are
 * assembled from their vector layers (see `mascot-layers.ts`).
 *
 * Figma notes: decorative (alt=""), minimum 96px high, one mascot per screen.
 */
export type MascotName =
  | "wave"
  | "cheer"
  | "points"
  | "streak"
  | "trophy"
  | "create"
  | "laptop"
  | "phone"
  | "search"
  | "wait"
  | "surprise"
  | "announce"
  | "sad"
  | "offline"
  | "fix"
  | "shield"
  | "love"
  | "ring"
  | ComposedMascotName;

const ASPECT_RATIO = 210 / 230;

interface MascotProps {
  name: MascotName;
  /** Rendered height in px, as measured on the Figma frame. */
  height: number;
  className?: string;
}

function isComposed(name: MascotName): name is ComposedMascotName {
  return name in COMPOSED_MASCOTS;
}

function LayerContent({ layer, height }: { layer: MascotLayer; height: number }) {
  if (layer.text) {
    return (
      <span
        className="block whitespace-nowrap font-bold leading-normal"
        style={{ color: layer.color, fontSize: ((layer.fontSize ?? 16) * height) / MASCOT_REFERENCE_HEIGHT }}
      >
        {layer.text}
      </span>
    );
  }
  return (
    <span className="absolute" style={{ inset: layer.bleed ?? 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG layer */}
      <img alt="" src={`/brand/mascots/parts/${layer.src}.svg`} className="block size-full max-w-none" />
    </span>
  );
}

function ComposedMascot({ name, height, width, className }: MascotProps & { name: ComposedMascotName; width: number }) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`} style={{ width, height }}>
      {COMPOSED_MASCOTS[name].map((layer, index) => {
        if (!layer.rotate) {
          return (
            <span key={index} className="absolute" style={{ inset: layer.inset }}>
              <LayerContent layer={layer} height={height} />
            </span>
          );
        }
        const rotated: CSSProperties = { width: layer.width, height: layer.height, rotate: layer.rotate };
        return (
          <span
            key={index}
            className="absolute flex items-center justify-center"
            style={{ inset: layer.inset, containerType: "size" }}
          >
            <span className="relative flex-none" style={rotated}>
              <LayerContent layer={layer} height={height} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function Mascot({ name, height, className = "" }: MascotProps) {
  const width = Math.round(height * ASPECT_RATIO * 100) / 100;

  if (isComposed(name)) {
    return <ComposedMascot name={name} height={height} width={width} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- vector art; next/image adds nothing for SVG
    <img
      src={`/brand/mascots/${name}.svg`}
      alt=""
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
      style={{ width, height }}
    />
  );
}
