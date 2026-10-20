// Declarations only: CloudSeed's FormatParameter (unused here) names snprintf.
#ifndef AURORA_SHIM_STDIO_H
#define AURORA_SHIM_STDIO_H
#include <stddef.h>
extern "C" int snprintf(char*, size_t, const char*, ...);
#endif
