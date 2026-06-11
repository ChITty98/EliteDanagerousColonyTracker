/**
 * parseBoxel — splits a procedural name into its boxel + index, the basis for
 * sequence-gap scouting (Col 173 AX-J d9-52 → boxel "…d9", index 52).
 */
import { describe, it, expect } from 'vitest';
import { parseBoxel, parseMassCode } from '../src/lib/starNaming';

describe('parseBoxel', () => {
  it('splits name → boxel, prefix, mass code, index', () => {
    expect(parseBoxel('Col 173 Sector AX-J d9-52')).toEqual({
      boxel: 'Col 173 Sector AX-J d9', prefix: 'Col 173 Sector AX-J d9-', massCode: 'd', index: 52,
    });
  });
  it('works for other regions / mass codes', () => {
    expect(parseBoxel('Praea Euq SF-Y c1-3')).toEqual({
      boxel: 'Praea Euq SF-Y c1', prefix: 'Praea Euq SF-Y c1-', massCode: 'c', index: 3,
    });
  });
  it('returns null for catalog / named systems', () => {
    expect(parseBoxel('HIP 47126')).toBeNull();
    expect(parseBoxel('Sol')).toBeNull();
    expect(parseBoxel('')).toBeNull();
  });
  it('mass code agrees with parseMassCode', () => {
    expect(parseBoxel('Col 173 Sector AX-J d9-52').massCode).toBe(parseMassCode('Col 173 Sector AX-J d9-52'));
  });
});
