import { describe, expect, it } from 'vitest';

import { formatBadge } from '@/lib/badge';

describe('formatBadge', () => {
  it('întoarce numărul neschimbat până la 9 inclusiv', () => {
    expect(formatBadge(0)).toBe(0);
    expect(formatBadge(1)).toBe(1);
    expect(formatBadge(9)).toBe(9);
  });

  it('plafonează la „9+” de la 10 în sus', () => {
    expect(formatBadge(10)).toBe('9+');
    expect(formatBadge(250)).toBe('9+');
  });
});
