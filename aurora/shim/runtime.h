// The little runtime a freestanding C++ build needs: an allocator and the C
// library calls the compiler emits.
//
// Small blocks come in power-of-two sizes and go back on a free list when
// deleted: CloudSeed rebuilds a small seed table every time Size or Decay
// moves, so without reuse a knob glide would leak megabytes a second. Big
// blocks (the reverbs themselves, allocated once) are carved off the top of
// the heap at their exact size and never returned. Fresh wasm memory is
// zeroed, and reused blocks are cleared, so new objects always start zeroed.
#ifndef AURORA_SHIM_RUNTIME_H
#define AURORA_SHIM_RUNTIME_H
#ifdef __wasm__   // a native build (test/aurora-parity.cjs) uses the real C library

#include <stddef.h>

extern "C" unsigned char __heap_base;
static unsigned char* heapTop = &__heap_base;

static const int kHeader = 16;                  // keeps blocks 16-byte aligned
static const int kBigBin = 255;
static const int kMaxSmallBin = 20;             // up to 1 MB
static void* freeLists[kMaxSmallBin + 1];

static unsigned char* carve(size_t size) {
  unsigned char* p = (unsigned char*)(((size_t)heapTop + 15) & ~(size_t)15);
  heapTop = p + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if ((size_t)heapTop > have) __builtin_wasm_memory_grow(0, ((size_t)heapTop - have + 65535) / 65536);
  return p;
}

void* operator new(size_t size) {
  size_t need = size + kHeader;
  int bin = 4;
  while (bin <= kMaxSmallBin && ((size_t)1 << bin) < need) bin++;
  unsigned char* block;
  if (bin > kMaxSmallBin) {
    block = carve(need);
    bin = kBigBin;
  } else if (freeLists[bin]) {
    block = (unsigned char*)freeLists[bin];
    freeLists[bin] = *(void**)block;
    __builtin_memset(block, 0, (size_t)1 << bin);
  } else {
    block = carve((size_t)1 << bin);
  }
  *(int*)block = bin;
  return block + kHeader;
}
void* operator new[](size_t size) { return operator new(size); }
void operator delete(void* p) noexcept {
  if (!p) return;
  unsigned char* block = (unsigned char*)p - kHeader;
  int bin = *(int*)block;
  if (bin == kBigBin) return;
  *(void**)block = freeLists[bin];
  freeLists[bin] = block;
}
void operator delete(void* p, size_t) noexcept { operator delete(p); }
void operator delete[](void* p) noexcept { operator delete(p); }
void operator delete[](void* p, size_t) noexcept { operator delete(p); }

extern "C" {
void* memcpy(void* dst, const void* src, size_t n) { return __builtin_memcpy(dst, src, n); }
void* memmove(void* dst, const void* src, size_t n) { return __builtin_memmove(dst, src, n); }
void* memset(void* dst, int c, size_t n) { return __builtin_memset(dst, c, n); }
}

#endif  // __wasm__
#endif
