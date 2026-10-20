declare name "Aurora Annihilator";
declare description "Mode 4 of David Braun's Faust model of ValhallaSupermassive (massive.lib, MIT)";
// The model has its own dry/wet (equal-power) and width, so only aurora.lib's
// glide is used. Delay and Warp both set the delay lengths, so they slew (Warp
// across its range in 2 s, which keeps the longest line within aurora.lib's
// 25% bend); the rest ease in through au.smoo.
vs = library("massive.lib");
au = library("aurora.lib");
import("stdfaust.lib");

mix = hslider("Mix [unit:%]", 50, 0, 100, 1) / 100 : au.smoo;
delay = hslider("Delay [unit:ms] [scale:log]", 200, 1, 2000, 1) : au.slew(0.25 * 1000 / ma.SR);
warp = hslider("Warp", 0.3, 0, 1, 0.01) : au.slew(0.5 / ma.SR);
feedback = hslider("Feedback", 0.6, 0, 1, 0.01) : au.smoo;
density = hslider("Density", 0.3, 0, 1, 0.01) : au.smoo;
width = hslider("Width", 1, -1, 1, 0.01) : au.smoo;
lowcut = hslider("Low cut [unit:Hz] [scale:log]", 10, 10, 2000, 1) : au.smoo;
highcut = hslider("High cut [unit:Hz] [scale:log]", 20000, 200, 20000, 1) : au.smoo;
modrate = hslider("Mod rate [unit:Hz] [scale:log]", 0.5, 0.01, 10, 0.01) : au.smoo;
moddepth = hslider("Mod depth", 0.2, 0, 1, 0.01) : au.smoo;

process = vs.valhallaSupermassive(4, mix, delay, warp, feedback, density, width, lowcut, highcut, modrate, moddepth);
