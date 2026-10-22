# Constellation — Pulsar, Binary, Singularity

Browser synths modelled from KORG's public schematics: the monotron (2010-10-13) as
**Pulsar**, the monotron DUO (2012-02-22) as **Binary**, and the monotron DELAY
(2012-02-22) as **Singularity**. Each synth is one Faust file compiled to
WebAssembly and run in an AudioWorklet; all three play on one page. **Nebula** adds
fourteen reverbs by Chris Johnson of [Airwindows](https://www.airwindows.com/), compiled from
his unmodified C++: eight space ones (Galactic, Galactic2, Galactic3, StarChild2, Infinity,
Infinity2, kCosmos, kAlienSpaceship) and six classic ones (Ultralight, Ultralight2, VerbTiny,
VerbThic, CreamCoat, CrunchCoat).

Play it at **https://ndray904.github.io/Constellation/** (GitHub Pages, served from `docs/`).

## Layout

| Path | What it is |
|---|---|
| `dsp/monotron-common.lib` | Circuits both schematics share part for part: gate timing, Korg 35 filter with diode-limited resonance, optional Moog, Moog half ladder, Oberheim SEM and TB-303 filters, speaker/headphone amp paths, the Juno-style stereo chorus on Pulsar and Binary, PolyBLEP helpers. |
| `dsp/monotron.dsp` | Pulsar: sawtooth VCO, ramp LFO, ribbon-tracking cutoff. Every constant cites its schematic part, tagged `[schematic]`, `[hardware]` or `[estimate]`. |
| `dsp/duo.dsp` | Binary: two square VCOs, X-MOD, VCO1/VCO1+2 switch, scale quantizer (Chromatic / Major / Minor / Off). |
| `dsp/delay.dsp` | Singularity: sawtooth VCO, triangle/square LFO, fixed-resonance VCF, PT2399 echo fed back into the filter. |
| `airwindows/src/` | Airwindows LinuxVST sources for Nebula's fourteen reverbs, unmodified (upstream `airwindows/airwindows`: Galactic3, Infinity, StarChild2 @ `b79c7a3`, the rest @ `e68f751`). |
| `airwindows/shim/` | What the plugins need to build as freestanding wasm32: a stand-in for the VST SDK base class, libm (math imported from JS, `fmax`/`fmin`, a correctly rounded software `fma`), a tiny `set`/`string`, binary128 `long double` helpers, and the C interface (`wrapper.cpp`). |
| `airwindows/LICENSE` | Airwindows' MIT license (Copyright (c) 2018 Chris Johnson). |
| `libm/` | musl's math library (MIT), the subset the modules import: `libm/musl` holds the sources unmodified (from WebAssembly/wasi-libc @ `ebd7c7f`, musl's own site being unreachable from the build machine), `libm/inc` and `builtins.c` stand in for musl's generated headers and use wasm's own `sqrt`/`fabs`. Every module imports its math from this instead of JavaScript's `Math`, whose results get boxed when called from wasm: enough garbage to make V8 pause the audio thread. |
| `web/faust-runtime.js` | Small host for the compiled wasm (memory layout, params, `compute`). Runs in the worklet and in Node. |
| `web/faust-worklet.js` | AudioWorklet processors: Faust synths, the recorder, and Nebula's reverb host (knob changes crossfade to a copy of the running reverb; instances made up front and reused; sleeps when idle). |
| `web/index.html` | Page template. Each instrument is built from a spec (`SPECS`): knobs, switch, ribbon length, presets. |
| (Cosmos skin) | In `web/index.html`: a space-art look for Pulsar, Binary, Singularity and Nebula, switched by the Look switch on the Master unit (remembered per browser). Each panel's artwork (pulsar, binary stars, black hole, gas nebula) is drawn on a canvas around its scope, which becomes tinted glass; logos are inline SVG. |
| `build.mjs` | Compiles the Faust DSPs (each synth once per filter model, so only the chosen filter runs; the worklet crossfades between them), the Airwindows C++ and libm, and inlines everything into `dist/constellation.html`. |
| `test/render.cjs` | Pulsar offline checks: tuning, 18-semitone ribbon, LFO range and aliasing, gating, self-oscillation. |
| `test/render-duo.cjs` | Binary offline checks: scales, VCO2 offset, X-MOD depth, gating, self-oscillation. |
| `test/render-delay.cjs` | Singularity offline checks: 4-octave ribbon, echo times vs the PT2399 fit, feedback decay and runaway, tape-style pitch bend. |
| `test/airwindows-parity.cjs` | Builds each Airwindows reverb natively (`test/airwindows-native/`) and compares it with the wasm build, at defaults and with every control moved, to within last-bit libm rounding (musl in the browser, glibc natively). |
| `test/nebula-declick.cjs` | Runs Nebula's worklet in Node: dragging a reverb's controls must not click (each change crossfades to a clone of the running reverb with the new settings). |
| `test/audio-load.cjs` | Diagnostic: audio-thread load and stalls in the real page, per reverb, optionally with V8's GC trace. |
| `test/browser.cjs` | Headless Chromium: plays all three ribbons, echoes, scale button, Hold, routing through Singularity and Nebula (every reverb, while sounding), computer keys, layout at phone and desktop widths. |

