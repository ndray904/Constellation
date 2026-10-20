// Aurora "Texture": the reverb from Emilie Gillet's Rings and Clouds Eurorack
// firmware (aurora/src/mutable, unmodified, MIT), wrapped in the C interface of
// wrapper.h. It's Rings' version, tuned for 48 kHz: at 44.1 kHz its delays run
// 9% longer. The tank stores samples as 16-bit, like the hardware's SRAM.
//
// Its settings act inside the feedback loop, so a jump in Time or Diffusion
// steps the tank and clicks. So, like cloudseed.cpp, the wrapper runs it in
// 16-sample chunks and moves each setting a little toward its knob before each.
#include "runtime.h"
#include "text.h"
#include "wrapper.h"
#include "rings/dsp/fx/reverb.h"

static uint16_t tank[32768];
static rings::Reverb* fx;

enum { kAmount, kTime, kDiffusion, kTone, kCount };
static const char* const names[kCount] = { "Amount", "Time", "Diffusion", "Tone" };
static float params[kCount] = { 0.5f, 0.5f, 0.65f, 0.6f };   // targets, as set
static float current[kCount] = { 0.5f, 0.5f, 0.65f, 0.6f };  // gliding to params
static const int kChunk = 16;
static float glideStep = kChunk / (0.2f * 48000);             // full range in 0.2 s

// Ranges follow Clouds' own settings: time 0.35 + 0.63 * amount, input gain
// 0.2, diffusion 0.625-0.7, lowpass 0.6 + 0.37 * feedback.
static float timeOf(float v) { return 0.35f + 0.63f * v; }
static float diffusionOf(float v) { return 0.3f + 0.5f * v; }
static float lpOf(float v) { return 0.3f + 0.67f * v; }

static void apply() {
  fx->set_amount(current[kAmount]);
  fx->set_input_gain(0.2f);
  fx->set_time(timeOf(current[kTime]));
  fx->set_diffusion(diffusionOf(current[kDiffusion]));
  fx->set_lp(lpOf(current[kTone]));
}

AW_EXPORT(init) void init(float rate) {
  glideStep = kChunk / (0.2f * rate);
  fx = new rings::Reverb();
  fx->Init(tank);
  apply();
}
AW_EXPORT(numParams) int numParams() { return kCount; }
AW_EXPORT(setParam) void setParam(int i, float v) { params[i] = v; }
AW_EXPORT(getParam) float getParam(int i) { return params[i]; }
AW_EXPORT(paramName) const char* paramName(int i) { return names[i]; }
AW_EXPORT(paramDisplay) const char* paramDisplay(int i) {
  switch (i) {
    case kAmount: return number(params[i] * 100, 0, "%");
    case kTime: return number(timeOf(params[i]), 2, "");
    case kDiffusion: return number(diffusionOf(params[i]), 2, "");
    default: return number(lpOf(params[i]), 2, "");
  }
}
AW_EXPORT(paramLabel) const char* paramLabel(int) { return ""; }
AW_EXPORT(process) void process(int frames) {
  for (int i = 0; i < frames; i++) { bufOutL[i] = bufInL[i]; bufOutR[i] = bufInR[i]; }
  for (int start = 0; start < frames; start += kChunk) {
    for (int i = 0; i < kCount; i++) {
      float d = params[i] - current[i];
      current[i] = d > glideStep ? current[i] + glideStep : d < -glideStep ? current[i] - glideStep : params[i];
    }
    apply();
    fx->Process(bufOutL + start, bufOutR + start, frames - start < kChunk ? frames - start : kChunk);
  }
}
