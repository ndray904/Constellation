// Ribbon synth with echo, modelled from the KORG "monotron DELAY" schematic for
// public release (2012-02-22, T. Takahashi).
//
// Part references (R45, VR6A, IC5 ...) point at that schematic. Values marked
// [schematic] are taken or derived from it, [hardware] come from KORG's
// published specification, [datasheet] from the PT2399's, and [estimate]
// still need a real unit to calibrate.
//
// Building blocks: os.sawtooth, de.fdelay and fi.* from the Faust standard
// libraries, and the shared gate / VCF / amp in monotron-common.lib.

declare name "delay-proto";
declare description "monotron DELAY-style ribbon synth with PT2399 echo, modelled from the public schematic";

import("stdfaust.lib");
mc = library("monotron-common.lib");

//============================== Controls ===================================

ribbon   = hslider("[0]ribbon", 0, 0, 1, 0.0001) : si.smooth(ba.tau2pole(0.0015));
gate     = button("[1]gate");
mode     = nentry("[2]mode[style:radio{'standby':0;'triangle':1;'square':2}]", 1, 0, 2, 1);
rateK    = hslider("[3]lfo rate", 0.4, 0, 1, 0.0001) : si.smoo;
intK     = hslider("[4]lfo int", 0, 0, 1, 0.0001) : si.smoo;
shapeK   = hslider("[5]lfo shape", 0.5, 0, 1, 0.0001) : si.smoo;
cutK     = hslider("[6]cutoff", 0.45, 0, 1, 0.0001) : si.smoo;
timeK    = hslider("[7]time", 0.25, 0, 1, 0.0001);
fbK      = hslider("[8]feedback", 0.35, 0, 1, 0.0001) : si.smoo;
volK     = hslider("[9]volume", 0.7, 0, 1, 0.0001) : si.smoo;
lineK    = hslider("[10]line in", 0, 0, 1, 0.0001) : si.smoo;
speaker  = checkbox("[11]speaker");        // 1 = internal speaker path, 0 = headphones
fltModel = nentry("[12]filter model", 0, 0, 5, 1);  // see mc.vcf

// SW1A "WAVE SELECT": STANDBY / triangle / square. In standby SW1B cuts
// power.                                                            [schematic]
active   = mode > 0;
squareOn = mode == 2;

//============================== Gate ======================================
// IC2C makes the gate from the ribbon voltage (R17/R18 threshold) and drives
// "VCO enable". The VCF gate parts (Q10, R50) are marked NU, so the filter
// stays open between notes and the echoes ring on.                  [schematic]
gateEnv = mc.gateEnv(gate * active);

//============================== LFO =======================================
// Q1/Q2/Q5/Q7 current mirrors charge C9 0.01u between the IC3D/IC3E Schmitt
// thresholds: a triangle at F1's source (halved by R30/R31) and a square at
// IC3E (halved by R39/R38). It is free-running (no reset on touch). [schematic]
// The rear trimmer VR1 skews the triangle / sets the square's width. [hardware]
// Rate range: 0.08 Hz .. 80 Hz, exponential.                        [estimate]
lfoHz    = 0.08 * pow(1000, rateK);
lfoDt    = lfoHz / ma.SR;
lfoPh    = mc.phasor(lfoHz, 0);
skew     = 0.05 + 0.9 * shapeK;
lfoTri   = select2(lfoPh < skew, (1 - lfoPh) / (1 - skew), lfoPh / skew);
// Unipolar 0/1 square with both edges band-limited (PolyBLEP).
lfoSq    = (lfoPh < skew) + 0.5 * mc.polyBlep(lfoPh, lfoDt)
                          - 0.5 * mc.polyBlep(ma.frac(lfoPh + 1 - skew), lfoDt);
lfoWave  = select2(squareOn, lfoTri, lfoSq);
lfoLed   = lfoWave * active : hbargraph("[13]lfo led", 0, 1);
// LFO INT (VR4A, with R44 22k) into IC2A through R7 47k: 10x the ribbon's
// 470k per volt. Depth up to 3 octaves.                             [estimate]
lfoOct   = lfoWave * intK * 3;

