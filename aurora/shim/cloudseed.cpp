// Aurora "Cloud Seed": the open-source core of Ghost Note Audio's Cloud Seed
// reverb (aurora/src/cloudseed, unmodified, MIT), wrapped in the C interface of
// wrapper.h. It starts from the core's one bundled program (Dark Plate) and
// puts nine of its 45 parameters on knobs. Not made or endorsed by Ghost Note
// Audio.
//
// Its parameters apply at once, and a jump in Size or Predelay moves the delay
// taps: a click. The other reverbs' cure (crossfading to a copy of the running
// reverb) would mean copying this one's 65 MB of buffers per change, so here
// every knob glides instead: the wrapper runs the reverb in 16-sample chunks
// and moves each parameter a little toward its target before each chunk, the
// way a tape delay's time knob bends the pitch rather than jumping.
//
// Build with -DBUFFER_SIZE=128 -DMAX_STR_SIZE=32 (see its Readme) and
// -include cmath: its headers expect <cmath> to arrive through other includes.
#include "runtime.h"
#include "rand.h"
#include "text.h"
#include "wrapper.h"
#include "DSP/ReverbController.h"
#include "Programs.h"

using namespace Cloudseed;

static ReverbController* fx;
static float sampleRate = 48000;

// Knob -> CloudSeed parameter. Mix is the wrapper's own dry/wet: the core's
// dry output is switched off.
enum { kMix, kPredelay, kSize, kDecay, kDiffusion, kModDepth, kModRate, kLowCut, kHighCut, kCount };
static const char* const names[kCount] = { "Mix", "Predelay", "Size", "Decay", "Diffusion", "Mod depth", "Mod rate", "Low cut", "High cut" };
static const int target[kCount] = { -1, Parameter::TapPredelay, Parameter::LateLineSize, Parameter::LateLineDecay,
  Parameter::LateDiffuseFeedback, Parameter::LateLineModAmount, Parameter::LateLineModRate, Parameter::LowCut, Parameter::HighCut };
static float params[kCount];       // targets, as set
static float current[kCount];      // where the reverb is now, gliding to params
static float mixNow;               // per-sample smoothed Mix

static const int kChunk = 16;
static float glideStep;            // per chunk: the full 0-1 range in 0.3 s
// Size and Predelay are delay times, so they glide by time instead: at most
// 0.25 ms per ms (a pitch bend of up to 25% while they move). Faster bends
// click again (test/aurora.cjs).
static const double kBend = 0.25;
static bool isTime(int i) { return i == kPredelay || i == kSize; }

AW_EXPORT(init) void init(float rate) {
  sampleRate = rate;
  initPrograms();
  fx = new ReverbController((int)rate);
  for (int i = 0; i < Parameter::COUNT; i++) fx->SetParameter(i, ProgramDarkPlate[i]);
  fx->SetParameter(Parameter::DryOut, 0.0);          // -30 dB: off
  fx->SetParameter(Parameter::HighCutEnabled, 1.0);
  fx->SetParameter(Parameter::HighCut, 1.0);         // 20 kHz: open
  fx->SetSamplerate((int)rate);
  fx->ClearBuffers();
  params[kMix] = 0.4f;
  for (int i = 1; i < kCount; i++) params[i] = (float)fx->GetAllParameters()[target[i]];
  for (int i = 0; i < kCount; i++) current[i] = params[i];
  mixNow = params[kMix];
  glideStep = kChunk / (0.3f * rate);
}
AW_EXPORT(numParams) int numParams() { return kCount; }
AW_EXPORT(setParam) void setParam(int i, float v) { params[i] = v; }
AW_EXPORT(getParam) float getParam(int i) { return params[i]; }
AW_EXPORT(paramName) const char* paramName(int i) { return names[i]; }
AW_EXPORT(paramDisplay) const char* paramDisplay(int i) {
  if (i == kMix) return number(params[i] * 100, 0, "%");
  double s = ScaleParam(params[i], target[i]);
  switch (i) {
    case kPredelay: case kSize: return number(s, 0, " ms");
    case kDecay: return s < 10 ? number(s, 2, " s") : number(s, 1, " s");
    case kDiffusion: return number(s * 100, 0, "%");
    case kModDepth: return number(s, 2, "");
    case kModRate: return number(s, 2, " Hz");
    default: return s < 1000 ? number(s, 0, " Hz") : number(s / 1000, 1, " kHz");
  }
}
AW_EXPORT(paramLabel) const char* paramLabel(int) { return ""; }
AW_EXPORT(process) void process(int frames) {
  for (int start = 0; start < frames; start += kChunk) {
    int n = frames - start < kChunk ? frames - start : kChunk;
    for (int i = 1; i < kCount; i++) {
      float d = params[i] - current[i];
      if (d == 0) continue;
      float step = glideStep;
      if (isTime(i)) {
        double ms = ScaleParam(current[i], target[i]);
        double slope = (ScaleParam(current[i] + 0.001f, target[i]) - ms) / 0.001;   // ms per knob unit
        double maxMs = kBend * n * 1000.0 / sampleRate;
        if (slope > 0 && maxMs / slope < step) step = (float)(maxMs / slope);
      }
      current[i] = d > step ? current[i] + step : d < -step ? current[i] - step : params[i];
      fx->SetParameter(target[i], current[i]);
    }
    fx->Process(bufInL + start, bufInR + start, bufOutL + start, bufOutR + start, n);
  }
  float k = 1 - expf(-1 / (0.02f * sampleRate));   // 20 ms
  for (int i = 0; i < frames; i++) {
    mixNow += (params[kMix] - mixNow) * k;
    bufOutL[i] = bufInL[i] * (1 - mixNow) + bufOutL[i] * mixNow;
    bufOutR[i] = bufInR[i] * (1 - mixNow) + bufOutR[i] * mixNow;
  }
}
