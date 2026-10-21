// libm for the freestanding WebAssembly build. floor/fabs/sqrt/ceil/trunc map to
// single wasm instructions; the rest are imported from the host: musl's libm built
// to wasm (libm/, see web/faust-runtime.js), the same way the Faust modules get theirs.
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

// C's fmax/fmin: a NaN argument loses to a number.
inline double fmax(double x, double y) { return x != x ? y : y != y ? x : x > y ? x : y; }
inline double fmin(double x, double y) { return x != x ? y : y != y ? x : x < y ? x : y; }
inline float fmaxf(float x, float y) { return x != x ? y : y != y ? x : x > y ? x : y; }
inline float fminf(float x, float y) { return x != x ? y : y != y ? x : x < y ? x : y; }

// fma(a, b, c) = a*b + c with a single rounding, as libm gives it. wasm has no
// fused multiply-add, so: the exact product (Dekker), an exact sum, and the
// remainder rounded to odd before the final rounding, which makes the result
// correctly rounded (Boldo & Melquiond, "Emulation of FMA and correctly rounded
// sums: proved algorithms using rounding to odd", IEEE Trans. Computers 2008).
// Valid away from overflow and the subnormal range, which audio never reaches;
// there it falls back to a*b + c.
inline void aw_twoSum(double a, double b, double& s, double& e) {
  s = a + b;
  double bb = s - a;
  e = (a - (s - bb)) + (b - bb);
}
inline double fma(double a, double b, double c) {
  double p = a * b;
  if (!(__builtin_fabs(p) < 1e300 && __builtin_fabs(p) > 1e-280 && __builtin_fabs(c) < 1e300)) return p + c;
  const double split = 134217729.0;   // 2^27 + 1
  double ta = split * a, ah = ta - (ta - a), al = a - ah;
  double tb = split * b, bh = tb - (tb - b), bl = b - bh;
  double pe = ((ah * bh - p) + ah * bl + al * bh) + al * bl;   // a*b = p + pe exactly
  double th, tl;
  aw_twoSum(c, p, th, tl);
  double v, ve;                                                // v = tl + pe, rounded to odd
  aw_twoSum(tl, pe, v, ve);
  if (ve != 0) {
    unsigned long long u = __builtin_bit_cast(unsigned long long, v);
    if (!(u & 1)) v = __builtin_bit_cast(double, (ve > 0) == (v > 0) ? u + 1 : u - 1);
  }
  return th + v;
}
inline float fmaf(float a, float b, float c) { return (float)((double)a * b + c); }   // exact product in double

inline double floor(double x) { return __builtin_floor(x); }
inline double ceil(double x) { return __builtin_ceil(x); }
inline double fabs(double x) { return __builtin_fabs(x); }
inline double sqrt(double x) { return __builtin_sqrt(x); }
inline double trunc(double x) { return __builtin_trunc(x); }
inline float fabsf(float x) { return __builtin_fabsf(x); }
inline float sqrtf(float x) { return __builtin_sqrtf(x); }

// float versions, computed in double and rounded once
inline float sinf(float x) { return (float)sin(x); }
inline float cosf(float x) { return (float)cos(x); }
inline float tanf(float x) { return (float)tan(x); }
inline float expf(float x) { return (float)exp(x); }
inline float logf(float x) { return (float)log(x); }
inline float log10f(float x) { return (float)log10(x); }
inline float powf(float x, float y) { return (float)pow(x, y); }
inline float fmodf(float x, float y) { return (float)fmod(x, y); }
inline float tanhf(float x) { return (float)tanh(x); }
inline float floorf(float x) { return __builtin_floorf(x); }
inline float ceilf(float x) { return __builtin_ceilf(x); }

#endif
