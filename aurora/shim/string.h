// Declarations only: the reverbs' text formatting (never called here) names them.
#ifndef AURORA_SHIM_STRING_H
#define AURORA_SHIM_STRING_H
#include <stddef.h>
extern "C" {
void* memcpy(void*, const void*, size_t);
void* memmove(void*, const void*, size_t);
void* memset(void*, int, size_t);
size_t strlen(const char*);
char* strcpy(char*, const char*);
int strcpy_s(char*, size_t, const char*);
}
#endif
