declare name "Aurora JPverb";
declare description "Julian Parker's JPverb, re.jpverb from the Faust standard library (MIT)";
au = library("aurora.lib");
import("stdfaust.lib");

t60 = hslider("Decay [unit:s] [scale:log]", 3, 0.1, 60, 0.01) : au.smoo;
damp = hslider("Damping", 0.2, 0, 0.999, 0.001) : au.smoo;
size = hslider("Size", 1, 0.5, 5, 0.01);              // jpverb glides its size itself
diff = hslider("Diffusion", 0.707, 0, 0.99, 0.001) : au.smoo;
depth = hslider("Mod depth", 0.1, 0, 1, 0.01) : au.smoo;
rate = hslider("Mod rate [unit:Hz]", 2, 0, 10, 0.01) : au.smoo;

process = au.wetdry(re.jpverb(t60, damp, size, diff, depth, rate, 1, 1, 1, 500, 2000));