## Build and test

Needs Node 18+ and clang with the `wasm32` target and `wasm-ld` (e.g. Debian/Ubuntu `clang` + `lld`).

```sh
npm install
node build.mjs            # -> dist/constellation.html (artifact) and dist/constellation-standalone.html (open from disk), copied to docs/index.html for GitHub Pages
node test/render.cjs      # optional arg: a folder to write WAV renders into
node test/render-duo.cjs
node test/render-delay.cjs
node test/airwindows-parity.cjs
node test/nebula-declick.cjs
node test/browser.cjs     # optional arg: a folder for screenshots
```

## Licensing of what ships

- **Faust standard libraries** (`os.sawtooth`, `ve.korg35LPF` by Eric Tarr, `ve.moogLadder` by Dario Sanfilippo, `ve.moogHalfLadder`, `ve.oberheimLPF` and `ve.diodeLadder` by Eric Tarr, `fi.*`, `no.noise`): STK-4.3 (MIT-style) or MIT.
  Code generated by the Faust compiler belongs to the author of the `.dsp`.
- **`@grame/faustwasm`** (LGPL-3.0) is a build-time dev dependency only. It is not shipped, because the page uses its own runtime (`web/faust-runtime.js`).
- **Airwindows** (`airwindows/src`, by Chris Johnson): MIT. The license is in
  `airwindows/LICENSE` and shown on the page under Nebula.
- **musl libm** (`libm/musl`, Rich Felker et al., with code from FreeBSD msun, fdlibm and Arm optimized-routines): MIT, `libm/musl/COPYRIGHT`. Shown on the page under Nebula's licenses.
- Everything else in this repo is new code, released under the MIT license (`LICENSE`).
- "KORG" and "monotron" are trademarks of KORG Inc. The product name and look are deliberately different.

## Known gaps / next steps

1. Calibrate the `[estimate]` constants against a real unit: LFO depth, and the pitch knob's volts-to-Hz reference (1 V/oct over 0–10 V is from the hardware; 0 V = C0 is assumed).
2. The VCF "gate" (R51 into IC4A) also shifts the cutoff when the ribbon is touched. It isn't modelled yet, and line-in currently passes regardless.
3. Line-in exists in the DSP (`line in` param) but isn't wired to the UI, because microphone access is blocked inside the published artifact.
4. Binary: the ribbon range (2 octaves), scale snapping rule and VCO1 pitch law are estimates; the MSP430 firmware that sets them isn't public.
5. Singularity: the bottom of the ribbon (55 Hz), LFO rate/depth, feedback loop gain and the PT2399 clock darkening are estimates. KORG specifies a 4-octave ribbon; the resistors alone suggest ~11.6 octaves if it swings the full 5 V.
6. Routing: "To Binary" / "To Singularity" patch an instrument into another's line in (Pulsar -> Binary or Singularity, Binary -> Singularity; chains allowed, no loops) (like a cable from the headphone jack: direct output and speaker path bypassed). The line-in level (`line in` = 1, gain 2 into the VCF mixer) is an estimate. Hold latches the gate on Pulsar and Binary (space bar toggles it); it is a software addition, not on the hardware.
7. MIDI keyboard input (Web MIDI) works in the standalone file in Chrome, Edge and Firefox; the Claude viewer blocks device access, and Safari has no Web MIDI. Recording captures the master bus as 16-bit stereo WAV; in the viewer it is saved inside a .zip (WAV is not an allowed download type there), standalone as a plain .wav.
8. VST3/AU/CLAP: the same `.dsp` builds with `faust2juce` or the Faust iPlug2/DPF architectures.
9. Every Nebula reverb instance is made when sound starts (the context stays suspended until they are), then reused: making one while playing stalls the audio thread (Chrome compiles wasm lazily, and allocating or freeing wasm memory triggers garbage collection). With nothing coming in and its tail gone, Nebula sleeps and costs nothing. An Aurora unit (Faust standard-library reverbs, Cloud Seed, the Rings reverb) and 29 more Airwindows reverbs were tried and taken out again: together they made the page too slow to start and to switch.

## License

MIT, see [`LICENSE`](LICENSE). The third-party code keeps its own license: the Airwindows reverbs in `airwindows/src` (MIT, `airwindows/LICENSE`, Copyright (c) 2018 Chris Johnson) and musl's libm in `libm/musl` (MIT, `libm/musl/COPYRIGHT`).
