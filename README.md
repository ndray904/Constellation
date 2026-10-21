# Constellation — Pulsar, Binary, Singularity

Browser synths modelled from KORG's public schematics: the monotron (2010-10-13) as
**Pulsar**, the monotron DUO (2012-02-22) as **Binary**, and the monotron DELAY
(2012-02-22) as **Singularity**. Each synth is one Faust file compiled to
WebAssembly and run in an AudioWorklet; all three play on one page. **Nebula** adds
43 space reverbs by Chris Johnson of [Airwindows](https://www.airwindows.com/) (his whole
Reverb category, plus StarChild2), compiled from his unmodified C++. **Aurora** adds 13
more, none of them GPL: Faust standard-library reverbs (Dattorro plate, zita-rev1,
JPverb, Greyhole, Freeverb and six models of ValhallaSupermassive's modes), the open
core of Ghost Note Audio's Cloud Seed, and the reverb from Mutable Instruments' Rings
and Clouds.

## Layout

| Path | What it is |
|---|---|
| `dsp/monotron-common.lib` | Circuits both schematics share part for part: gate timing, Korg 35 filter with diode-limited resonance, speaker/headphone amp paths, PolyBLEP helpers. |
| `dsp/monotron.dsp` | Pulsar: sawtooth VCO, ramp LFO, ribbon-tracking cutoff. Every constant cites its schematic part, tagged `[schematic]`, `[hardware]` or `[estimate]`. |
| `dsp/duo.dsp` | Binary: two square VCOs, X-MOD, VCO1/VCO1+2 switch, scale quantizer (Chromatic / Major / Minor / Off). |
| `dsp/delay.dsp` | Singularity: sawtooth VCO, triangle/square LFO, fixed-resonance VCF, PT2399 echo fed back into the filter. |
| `airwindows/src/` | Airwindows LinuxVST sources for the 43 Nebula reverbs, unmodified (upstream `airwindows/airwindows`: Galactic3, Infinity, StarChild2 @ `b79c7a3`, the rest @ `e68f751`; the first two are unchanged between them). |
| `airwindows/shim/` | What the plugins need to build as freestanding wasm32: a stand-in for the VST SDK base class, libm (math imported from JS, `fmax`/`fmin`, a correctly rounded software `fma`), a tiny `set`/`string`, binary128 `long double` helpers, and the C interface (`wrapper.cpp`). |
| `dsp/aurora/` | Aurora's Faust reverbs: thin wrappers over the standard library (`plate`, `zita`, `jpverb`, `greyhole`, `freeverb`) and six modes of `massive.lib`, `re.valhallaSupermassive` copied unmodified from a newer Faust library (grame-cncm/faustlibraries @ `db56585`) than faustwasm bundles. `aurora.lib` holds the shared mix and the glides that keep controls click-free. |
| `aurora/src/` | Aurora's C++, unmodified: CloudSeedCore (GhostNoteAudio @ `deb21de`, MIT) and the Rings reverb with the stmlib headers it uses (pichenettes/eurorack @ `f4cfa76`, stmlib @ `d18def8`, MIT). |
| `aurora/shim/` | Wrappers that give both the Airwindows C interface (`texture.cpp`, `cloudseed.cpp`), plus what they need as freestanding wasm32: an allocator, minimal `vector`/`algorithm`/`cmath`, and the C standard's `rand()`. |
| `airwindows/LICENSE` | Airwindows' MIT license (Copyright (c) 2018 Chris Johnson). |
| `libm/` | musl's math library (MIT), the subset the modules import: `libm/musl` holds the sources unmodified (from WebAssembly/wasi-libc @ `ebd7c7f`, musl's own site being unreachable from the build machine), `libm/inc` and `builtins.c` stand in for musl's generated headers and use wasm's own `sqrt`/`fabs`. Every module imports its math from this instead of JavaScript's `Math`, whose results get boxed when called from wasm: enough garbage to make V8 pause the audio thread. |
| `web/faust-runtime.js` | Small host for the compiled wasm (memory layout, params, `compute`). Runs in the worklet and in Node. |
| `web/faust-worklet.js` | AudioWorklet processors: Faust synths, the recorder, and the reverb host for Nebula and Aurora. A module takes knob changes either by crossfading to a copy of itself (Airwindows) or by gliding its own controls (Aurora). |
| `web/index.html` | Page template. Each instrument is built from a spec (`SPECS`): knobs, switch, ribbon length, presets. |
| `build.mjs` | Compiles the Faust DSPs, the Airwindows C++ and Aurora's reverbs, and inlines everything into `dist/constellation.html`. |
| `test/render.cjs` | Pulsar offline checks: tuning, 18-semitone ribbon, LFO range and aliasing, gating, self-oscillation. |
| `test/render-duo.cjs` | Binary offline checks: scales, VCO2 offset, X-MOD depth, gating, self-oscillation. |
| `test/render-delay.cjs` | Singularity offline checks: 4-octave ribbon, echo times vs the PT2399 fit, feedback decay and runaway, tape-style pitch bend. |
| `test/airwindows-parity.cjs` | Builds each Airwindows reverb natively (`test/airwindows-native/`) and compares it with the wasm build, at defaults and with every control moved: 81 of 86 renders bit-identical, the rest within last-bit libm rounding (musl in the browser, glibc natively). |
| `test/aurora-parity.cjs` | The same for Aurora's C++ (`test/aurora-native/`): Texture bit-identical, Cloud Seed to 136 dB. |
| `test/nebula-declick.cjs` | Runs Nebula's worklet in Node: dragging a reverb's controls must not click (each change crossfades to a clone of the running reverb with the new settings). |
| `test/aurora.cjs` | Runs every Aurora reverb in the worklet host: it rings on, stays bounded, and none of its knobs click when dragged; fast instance creation matches a full init. |
| `test/audio-load.cjs` | Diagnostic: audio-thread load and stalls in the real page, per reverb, optionally with V8's GC trace. |
| `test/browser.cjs` | Headless Chromium: plays all three ribbons, echoes, scale button, Hold, routing through Singularity, Nebula and Aurora (every reverb, while sounding), computer keys, layout at phone and desktop widths. |

