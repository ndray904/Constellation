declare name "Aurora Plate";
declare description "Dattorro plate reverb, re.dattorro_rev from the Faust standard library (Jakob Zerbian, STK-4.3)";
// re.dattorro_rev keeps the delay lengths of Dattorro's paper in samples (for
// 29.8 kHz), so at 48 kHz the plate is about 60% of the paper's size. Its own
// predelay is an integer delay that would jump, so aurora.lib's gliding one
// goes in front instead.
au = library("aurora.lib");
import("stdfaust.lib");

pre = hslider("Predelay [unit:ms]", 0, 0, 200, 1);
decay = hslider("Decay", 0.6, 0, 0.99, 0.01) : au.smoo;
damping = hslider("Damping", 0.2, 0, 0.9, 0.01) : au.smoo;
bandwidth = hslider("Tone", 0.9995, 0.1, 0.9999, 0.0001) : au.smoo;
diffusion = hslider("Diffusion", 0.75, 0, 0.9, 0.01) : au.smoo;

process = au.wetdry(au.predelay(pre) : re.dattorro_rev(0, bandwidth, diffusion, diffusion * 0.625 / 0.75, decay, 0.7, 0.5, damping));
