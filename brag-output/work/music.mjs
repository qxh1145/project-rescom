// Synthesizes the soundtrack: soft C-major house loop at 120 BPM + in-key SFX. Writes music.wav (stereo 48k).
import fs from 'fs';
const SR = 48000, DUR = 21, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const mf = m => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function add(t0, len, fn, gain = 1, pan = 0) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) { const k = s0 + i; if (k < 0 || k >= N) continue; const v = fn(i / SR); L[k] += v * gl; R[k] += v * gr; }
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
// instruments
const kick = (t0, g = .9) => add(t0, .4, t => Math.sin(2 * Math.PI * (45 * t + 90 * (1 - Math.exp(-t * 30)) / 30)) * env(t, .002, .12), g);
const hat = (t0, g = .08) => { let lp = 0; add(t0, .06, t => { const n = rnd(); const hp = n - lp; lp = n; return hp * env(t, .001, .018); }, g, .3); };
const clap = (t0, g = .12) => add(t0, .2, t => rnd() * env(t, .003, .05) * (1 + .5 * Math.sin(t * 900)), g, -.2);
function pluck(t0, m, g = .12, pan = 0, dec = .35) {
  const f = mf(m);
  add(t0, dec * 4, t => { const e = env(t, .004, dec); return e * (Math.sin(2 * Math.PI * f * t) + .35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 8) + .12 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 14)); }, g, pan);
}
function bass(t0, m, len, g = .22) { const f = mf(m); add(t0, len, t => { const e = Math.min(1, t / .01) * Math.min(1, (len - t) / .05); return e * (Math.sin(2 * Math.PI * f * t) + .25 * Math.sin(4 * Math.PI * f * t)); }, g); }
function pad(t0, ms, len, g = .05) { ms.forEach((m, j) => { const f = mf(m); add(t0, len, t => { const e = Math.min(1, t / .6) * Math.min(1, (len - t) / 1.2); return e * (Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * .3 * t)) + .3 * Math.sin(2 * Math.PI * f * 2.003 * t)); }, g, j % 2 ? .4 : -.4); }); }
function pop(t0, m, g = .1, pan = 0) { const f = mf(m); add(t0, .25, t => Math.sin(2 * Math.PI * f * t * (1 + .5 * Math.exp(-t * 60))) * env(t, .002, .06), g, pan); }
function whoosh(tc, g = .07, up = .45, down = .25) {
  let lp = 0; const len = up + down;
  add(tc - up, len, t => { const x = t < up ? Math.pow(t / up, 2) : Math.exp(-(t - up) / (down / 3)); const c = .02 + .25 * (t < up ? t / up : 1 - (t - up) / down); lp += c * (rnd() - lp); return lp * x * 3; }, g, 0);
}
const B = .5; // beat
// chords per bar (2s): C, Am, F, G
const CH = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
const ROOT = [36, 33, 29, 31];
// HOOK 0-3: chat pops on each bubble, rising pentatonic; muted pulse
const PENT = [72, 74, 76, 79, 81, 84, 86, 88, 91];
for (let i = 0; i < 9; i++) pop(.05 + i * .17, PENT[i], .07, i % 3 === 1 ? .35 : -.25);
pad(1.6, [60, 64, 67], 1.6, .035); whoosh(3.0, .06, .9, .3);
for (let b = 0; b < 4; b++) hat(1.0 + b * .5, .04);
// GROOVE 3 - 17.5
for (let t = 3; t < 17.5 - 1e-6; t += B) {
  const bar = Math.floor((t - 3) / 2) % 4, beatInBar = Math.round(((t - 3) % 2) / B);
  kick(t, .75);
  hat(t + B / 2, .06);
  if (beatInBar % 2 === 1) clap(t, .08);
  bass(t + B / 2, ROOT[bar] + 12, B * .45, .16);
  const c = CH[bar];
  pluck(t, c[(beatInBar) % 4] + 12, .05, beatInBar % 2 ? .3 : -.3, .22);
  if (beatInBar === 0) c.forEach((m, j) => pluck(t, m, .045, (j - 1.5) * .2, .5));
}
// SFX in key
[6, 10, 14, 17.5].forEach(tc => whoosh(tc, .045));
whoosh(12.15, .04, .3, .25);
pop(8.07, 67, .08); // click
[72, 76, 79, 84].forEach((m, i) => pop(8.9 + i * .06, m + 12, .05, .2)); // +12 lands
pop(10.35, 76, .04); pop(14.55, 79, .05); // caption/mascot
// OUTRO 17.5-21: big C, bell, settle
kick(17.5, .7); pad(17.5, [48, 55, 60, 64, 67, 72], 3.5, .03);
[72, 76, 79, 84].forEach((m, i) => pluck(17.7 + i * .12, m, .06, (i - 1.5) * .3, .8));
pluck(18.2, 84, .05, 0, 1.2); bass(17.5, 36, 3.2, .14);
// sidechain duck on kick times
for (let k = 0; k < N; k++) {
  const t = k / SR; if (t < 3 || t > 17.5) continue;
  const ph = ((t - 3) % B) / B; const duck = 1 - .35 * Math.exp(-ph * 10);
  L[k] *= duck; R[k] *= duck;
}
// simple stereo reverb (comb network)
function verb(x, d1, mix) {
  const out = new Float32Array(N); const ds = [1557, 1617, 1491, 1422].map(d => d + d1), bufs = ds.map(d => new Float32Array(d)), idx = ds.map(() => 0);
  for (let k = 0; k < N; k++) { let s = 0; for (let j = 0; j < 4; j++) { const y = bufs[j][idx[j]]; bufs[j][idx[j]] = x[k] + y * .78; idx[j] = (idx[j] + 1) % ds[j]; s += y; } out[k] = x[k] + s * mix / 4; }
  return out;
}
const OL = verb(L, 0, .35), OR = verb(R, 23, .35);
// master: fade ends, soft clip, normalize
let pk = 0; for (let k = 0; k < N; k++) { const t = k / SR; const f = Math.min(1, t / .02) * Math.min(1, (DUR - t) / 1.2); OL[k] = Math.tanh(OL[k] * f * 1.2); OR[k] = Math.tanh(OR[k] * f * 1.2); pk = Math.max(pk, Math.abs(OL[k]), Math.abs(OR[k])); }
const g = .89 / pk; const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let k = 0; k < N; k++) { buf.writeInt16LE(Math.round(OL[k] * g * 32767), 44 + k * 4); buf.writeInt16LE(Math.round(OR[k] * g * 32767), 46 + k * 4); }
fs.writeFileSync('music.wav', buf); console.log('peak', pk.toFixed(3));