## Build and test

Needs Node 18+ and clang with the `wasm32` target and `wasm-ld` (e.g. Debian/Ubuntu `clang` + `lld`).

```sh
npm install
node build.mjs            # -> dist/constellation.html (artifact) and dist/constellation-standalone.html (open from disk)
node test/render.cjs      # optional arg: a folder to write WAV renders into
node test/render-duo.cjs
node test/render-delay.cjs
node test/airwindows-parity.cjs
node test/aurora-parity.cjs
node test/nebula-declick.cjs
node test/aurora.cjs
node test/browser.cjs     # optional arg: a folder for screenshots
```

## Licensing of what ships

- **Faust standard libraries** (`os.sawtooth`, `ve.korg35LPF` by Eric Tarr, `fi.*`, `no.noise`): STK-4.3 (MIT-style) or MIT.
  Code generated by the Faust compiler belongs to the author of the `.dsp`.
- **`@grame/faustwasm`** (LGPL-3.0) is a build-time dev dependency only. It is not shipped, because the page uses its own runtime (`web/faust-runtime.js`).
- **Airwindows** (`airwindows/src`, by Chris Johnson): MIT. The license is in
  `airwindows/LICENSE` and shown on the page under Nebula.
- **Aurora**, all shown on the page under Aurora:
  - Faust `re.dattorro_rev` (Jakob Zerbian) and `re.zita_rev1_stereo` (Julius O. Smith III, after Fons Adriaensen): STK-4.3.
  - `re.jpverb`, `re.greyhole` (Julian Parker, Till Bovermann) and `re.valhallaSupermassive` (David Braun): MIT.
  - `re.stereo_freeverb` (Romain Michon, GRAME): LGPL with GRAME's exception, which lets code compiled from it take any license.
  - CloudSeedCore (Ghost Note Audio): MIT (`aurora/src/cloudseed/LICENSE`). Its README allows the Cloud Seed name if it's clear the product isn't Ghost Note Audio's.
  - Rings reverb and stmlib (Emilie Gillet): MIT (file headers, `aurora/src/mutable/stmlib/LICENSE`). The Mutable Instruments name is not used for derivative works, so the reverb is called Texture.
  - Faust's `re.vital_rev` and `re.kb_rom_rev1` are GPL-3.0 and are not used.
  - The Supermassive models are not made or endorsed by Valhalla DSP.
- **musl libm** (`libm/musl`, Rich Felker et al., with code from FreeBSD msun, fdlibm and Arm optimized-routines): MIT, `libm/musl/COPYRIGHT`. Shown on the page under Aurora's licenses.
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
9. Aurora: Cloud Seed exposes nine of its 45 parameters, starting from its one bundled program (Dark Plate). Texture is Rings' 48 kHz tuning, and Plate keeps Dattorro's 29.8 kHz delay lengths in samples, so both change size with the sample rate.
10. Every reverb instance is made when sound starts (the context stays suspended until they are), then reused: making one while playing stalls the audio thread (Chrome compiles wasm lazily, and allocating or freeing reverb memories of up to 64 MB triggers garbage collection). The cost is address space: about 400 MB reserved in the audio worklet, committed only as delay lines are used.

## License

MIT, see [`LICENSE`](LICENSE). The third-party code keeps its own license: the Airwindows reverbs in `airwindows/src` (MIT, `airwindows/LICENSE`, Copyright (c) 2018 Chris Johnson), and Aurora's reverbs as listed above.
