/* the two types musl's <math.h> asks for; wasm evaluates floats at their own precision (FLT_EVAL_METHOD 0) */
#if defined(__NEED_float_t) && !defined(__DEFINED_float_t)
typedef float float_t;
#define __DEFINED_float_t
#endif
#if defined(__NEED_double_t) && !defined(__DEFINED_double_t)
typedef double double_t;
#define __DEFINED_double_t
#endif
