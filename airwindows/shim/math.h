// libm for the freestanding WebAssembly build. floor/fabs/sqrt/ceil/trunc map to
// single wasm instructions; the rest are imported from the host (Math.* in JS),
// the same way the Faust modules get theirs.
#ifndef AW_SHIM_MATH_H
#define AW_SHIM_MATH_H

#define AW_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

extern "C" {
AW_IMPORT(sin) double sin(double);
AW_IMPORT(cos) double cos(double);
AW_IMPORT(tan) double tan(double);
AW_IMPORT(asin) double asin(double);
AW_IMPORT(acos) double acos(double);
AW_IMPORT(atan) double atan(double);
AW_IMPORT(atan2) double atan2(double, double);
AW_IMPORT(sinh) double sinh(double);
AW_IMPORT(cosh) double cosh(double);
AW_IMPORT(tanh) double tanh(double);
AW_IMPORT(exp) double exp(double);
AW_IMPORT(log) double log(double);
AW_IMPORT(log10) double log10(double);
AW_IMPORT(pow) double pow(double, double);
AW_IMPORT(fmod) double fmod(double, double);
}

#define M_PI 3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962

// Exact frexpf (the plugins' 32-bit floating-point dither depends on it),
// including subnormals.
inline float frexpf(float x, int* e) {
  unsigned u = __builtin_bit_cast(unsigned, x);
  int ex = (u >> 23) & 0xff;
  if (ex == 0xff) { *e = 0; return x; }                 // inf / nan
  int bias = 126;
  if (ex == 0) {
    if ((u & 0x7fffffffu) == 0) { *e = 0; return x; }   // +/-0
    x *= 33554432.0f;                                    // 2^25: normalise the subnormal
    u = __builtin_bit_cast(unsigned, x);
    ex = (u >> 23) & 0xff;
    bias += 25;
  }
  *e = ex - bias;
  return __builtin_bit_cast(float, (u & 0x807fffffu) | (126u << 23));
}

inline double floor(double x) { return __builtin_floor(x); }
inline double ceil(double x) { return __builtin_ceil(x); }
inline double fabs(double x) { return __builtin_fabs(x); }
inline double sqrt(double x) { return __builtin_sqrt(x); }
inline double trunc(double x) { return __builtin_trunc(x); }
inline float fabsf(float x) { return __builtin_fabsf(x); }
inline float sqrtf(float x) { return __builtin_sqrtf(x); }

#endif
