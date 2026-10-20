declare name "Aurora Freeverb";
declare description "Jezar's Freeverb, re.stereo_freeverb from the Faust standard library (Romain Michon)";
// Freeverb's own control laws: room size 0.7-0.98 comb feedback, damping 0-0.4,
// a fixed 0.015 input gain and allpass feedback 0.5, and wet1/wet2 width.
au = library("aurora.lib");
import("stdfaust.lib");

room = hslider("Room size", 0.5, 0, 1, 0.01) * 0.28 + 0.7 : au.smoo;
damp = hslider("Damping", 0.5, 0, 1, 0.01) * 0.4 : au.smoo;
width = hslider("Width", 1, 0, 1, 0.01) : au.smoo;

widen(l, r) = l * (1 + width) / 2 + r * (1 - width) / 2, r * (1 + width) / 2 + l * (1 - width) / 2;
fv = par(i, 2, *(0.015)) : re.stereo_freeverb(room, 0.5, damp, 23) : widen;

process = au.wetdry(fv);
