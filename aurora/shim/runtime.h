// The little runtime a freestanding C++ build needs: memory from a bump
// allocator (the reverb allocates once, at start-up) and the C library calls
// the compiler emits. Fresh wasm memory is zeroed, so new objects start cleared.
#ifndef AURORA_SHIM_RUNTIME_H
#define AURORA_SHIM_RUNTIME_H
#ifdef __wasm__   // a native build (test/aurora-parity.cjs) uses the real C library

#include <stddef.h>

extern "C" unsigned char __heap_base;
static unsigned char* heapTop = &__heap_base;

void* operator new(size_t size) {
  unsigned char* p = (unsigned char*)(((size_t)heapTop + 15) & ~(size_t)15);
  heapTop = p + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if ((size_t)heapTop > have) __builtin_wasm_memory_grow(0, ((size_t)heapTop - have + 65535) / 65536);
  return p;
}
void operator delete(void*) noexcept {}
void operator delete(void*, size_t) noexcept {}

extern "C" {
void* memcpy(void* dst, const void* src, size_t n) { return __builtin_memcpy(dst, src, n); }
void* memmove(void* dst, const void* src, size_t n) { return __builtin_memmove(dst, src, n); }
void* memset(void* dst, int c, size_t n) { return __builtin_memset(dst, c, n); }
}

#endif  // __wasm__
#endif
