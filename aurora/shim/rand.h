// The C standard's example rand() (ISO C 7.22.2), seeded at 1.
#ifndef AURORA_SHIM_RAND_H
#define AURORA_SHIM_RAND_H
static unsigned long auroraRandNext = 1;
extern "C" int rand(void) {
  auroraRandNext = auroraRandNext * 1103515245 + 12345;
  return (unsigned)(auroraRandNext / 65536) % 32768;
}
#endif
