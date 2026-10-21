// Native build of the Aurora wrapper for test/aurora-parity.cjs: the few things
// the real C/C++ libraries spell differently from the wasm shims.
#include <cmath>
namespace std { using ::sinf; using ::expf; using ::sqrtf; using ::powf; using ::cosf; using ::tanf; using ::log10f; }
