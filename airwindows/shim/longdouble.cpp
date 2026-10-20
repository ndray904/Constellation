// On wasm32, long double is IEEE binary128, and its arithmetic needs runtime
// helpers (normally from compiler-rt) that a freestanding build doesn't have.
// The plugins only touch long double in their 32-bit floating-point dither
// (a "5.5e-36l" constant). These helpers do that arithmetic in double, which
// is exactly what happens where long double *is* double (Apple Silicon, ARM,
// MSVC), so the results match those platforms bit for bit.
#include <stdint.h>

struct Quad { uint64_t lo, hi; };   // binary128, little-endian

static Quad toQuad(double x) {
  uint64_t d = __builtin_bit_cast(uint64_t, x);
  uint64_t sign = d >> 63, mant = d & ((1ull << 52) - 1);
  int exp = (int)((d >> 52) & 0x7ff);
  Quad q = { 0, sign << 63 };
  if (exp == 0 && mant == 0) return q;                       // +/-0
  if (exp == 0x7ff) {                                        // inf / nan
    q.hi |= (0x7fffull << 48) | (mant >> 4);
    q.lo = mant << 60;
    return q;
  }
  int e = exp - 1023;
  if (exp == 0) {                                            // subnormal: normalise
    e = -1022;
    while (!(mant & (1ull << 52))) { mant <<= 1; e--; }
    mant &= (1ull << 52) - 1;
  }
  q.hi |= ((uint64_t)(e + 16383) << 48) | (mant >> 4);
  q.lo = mant << 60;
  return q;
}

static double toDouble(Quad q) {
  uint64_t sign = q.hi >> 63;
  int qexp = (int)((q.hi >> 48) & 0x7fff);
  uint64_t mant = ((q.hi & 0xffffffffffffull) << 4) | (q.lo >> 60);   // top 52 mantissa bits
  if (qexp == 0) return __builtin_bit_cast(double, sign << 63);        // binary128 subnormal: below double range
  if (qexp == 0x7fff) return __builtin_bit_cast(double, (sign << 63) | (0x7ffull << 52) | mant);
  int e = qexp - 16383;
  if (e > 1023) return __builtin_bit_cast(double, (sign << 63) | (0x7ffull << 52));
  if (e >= -1022) return __builtin_bit_cast(double, (sign << 63) | ((uint64_t)(e + 1023) << 52) | mant);
  if (e < -1075) return __builtin_bit_cast(double, sign << 63);
  // double subnormal: scale a normal value down
  double v = __builtin_bit_cast(double, ((uint64_t)(e + 1023 + 64) << 52) | mant) * 5.421010862427522e-20;  // 2^-64
  return sign ? -v : v;
}

static long double q2ld(Quad q) { return __builtin_bit_cast(long double, q); }
static Quad ld2q(long double x) { return __builtin_bit_cast(Quad, x); }
static double ld2d(long double x) { return toDouble(ld2q(x)); }

extern "C" {
long double __extenddftf2(double a) { return q2ld(toQuad(a)); }
long double __extendsftf2(float a) { return q2ld(toQuad(a)); }
double __trunctfdf2(long double a) { return ld2d(a); }
float __trunctfsf2(long double a) { return (float)ld2d(a); }
long double __addtf3(long double a, long double b) { return q2ld(toQuad(ld2d(a) + ld2d(b))); }
long double __subtf3(long double a, long double b) { return q2ld(toQuad(ld2d(a) - ld2d(b))); }
long double __multf3(long double a, long double b) { return q2ld(toQuad(ld2d(a) * ld2d(b))); }
long double __divtf3(long double a, long double b) { return q2ld(toQuad(ld2d(a) / ld2d(b))); }
}