//============================== VCO =======================================
// Same sawtooth core as the monotron (C10, F2, IC3B/C; falling ramp at TP11).
// There is no pitch knob: R22/R23/R24 fix the expo converter's reference.
// Ribbon: R6 470k / R10 47k into IC2A, then R11 820 / R15 560 to Q3.
// KORG specifies a four-octave ribbon.                              [hardware]
// (If the ribbon swung the full 5 V as on the monotron, these resistors would
// give ~11.6 octaves; the published spec wins until a unit is measured.)
// Bottom of the ribbon: 55 Hz.                                      [estimate]
ribbonOct = 4;
baseHz    = 55;
vcoHz     = baseHz * pow(2, ribbon * ribbonOct + lfoOct) : min(ma.SR * 0.45);
vco       = 0 - os.sawtooth(vcoHz);

//============================== VCF =======================================
// Same filter as the monotron (Q11-Q13 / C18 / C19 / F3 / IC4C, D1/D2).
// CUTOFF: R72 is 0 ohm, so VR5A's wiper spans 0..VCC instead of the monotron's
// 0..0.6 VCC into the same R48 68k / IC4B-IC4A chain.               [schematic]
// The ribbon still reaches the cutoff through R45 330k: relative to a 0..VCC
// knob that is 68k/330k = 0.21 of the knob's span.                  [schematic]
cutNorm  = mc.cutoffNorm(cutK / 0.6) + (68 / 330) * (mc.cutSpan / 0.6) * ribbon
         : max(0) : min(0.97);

// No PEAK knob: resonance is fixed by R78 3.3k from the output, where the
// monotron has its PEAK pot plus R78 2.2k. Into the shared R73 5.6k node that
// is (2.2k + 5.6k) / (3.3k + 5.6k) = 0.88 of the monotron's full PEAK loop
// gain. Full PEAK sits at the oscillation edge (K = 2), so K = 0.88 * 2 = 1.76:
// strongly resonant, short of self-oscillation. mc.vcf takes K / 2.2. [schematic]
peakFixed = 0.88 * 2 / 2.2;

//============================== Delay (IC5 PT2399) ========================
// Delay time: R80 1k + VR6A 0..100k on pin 6. Electric Druid's least-squares
// fit to the datasheet table: ms = 11.46 * R(kOhm) + 29.7, so 41 ms .. 1.19 s.
//                                                                  [datasheet]
// The clock follows the knob, so turning it bends the pitch of the echoes
// like a tape echo: the delay time glides rather than jumps.         [hardware]
delayMs  = 11.46 * (1 + 100 * timeK) + 29.7 : si.smooth(ba.tau2pole(0.08));
delaySmp = delayMs * 0.001 * ma.SR;
// The PT2399 clock falls as the delay grows (683 / (ms - 0.08) MHz), and its
// bandwidth with it: ~15 kHz at the 31 ms minimum, scaled by the clock.
//                                                                   [estimate]
clockLp  = min(16000, 15000 * 31.3 / delayMs);
// Input filter R75 / R74 15k with C25 470p / C24 3300p, and the output filter
// R76 / R77 / R82 15k with C29 470p / C31 3300p: two-pole low-passes near
// 1 / (2 pi 15k sqrt(470p * 3300p)) = 8.5 kHz.                      [schematic]
pt2399   = ma.tanh                         // converter headroom
         : fi.lowpass(2, 8500)
         : de.fdelay(131072, delaySmp)
         : fi.lowpass(2, clockLp)
         : fi.lowpass(2, 8500);

// FEEDBACK (VR7A) returns the delay output ("FX FB") to the VCF input mixer
// IC4D through C20 / R58 10k, 10x the VCO's R55 100k. The echo is only heard
// through this path, so FEEDBACK sets both the echo level and the repeats, and
// every repeat passes through the filter again.                     [schematic]
// Loop gain 1.5 x FEEDBACK: repeats build to runaway past ~2/3.      [estimate]
fbGain   = fbK * 1.5;

//============================== Voice =====================================
// A -80 dB noise floor stands in for circuit noise.
dry      = vco * gateEnv * 0.8 + _ * lineK * 2 + mc.noiseFloor(active);

// Loop: (feedback + dry) -> VCF; the VCF output goes to the amp and into the
// PT2399, whose output comes back as feedback.
voice    = (((+ : mc.vcf(cutNorm, peakFixed, fltModel)) <: pt2399, _) ~ *(fbGain)) : !, _;

process  = dry : voice : mc.amp(speaker, volK, active) : ma.tanh : attach(_, lfoLed);
