// Native-build copy of airwindows/shim/audioeffectx.h for the parity test: real
// libc/libm and exceptions, and the same rand() seed as the wasm build.
// Minimal stand-in for the parts of the Steinberg VST2 SDK that the Airwindows
// LinuxVST sources use, so they compile unmodified to WebAssembly. Only what
// the plugins call is here; nothing talks to a VST host.
#ifndef __audioeffect__
#define __audioeffect__

#include <stdint.h>
#include <stddef.h>

typedef int32_t VstInt32;
typedef void* audioMasterCallback;

enum VstPlugCategory { kPlugCategUnknown = 0, kPlugCategEffect, kPlugCategSynth, kPlugCategRoomFx };

enum {
  kVstMaxProgNameLen = 24,
  kVstMaxParamStrLen = 8,
  kVstMaxVendorStrLen = 64,
  kVstMaxProductStrLen = 64,
  kVstMaxEffectNameLen = 32,
};

#include <cstdlib>
int aw_rand(void);
#define rand aw_rand   // same seed generator as the wasm build

// The plugins' setParameter ends in "default: throw; // unknown parameter,
// shouldn't happen!". Built without exceptions, that unreachable branch traps.
// (native: real exceptions)

class AudioEffect {
public:
  AudioEffect(audioMasterCallback, VstInt32, VstInt32) {}
  virtual ~AudioEffect() {}
  void setNumInputs(VstInt32) {}
  void setNumOutputs(VstInt32) {}
  void setUniqueID(VstInt32) {}
  void canProcessReplacing(bool = true) {}
  void canDoubleReplacing(bool = true) {}
  void programsAreChunks(bool = true) {}
  void setInitialDelay(VstInt32) {}
  void setSampleRate(float sr) { sampleRate = sr; }
  float getSampleRate() { return sampleRate; }
protected:
  float sampleRate = 44100.0f;
};

class AudioEffectX : public AudioEffect {
public:
  AudioEffectX(audioMasterCallback cb, VstInt32 progs, VstInt32 params) : AudioEffect(cb, progs, params) {}
};

AudioEffect* createEffectInstance(audioMasterCallback audioMaster);

// String helpers from the SDK (AudioEffect::vst_strncpy / float2string).
inline char* vst_strncpy(char* dst, const char* src, VstInt32 max) {
  VstInt32 i = 0;
  for (; i < max && src[i]; i++) dst[i] = src[i];
  dst[i] = 0;
  return dst;
}

// Fixed-point text with up to 3 decimals, enough for parameter displays.
inline void float2string(float value, char* text, VstInt32 max) {
  char buf[32];
  int n = 0;
  double v = value;
  if (v < 0) { buf[n++] = '-'; v = -v; }
  long long whole = (long long)v;
  int frac = (int)((v - (double)whole) * 1000.0 + 0.5);
  if (frac >= 1000) { whole += 1; frac -= 1000; }
  char digits[24];
  int d = 0;
  do { digits[d++] = (char)('0' + whole % 10); whole /= 10; } while (whole && d < 20);
  while (d) buf[n++] = digits[--d];
  buf[n++] = '.';
  buf[n++] = (char)('0' + frac / 100);
  buf[n++] = (char)('0' + (frac / 10) % 10);
  buf[n++] = (char)('0' + frac % 10);
  buf[n] = 0;
  vst_strncpy(text, buf, max);
}

#endif
