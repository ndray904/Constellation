declare name "Aurora Zita";
declare description "Fons Adriaensen's zita-rev1, re.zita_rev1_stereo from the Faust standard library (Julius O. Smith III, STK-4.3)";
// zita's own predelay (rdel) jumps when changed, so it is set to 0 and
// aurora.lib's gliding predelay goes in front instead.
au = library("aurora.lib");
import("stdfaust.lib");

pre = hslider("Predelay [unit:ms]", 40, 0, 100, 1);
f1 = hslider("Low X [unit:Hz] [scale:log]", 200, 50, 1000, 1) : au.smoo;
f2 = hslider("Damping [unit:Hz] [scale:log]", 6000, 1500, 20000, 1) : au.smoo;
t60dc = hslider("Low decay [unit:s] [scale:log]", 3, 1, 8, 0.1) : au.smoo;
t60m = hslider("Mid decay [unit:s] [scale:log]", 2, 1, 8, 0.1) : au.smoo;

process = au.wetdry(au.predelay(pre) : re.zita_rev1_stereo(0, f1, f2, t60dc, t60m, 96000));
