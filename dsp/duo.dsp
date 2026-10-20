// Two-oscillator ribbon synth modelled from the KORG "monotron DUO" schematic
// for public release (2012-02-22, T. Takahashi).
//
// Part references (R54, VR4A, SW1A ...) point at that schematic. Values marked
// [schematic] are taken or derived from it, [hardware] come from KORG's
// published specification, and [estimate] still need a real unit to calibrate.
// The ribbon is read by an MSP430 (IC2) whose firmware is not public, so the
// ribbon range and scale behaviour follow the published feature list.
//
// Building blocks: the shared gate / VCF / amp in monotron-common.lib
// (ve.korg35LPF with the D7/D8 limiter in its resonance loop) and PolyBLEP
// band-limited squares.

declare name "duo-proto";
declare description "monotron DUO-style ribbon synth modelled from the public schematic";

import("stdfaust.lib");
mc = library("monotron-common.lib");

//============================== Controls ===================================

ribbon  = hslider("[0]ribbon", 0, 0, 1, 0.0001) : si.smooth(ba.tau2pole(0.0015));
gate    = button("[1]gate");
mode    = nentry("[2]mode[style:radio{'standby':0;'vco1':1;'vco1+2':2}]", 2, 0, 2, 1);
scale   = nentry("[3]scale[style:radio{'chromatic':0;'major':1;'minor':2;'off':3}]", 0, 0, 3, 1);
pitchK  = hslider("[4]pitch", 0.333, 0, 1, 0.0001) : si.smoo;
xmodK   = hslider("[5]xmod int", 0, 0, 1, 0.0001) : si.smoo;
vco2K   = hslider("[6]vco2 pitch", 0.137, 0, 1, 0.0001) : si.smoo;
cutK    = hslider("[7]cutoff", 0.6, 0, 1, 0.0001) : si.smoo;
peakK   = hslider("[8]peak", 0.3, 0, 1, 0.0001) : si.smoo;
volK    = hslider("[9]volume", 0.7, 0, 1, 0.0001) : si.smoo;
lineK   = hslider("[10]line in", 0, 0, 1, 0.0001) : si.smoo;
speaker = checkbox("[11]speaker");        // 1 = internal speaker path, 0 = headphones
stdlib  = checkbox("[12]stdlib filter");  // 1 = plain ve.korg35LPF (linear loop)

// SW1A "PATCH SELECT": STANDBY / VCO1 / VCO1+2. In the standby position SW1B
// cuts power; the third position connects SQR2 to the mixer.       [schematic]
active  = mode > 0;
vco2On  = mode == 2;

//============================== Gate ======================================
// The MSP430 drives "gate" (P1.3). It holds the VCO flip-flops through
// D3/D6, and opens the VCF through Q10 / R63 1k / C27 0.1u / R71 10k. [schematic]
gateOn  = gate * active;
gateEnv = mc.gateEnv(gateOn);
gateRise = gateOn > gateOn';

//============================== Ribbon / scale =============================
// IC2 reads the ribbon (A0) and the VCO1 PITCH knob (A1), and writes pitch as
// PWM (TA0.1) smoothed by R11 10k / C5 / C9 0.01u and IC3B (~0.1 ms). SW2A is
// the scale button: Chromatic, Major, Minor, Off.                   [hardware]
// Span of the whole ribbon: two octaves.                           [estimate]
ribbonSemis = 24;

// Snap s (semitones above the bottom of the ribbon) to the nearest note of a
// scale given as degrees 0..11; ties go to the lower note.
snapTo(s, d1, d2, d3, d4, d5, d6) = oct * 12 + (0 : pick(d1) : pick(d2) : pick(d3)
                                                  : pick(d4) : pick(d5) : pick(d6) : pick(12))
with {
  oct = floor(s / 12);
  w = s - oct * 12;
  pick(d, best) = select2(abs(w - d) < abs(w - best), best, d);
};
semisRaw   = ribbon * ribbonSemis;
semisChrom = rint(semisRaw);
semisMajor = snapTo(semisRaw, 2, 4, 5, 7, 9, 11);
semisMinor = snapTo(semisRaw, 2, 3, 5, 7, 8, 10);     // natural minor
semis = ba.selectn(4, scale, semisChrom, semisMajor, semisMinor, semisRaw)
      : si.smooth(ba.tau2pole(0.0001));

//============================== VCOs ======================================
// IC3D + Q2 is the exponential converter's reference; Q1 (VCO1) and Q3 (VCO2)
// share its emitter node, so both follow the same pitch CV.         [schematic]
// VCO1 PITCH knob uses the monotron's 1 V/oct law.                  [estimate]
vco1BaseHz = mc.pitchHz(pitchK) * pow(2, semis / 12);

// VCO2 PITCH (VR4A) adds a base offset to Q3: wiper 0..VCC*10k/16.8k (R77
// 6.8k, VCC = 5 V from R4/R8) through R76 220k / R62 10k = 0..130 mV,
// i.e. exp(130 mV / 25.7 mV) = 157x: unison to +7.3 octaves above VCO1. [schematic]
vco2Oct = 7.3;
vco2Hz  = vco1BaseHz * pow(2, vco2K * vco2Oct) : min(ma.SR * 0.45);

// Each core (C13 / C21 integrators, IC4 Schmitts) runs at twice the pitch and
// toggles a Q6/Q7 (Q5/Q8) flip-flop, so SQR1 / SQR2 are 50% squares. [schematic]
p2  = mc.phasor(vco2Hz, gateRise);
sq2 = mc.square(p2, vco2Hz / ma.SR);
sq2High = p2 < 0.5;                                    // flip-flop state, 0/1

// X-MOD: SQR2 (0..5 V) -> R54 100k / R59 150k (loaded by VR3A 10k) -> VR3A
// wiper -> R55 68k / R60 10k -> Q1 base: up to 55 mV, exp(55/25.7) = 8.5x,
// so full X-MOD INT throws VCO1 up 3.1 octaves while SQR2 is high. [schematic]
xmodOct = 3.1;
vco1Hz  = vco1BaseHz * pow(2, xmodK * xmodOct * sq2High) : min(ma.SR * 0.45);
p1  = mc.phasor(vco1Hz, gateRise);
sq1 = mc.square(p1, vco1Hz / ma.SR);

// Mixer at IC5D: SQR1 through C25 / R67 470k, SQR2 through C24 / R58 820k,
// so VCO2 sits at 470/820 = 0.57 of VCO1.                           [schematic]
vcoMix = (sq1 + sq2 * (470 / 820) * vco2On) * 0.55;

//============================== VCF =======================================
// Same filter as the monotron (Q11-Q13 / C30 / C31 / F1 / IC5C, D7/D8).
// The ribbon-to-cutoff resistor R70 is marked NU (not fitted), so unlike the
// monotron the cutoff does not track the ribbon.                    [schematic]
cutNorm = mc.cutoffNorm(cutK) : max(0) : min(0.97);

vcfIn = vcoMix * gateEnv + _ * lineK * 2 + mc.noiseFloor(active);

process = vcfIn : mc.vcf(cutNorm, peakK, stdlib) : mc.amp(speaker, volK, active) : ma.tanh;
