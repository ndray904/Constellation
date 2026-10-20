// Number-to-text for parameter displays, without printf.
#ifndef AURORA_SHIM_TEXT_H
#define AURORA_SHIM_TEXT_H

static char text[32];

// Appends v with `decimals` decimals (0-3) and then `unit` to text.
static const char* number(double v, int decimals, const char* unit) {
  int n = 0;
  if (v < 0) { text[n++] = '-'; v = -v; }
  int scale = decimals == 0 ? 1 : decimals == 1 ? 10 : decimals == 2 ? 100 : 1000;
  long long fixed = (long long)(v * scale + 0.5);
  long long whole = fixed / scale;
  int frac = (int)(fixed % scale);
  char digits[24];
  int d = 0;
  do { digits[d++] = (char)('0' + whole % 10); whole /= 10; } while (whole && d < 20);
  while (d) text[n++] = digits[--d];
  if (decimals) {
    text[n++] = '.';
    for (int s = scale / 10; s; s /= 10) { text[n++] = (char)('0' + (frac / s) % 10); }
  }
  for (int i = 0; unit[i] && n < 31; i++) text[n++] = unit[i];
  text[n] = 0;
  return text;
}

#endif
