// Monotron-style analogue ribbon synth, modelled from the KORG "monotron"
// schematic for public release (2010-10-13, T. Takahashi).
//
// Part references (R42, VR7A, D1/D2 ...) point at that schematic. Values marked
// [schematic] are taken or derived from it; values marked [estimate] could not
// be derived from the drawing alone and should be calibrated against hardware.
// Values marked [hardware] come from the real unit's specification.
//
// Building blocks: os.sawtooth (alias-suppressed sawtooth) from the Faust
// standard libraries, and the shared gate / VCF / amp in monotron-common.lib
// (ve.korg35LPF with the D1/D2 limiter in its resonance loop).

declare name "monotron-proto";
declare description "Monotron-style ribbon synth modelled from the public schematic";

import("stdfaust.lib");
mc = library("monotron-common.lib");

//============================== Controls ===================================

ribbon  = hslider("[0]ribbon", 0, 0, 1, 0.0001) : si.smooth(ba.tau2pole(0.0015));
gate    = button("[1]gate");
mode    = nentry("[2]mode[style:radio{'standby':0;'pitch':1;'cutoff':2}]", 1, 0, 2, 1);
pitchK  = hslider("[3]pitch", 0.333, 0, 1, 0.0001) : si.smoo;
rateK   = hslider("[4]lfo rate", 0.399, 0, 1, 0.0001) : si.smoo;
intK    = hslider("[5]lfo int", 0, 0, 1, 0.0001) : si.smoo;
cutK    = hslider("[6]cutoff", 0.6, 0, 1, 0.0001) : si.smoo;
peakK   = hslider("[7]peak", 0.3, 0, 1, 0.0001) : si.smoo;
volK    = hslider("[8]volume", 0.7, 0, 1, 0.0001) : si.smoo;
lineK   = hslider("[9]line in", 0, 0, 1, 0.0001) : si.smoo;
speaker = checkbox("[10]speaker");        // 1 = internal speaker path, 0 = headphones
fltModel = nentry("[11]filter model", 0, 0, 5, 1);  // see mc.vcf
chorusOn = checkbox("[12]chorus");
chRateK  = hslider("[13]chorus rate", 0.37, 0, 1, 0.0001) : si.smoo;
chDepthK = hslider("[14]chorus depth", 0.35, 0, 1, 0.0001) : si.smoo;
envA     = hslider("[15]attack", 0, 0, 1, 0.0001);
envD     = hslider("[16]decay", 0, 0, 1, 0.0001);
envS     = hslider("[17]sustain", 1, 0, 1, 0.0001) : si.smoo;
envR     = hslider("[18]release", 0, 0, 1, 0.0001);

pitchMode  = mode == 1;
cutoffMode = mode == 2;
active     = mode > 0;                    // SW1B: standby position cuts power

//============================== Gate ======================================
// IC2C compares the ribbon voltage against R13/R14 to make the gate. The gate
// drives Q10 ("VCO enable" / "VCF gate") through R51 1k into C16 0.1u || R52 10k:
// attack ~ 1k*0.1u = 0.1 ms, release ~ 10k*0.1u = 1 ms.          [schematic]
gateEnv = mc.gateEnv(mc.adsr(envA, envD, envS, envR, gate) * active);   // ADSR: see mc.adsr

// C9 0.01u / R24 100k differentiates the gate into the "LFO reset" pulse.
lfoReset = (gate > gate') & active;                                // [schematic]

//============================== LFO =======================================
// Q4/Q6 current mirror charges C10; IC3E/IC3D Schmitt + Q3 discharge it.
// The waveform icon at R64 shows a falling ramp (snap up, slow fall). [schematic]
// Rate range: 14 s per cycle at minimum to ~900 Hz at maximum.      [hardware]
// Swept exponentially, as the Q4/Q6 current mirror does (~13.6 octaves).
lfoMinHz = 1 / 14;
lfoMaxHz = 900;
lfoHz   = lfoMinHz * pow(lfoMaxHz / lfoMinHz, rateK);
lfoPhase = mc.phasor(lfoHz, lfoReset);
// The snap back up is band-limited with a PolyBLEP so a fast (audio-rate) LFO
// doesn't alias. The correction never pushes the ramp outside 0..1.
lfoDt   = lfoHz / ma.SR;
lfoRamp = 1 - lfoPhase + 0.5 * mc.polyBlep(lfoPhase, lfoDt);   // 1 -> 0 falling ramp
// R64 2.2k / R67 2.2k halve the ramp ahead of the LFO INT pot (VR5A). [schematic]
lfoOut  = lfoRamp * intK;
lfoLed  = lfoRamp : hbargraph("[12]lfo led", 0, 1);

//============================== VCO =======================================
// Ribbon -> R5 100k -> IC2A -> R2/VR1/R1 divider -> Q1 (IMX9) expo pair.
// Note on the schematic: "whole ribbon Vbe offset 26.29 mV @ 20 degC".
// Vt(20 degC) = 25.26 mV, so the full ribbon spans exp(26.29/25.26) = 2.83x,
// i.e. 18.0 semitones.                                             [schematic]
ribbonSemis = 18;
// PITCH (VR3A) is 1 V/oct over 0..10 V (5 V centre, +/- 5 octaves). [hardware]
// Volts-to-Hz reference assumes 0 V = C0 (16.35 Hz): 16.35 Hz .. 16.7 kHz
// at the bottom of the ribbon, C5 (523 Hz) at the centre.   [assumed reference]
baseHz   = mc.pitchHz(pitchK);
// LFO enters the IC2A summing node through R4 2.2k (vs R5 100k for the
// ribbon), so pitch modulation is very deep: up to 4 octaves.       [estimate]
lfoOct   = lfoOut * 4 * pitchMode;
vcoHz    = baseHz * pow(2, ribbon * ribbonSemis / 12 + lfoOct) : min(ma.SR * 0.45);
// Integrator C11 + reset JFET F2: the icon at TP8 shows a falling sawtooth.
vco      = 0 - os.sawtooth(vcoHz);                                 // [schematic]

//============================== VCF =======================================
// Q12-Q14 / C20 0.01u / C21 3300p / F3 / IC4C: see mc.vcf. Resonance (VR7A) is
// taken from IC4C's output, and IC4C has D1/D2 (1SS355) || R60 330k in its
// feedback, so the limiting sits inside the resonance loop.        [schematic]
//
// Cutoff CV at IC4B sums: CUTOFF knob (VR6A wiper, 0..0.6 VCC, via R50 68k),
// ribbon (0..VCC via R42 330k) and LFO (via R44 10k). Ribbon tracking relative
// to the knob span = (1/330k) / (0.6/68k) = 0.34.                  [schematic]
cutNorm  = mc.cutoffNorm(cutK)
         + 0.34 * mc.cutSpan * ribbon
         + 0.7 * lfoOut * cutoffMode                                // [estimate]
         : max(0) : min(0.97);

vcfIn = vco * gateEnv * 0.8 + _ * lineK * 2 + mc.noiseFloor(active);

//============================== AMP =======================================
// TPA6111 speaker / headphone channels: see mc.amp.                [schematic]

process = vcfIn : mc.vcf(cutNorm, peakK, fltModel) : mc.amp(speaker, volK, active) : ma.tanh : attach(_, lfoLed)
        : mc.chorus(chorusOn, chRateK, chDepthK);  // stereo out: see mc.chorus
