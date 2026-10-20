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

extern "C" int rand(void);
extern "C" void* calloc(size_t count, size_t size);   // only the (unused) preset-chunk code calls it

// The plugins' setParameter ends in "default: throw; // unknown parameter,
// shouldn't happen!". Built without exceptions, that unreachable branch traps.
#define throw __builtin_trap()

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

// String helpers from the SDK (AudioEffect::vst_strncpy / int2string / float2string).
inline char* vst_strncpy(char* dst, const char* src, VstInt32 max) {
  VstInt32 i = 0;
  for (; i < max && src[i]; i++) dst[i] = src[i];
  dst[i] = 0;
  return dst;
}

// Whole number as text, like the SDK's (which shows "Huge!" past 8 digits).
inline void int2string(VstInt32 value, char* text, VstInt32 max) {
  if (value >= 100000000) { vst_strncpy(text, "Huge!", max); return; }
  char buf[16];
  int n = 0;
  long long v = value;
  if (v < 0) { buf[n++] = '-'; v = -v; }
  char digits[12];
  int d = 0;
  do { digits[d++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (d) buf[n++] = digits[--d];
  buf[n] = 0;
  vst_strncpy(text, buf, max);
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
