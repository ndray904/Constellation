// Native reference for test/aurora-parity.cjs: an Aurora wrapper
// (aurora/shim/texture.cpp or cloudseed.cpp) built with the real C/C++
// libraries, driven the way the AudioWorklet host drives the wasm build.
// Usage: AW_INPUT=<file> native <sampleRate> <frames> [paramIndex value]...
// AW_INPUT holds blocks of 128 left then 128 right float32 samples; the output
// (stdout) is the same layout.
#include <cstdio>
#include <cstdlib>

extern "C" {
void init(float);
void setParam(int, float);
void process(int);
float* inL();
float* inR();
float* outL();
float* outR();
}

int main(int argc, char** argv) {
  float sampleRate = atof(argv[1]);
  int frames = atoi(argv[2]);
  init(sampleRate);
  for (int i = 3; i + 1 < argc; i += 2) setParam(atoi(argv[i]), atof(argv[i + 1]));
  FILE* in = fopen(getenv("AW_INPUT"), "rb");
  for (int pos = 0; pos < frames; pos += 128) {
    if (fread(inL(), 4, 128, in) != 128 || fread(inR(), 4, 128, in) != 128) return 1;
    process(128);
    fwrite(outL(), 4, 128, stdout);
    fwrite(outR(), 4, 128, stdout);
  }
  return 0;
}
