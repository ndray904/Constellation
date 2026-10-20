// rand() for reverbs that start their modulators at random phases. The wrapper
// defines it as the C standard's example generator (seeded at 1), and the
// native parity build defines the same one, so both see the same sequence.
#ifndef AURORA_SHIM_STDLIB_H
#define AURORA_SHIM_STDLIB_H
#define RAND_MAX 32767
extern "C" int rand(void);
#endif
