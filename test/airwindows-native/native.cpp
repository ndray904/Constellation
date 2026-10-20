// Native reference for test/airwindows-parity.cjs: one Airwindows plugin built
// from the same unmodified sources, with the real C math library.
// Usage: AW_INPUT=<file> native <sampleRate> <frames> [paramIndex value]...
// AW_INPUT holds blocks of 128 left then 128 right float32 samples; the output
// (stdout) is the same layout.
#include AW_HEADER
#include <cstdio>
#include <cstdlib>

// rand()*UINT32_MAX seeds the plugins' dither PRNG. 1 gives UINT32_MAX, the seed
// the wasm build gets (as on ARM, where the overflowing conversion saturates).
int aw_rand(void) { return 1; }

int main(int argc, char** argv) {
  float sampleRate = atof(argv[1]);
  int frames = atoi(argv[2]);
  AW_CLASS* fx = new AW_CLASS(nullptr);
  fx->setSampleRate(sampleRate);
  for (int i = 3; i + 1 < argc; i += 2) fx->setParameter(atoi(argv[i]), atof(argv[i + 1]));
  FILE* in = fopen(getenv("AW_INPUT"), "rb");
  static float inL[128], inR[128], outL[128], outR[128];
  float* ins[2] = { inL, inR };
  float* outs[2] = { outL, outR };
  for (int pos = 0; pos < frames; pos += 128) {
    if (fread(inL, 4, 128, in) != 128 || fread(inR, 4, 128, in) != 128) return 1;
    fx->processReplacing(ins, outs, 128);
    fwrite(outL, 4, 128, stdout);
    fwrite(outR, 4, 128, stdout);
  }
  return 0;
}
