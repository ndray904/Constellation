declare name "Aurora Greyhole";
declare description "Julian Parker's Greyhole, re.greyhole from the Faust standard library (MIT)";
au = library("aurora.lib");
import("stdfaust.lib");

dt = hslider("Delay [unit:s] [scale:log]", 0.2, 0.01, 1.45, 0.001);   // greyhole glides delay and size itself
damp = hslider("Damping", 0.1, 0, 0.99, 0.001) : au.smoo;
size = hslider("Size", 2, 0.5, 3, 0.01);
diff = hslider("Diffusion", 0.707, 0, 0.99, 0.001) : au.smoo;
fb = hslider("Feedback", 0.7, 0, 1, 0.01) : au.smoo;
depth = hslider("Mod depth", 0.1, 0, 1, 0.01) : au.smoo;
rate = hslider("Mod rate [unit:Hz]", 2, 0, 10, 0.01) : au.smoo;

process = au.wetdry(re.greyhole(dt, damp, size, diff, fb, depth, rate));
