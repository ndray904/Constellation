// Native build of the Aurora wrappers for test/aurora-parity.cjs: the few
// things the real C/C++ libraries spell differently from the wasm shims.
#include <cmath>
#include <cstdlib>
#include <cstring>
// the shared rand() (aurora/shim/rand.h) is the C standard's 15-bit one
#undef RAND_MAX
#define RAND_MAX 32767
namespace std { using ::sinf; using ::expf; using ::sqrtf; using ::powf; using ::cosf; using ::tanf; using ::log10f; }
// MSVC's strcpy_s, named by CloudSeed's (unused) FormatParameter
inline int strcpy_s(char* dst, size_t, const char* src) { strcpy(dst, src); return 0; }
