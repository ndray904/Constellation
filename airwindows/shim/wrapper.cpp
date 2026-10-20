// C interface around one Airwindows plugin, compiled to WebAssembly together
// with that plugin's unmodified .cpp / Proc.cpp. Build with
//   -DAW_HEADER='"Galactic3.h"' -DAW_CLASS=Galactic3
// The host (an AudioWorklet) calls init(sampleRate), writes up to AW_BLOCK
// frames into inL/inR, calls process(n) and reads outL/outR.
#include AW_HEADER

#define AW_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define AW_BLOCK 128

// ---- the little runtime a freestanding build needs -------------------------
extern "C" unsigned char __heap_base;
static unsigned char* heapTop = &__heap_base;

void* operator new(size_t size) {
  unsigned char* p = (unsigned char*)(((size_t)heapTop + 15) & ~(size_t)15);
  heapTop = p + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if ((size_t)heapTop > have) __builtin_wasm_memory_grow(0, ((size_t)heapTop - have + 65535) / 65536);
  // fresh wasm memory is zeroed, so the instance starts cleared
  return p;
}
void operator delete(void*) noexcept {}
void operator delete(void*, size_t) noexcept {}

extern "C" void* calloc(size_t count, size_t size) { return operator new(count * size); }

// Only used as "fpd = rand()*UINT32_MAX" to seed the plugins' dither PRNG. Any
// rand() > 1 overflows that conversion, which saturates to UINT32_MAX here (and
// on ARM); returning 1 gives that same seed without relying on the overflow.
extern "C" int rand(void) { return 1; }

// ---- plugin interface ------------------------------------------------------
static AW_CLASS* fx = nullptr;
static float bufInL[AW_BLOCK], bufInR[AW_BLOCK], bufOutL[AW_BLOCK], bufOutR[AW_BLOCK];
static char text[64];

AW_EXPORT(init) void init(float sampleRate) {
  fx = new AW_CLASS(nullptr);
  fx->setSampleRate(sampleRate);
}
AW_EXPORT(inL) float* inL() { return bufInL; }
AW_EXPORT(inR) float* inR() { return bufInR; }
AW_EXPORT(outL) float* outL() { return bufOutL; }
AW_EXPORT(outR) float* outR() { return bufOutR; }
AW_EXPORT(numParams) int numParams() { return kNumParameters; }
AW_EXPORT(setParam) void setParam(int i, float v) { fx->setParameter(i, v); }
AW_EXPORT(getParam) float getParam(int i) { return fx->getParameter(i); }
AW_EXPORT(paramName) const char* paramName(int i) { text[0] = 0; fx->getParameterName(i, text); return text; }
AW_EXPORT(paramDisplay) const char* paramDisplay(int i) { text[0] = 0; fx->getParameterDisplay(i, text); return text; }
AW_EXPORT(paramLabel) const char* paramLabel(int i) { text[0] = 0; fx->getParameterLabel(i, text); return text; }
AW_EXPORT(process) void process(int frames) {
  float* in[2] = { bufInL, bufInR };
  float* out[2] = { bufOutL, bufOutR };
  fx->processReplacing(in, out, frames);
}
