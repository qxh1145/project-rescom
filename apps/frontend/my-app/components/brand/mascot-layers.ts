/**
 * Layer geometry for the mascots Figma cannot export as one SVG (they contain
 * live text). Values are copied from `get_design_context` for the page-19
 * instances: `Mascot/think` 70:772, `Mascot/confused` 70:866, `Mascot/sleep` 70:966.
 * `inset` is relative to the mascot box; rotated layers are centred in their
 * box and sized with `hypot()` exactly as Figma emits them.
 */

export interface MascotLayer {
  inset: string;
  rotate?: string;
  /** Unrotated size of a rotated layer (CSS lengths, container-relative). */
  width?: string;
  height?: string;
  /** SVG part in `public/brand/mascots/parts/`. */
  src?: string;
  /** Negative inset Figma adds around stroked vectors. */
  bleed?: string;
  text?: string;
  color?: string;
  /** Font size as measured on the 186px-high page-19 instance. */
  fontSize?: number;
}

export const MASCOT_REFERENCE_HEIGHT = 186;

const BODY: MascotLayer[] = [
  { inset: "42.61% 72.86% 16.96% 7.48%", src: "c6b4b", bleed: "-1.18% -2.66%" },
  { inset: "53.91% 77.62% 29.02% 13.81%", src: "932f5", bleed: "-2.04% -4.44%" },
  { inset: "86.09% 52.86% 6.96% 28.1%", src: "8f3d3", bleed: "-6.88% -2.75%" },
  { inset: "86.09% 28.1% 6.96% 52.86%", src: "19250", bleed: "-6.88% -2.75%" },
  { inset: "20.87% 12.86% 11.3% 12.86%", src: "f3e12", bleed: "-0.71%" },
  { inset: "5.79% 35.39% 80% 50.28%", src: "a4d0b", bleed: "-3.36% -3.66% -3.37% -3.65%" },
  { inset: "14.71% 50.48% 79.69% 37.62%", src: "d63f2", bleed: "-8.54% -4.4% -8.53% -4.4%" },
  { inset: "56.09% 61.9% 39.57% 29.52%", src: "ae96f" },
  { inset: "56.09% 29.52% 39.57% 61.9%", src: "ae96f" },
];

const QUESTION_MARKS: MascotLayer[] = [
  {
    inset: "10.76% 12.58% 68.97% 72.92%",
    rotate: "12deg",
    width: "hypot(70.6488cqw, 9.80833cqh)",
    height: "hypot(-29.3512cqw, 90.1917cqh)",
    text: "?",
    color: "#a9c3ee",
    fontSize: 34,
  },
  {
    inset: "27.53% 6.82% 58.95% 82.36%",
    rotate: "20deg",
    width: "hypot(57.8724cqw, 15.3966cqh)",
    height: "hypot(-42.1276cqw, 84.6034cqh)",
    text: "?",
    color: "#f7d35f",
    fontSize: 22,
  },
];

const THINKING_ARMS: MascotLayer[] = [
  {
    inset: "58.41% 79% 26.23% 6.62%",
    rotate: "18deg",
    width: "hypot(69.2966cqw, 19.2425cqh)",
    height: "hypot(-30.7034cqw, 80.7575cqh)",
    src: "34192",
    bleed: "-3.67% -5%",
  },
  {
    inset: "64.56% 30.62% 23.7% 55.38%",
    rotate: "-20deg",
    width: "hypot(76.7278cqw, -30.3992cqh)",
    height: "hypot(23.2722cqw, 69.6008cqh)",
    src: "47e9a",
    bleed: "-5.5% -4.58%",
  },
];

export const COMPOSED_MASCOTS = {
  think: [
    ...QUESTION_MARKS,
    ...BODY,
    { inset: "46.09% 55.48% 46.09% 38.33%", src: "4befb" },
    { inset: "46.09% 36.43% 46.09% 57.38%", src: "4befb" },
    { inset: "47.13% 56.57% 50.61% 41.33%", src: "89126" },
    { inset: "47.13% 37.52% 50.61% 60.38%", src: "89126" },
    { inset: "61.3% 46.19% 38.7% 46.19%", src: "11b5e", bleed: "-1.21px -9.37%" },
    ...THINKING_ARMS,
  ],
  confused: [
    ...QUESTION_MARKS,
    ...BODY,
    { inset: "47.39% 56.43% 44.78% 37.38%", src: "4befb" },
    { inset: "51.3% 36.67% 48.7% 55.71%", src: "6db6d", bleed: "-1.37px -10.62% -1.37px -10.63%" },
    { inset: "45.22% 37.14% 53.48% 55.24%", src: "1c750", bleed: "-50.01% -9.38%" },
    { inset: "60.65% 43.33% 37.17% 43.33%", src: "c9552", bleed: "-30% -5.36%" },
    ...THINKING_ARMS,
    { inset: "40% 23.98% 53.04% 72.44%", src: "b47c3", bleed: "-5% -10.64%" },
  ],
  sleep: [
    { inset: "22.61% 26.19% 67.39% 69.05%", text: "z", color: "#a9c3ee", fontSize: 18 },
    { inset: "11.3% 16.19% 75.65% 77.62%", text: "z", color: "#a9c3ee", fontSize: 24 },
    { inset: "-1.74% 5.24% 85.22% 87.14%", text: "z", color: "#a9c3ee", fontSize: 30 },
    ...BODY,
    { inset: "51.3% 55.24% 47.17% 36.19%", src: "b09e7", bleed: "-45.72% -8.89% -45.71% -8.89%" },
    { inset: "51.3% 36.19% 47.17% 55.24%", src: "b09e7", bleed: "-45.72% -8.89% -45.71% -8.89%" },
    { inset: "60% 46.19% 38.7% 46.19%", src: "e14c0", bleed: "-50.01% -9.38% -50% -9.38%" },
    {
      inset: "67.86% 55.93% 21.77% 31.16%",
      rotate: "10deg",
      width: "hypot(87.1886cqw, 17.464cqh)",
      height: "hypot(-12.8114cqw, 82.536cqh)",
      src: "da000",
      bleed: "-5.5% -4.58%",
    },
    {
      inset: "67.86% 31.16% 21.77% 55.93%",
      rotate: "-10deg",
      width: "hypot(87.1886cqw, -17.464cqh)",
      height: "hypot(12.8114cqw, 82.536cqh)",
      src: "43cc1",
      bleed: "-5.5% -4.58%",
    },
    { inset: "52.17% 48.1% 41.74% 45.71%", src: "4c9f6", bleed: "-9.29% -10%" },
    { inset: "63.48% 40.48% 21.74% 40.48%", src: "9aaf2", bleed: "-3.24% -2.75%" },
    { inset: "65.22% 38.51% 28.7% 59.52%", src: "e6b05", bleed: "-6.88% -26.65% -6.88% -12.9%" },
    { inset: "64.78% 42.38% 33.04% 42.38%", src: "77939" },
  ],
} satisfies Record<string, MascotLayer[]>;

export type ComposedMascotName = keyof typeof COMPOSED_MASCOTS;
