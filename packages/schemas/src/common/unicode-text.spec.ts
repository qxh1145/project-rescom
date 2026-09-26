import {
  removeLoneSurrogates,
  replaceLoneSurrogates,
  truncateText,
} from './unicode-text';
import * as rootExports from '../index';

describe('unicode text helpers (Epic 9 review P8/P9)', () => {
  it('is exported from the package root', () => {
    expect(rootExports.removeLoneSurrogates).toBe(removeLoneSurrogates);
    expect(rootExports.replaceLoneSurrogates).toBe(replaceLoneSurrogates);
    expect(rootExports.truncateText).toBe(truncateText);
  });

  it('removes lone high and low surrogates but keeps valid pairs', () => {
    expect(removeLoneSurrogates('a\uD83Db')).toBe('ab');
    expect(removeLoneSurrogates('a\uDE00b')).toBe('ab');
    expect(removeLoneSurrogates('\uD83D')).toBe('');
    expect(removeLoneSurrogates('ok 😀 \uDE00\uD83D')).toBe('ok 😀 ');
    expect(removeLoneSurrogates('Tiếng Việt 👩‍💻')).toBe(
      'Tiếng Việt 👩‍💻',
    );
  });

  it('replaces lone surrogates with U+FFFD', () => {
    expect(replaceLoneSurrogates('x\uD83D')).toBe('x�');
    expect(replaceLoneSurrogates('\uDE00y😀')).toBe('�y😀');
  });

  it('truncates without splitting a surrogate pair', () => {
    const text = `${'a'.repeat(76)}😀😀😀😀😀`;
    const truncated = truncateText(text, 80);
    expect(truncated).toBe(`${'a'.repeat(76)}...`);
    expect(truncated.length).toBeLessThanOrEqual(80);
    expect(replaceLoneSurrogates(truncated)).toBe(truncated);

    const shifted = truncateText(`${'a'.repeat(75)}😀😀😀😀😀`, 80);
    expect(shifted).toBe(`${'a'.repeat(75)}😀...`);
    expect(shifted.length).toBe(80);
  });

  it('keeps text within the limit unchanged and counts UTF-16 units', () => {
    expect(truncateText('ngắn', 10)).toBe('ngắn');
    expect(truncateText('😀😀', 4)).toBe('😀😀');
    expect(truncateText('abcdef', 5, '…')).toBe('abcd…');
    expect(truncateText('x'.repeat(600), 500)).toHaveLength(500);
  });
});
