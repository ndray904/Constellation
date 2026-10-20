// The C interface every reverb module exports (the same as the Airwindows
// wrapper's), so one AudioWorklet host runs them all. The host calls
// init(sampleRate), writes up to AW_BLOCK frames into inL/inR, calls process(n)
// and reads outL/outR. Parameters are 0-1.
#ifndef AURORA_SHIM_WRAPPER_H
#define AURORA_SHIM_WRAPPER_H

#ifdef __wasm__
#define AW_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#else
#define AW_EXPORT(name) extern "C"   // native build for test/aurora-parity.cjs
#endif
#define AW_BLOCK 128

static float bufInL[AW_BLOCK], bufInR[AW_BLOCK], bufOutL[AW_BLOCK], bufOutR[AW_BLOCK];
AW_EXPORT(inL) float* inL() { return bufInL; }
AW_EXPORT(inR) float* inR() { return bufInR; }
AW_EXPORT(outL) float* outL() { return bufOutL; }
AW_EXPORT(outR) float* outR() { return bufOutR; }

#endif
