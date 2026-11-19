import { cssHex, PALETTE, type ViewerTheme } from '@/features/viewer3d/palette';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 3D 장면은 CSS 토큰을 읽지 못해 색표(palette.ts)에 값을 따로 둔다. 위험·경고·주의 값이 packages/ui 토큰과
// 같은지 맞춰 보고, 한쪽만 바뀌어 화면마다 색이 달라지는 것을 막는다. CSS 를 `?raw` 로 불러오면 Tailwind 가
// 먼저 풀어 쓰므로 파일을 그대로 읽는다.
const GLOBALS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../packages/ui/src/styles/globals.css',
);
const globals = readFileSync(GLOBALS_CSS, 'utf-8');

/** 테마마다 토큰이 선언된 CSS 블록: 화이트는 `:root, .paper`, 다크는 `.dark`. */
const BLOCK: Record<ViewerTheme, RegExp> = {
  light: /:root,\s*\.paper\s*\{([^}]*)\}/,
  dark: /\.dark\s*\{([^}]*)\}/,
};

function token(theme: ViewerTheme, name: string): string {
  const block = BLOCK[theme].exec(globals)?.[1] ?? '';
  const declared = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
  if (!declared) throw new Error(`${theme} 에서 --${name} 토큰을 찾지 못했다`);
  return declared.toLowerCase();
}

const LEVELS = [
  ['CRITICAL', 'sev-critical'],
  ['HIGH', 'sev-high'],
  ['CAUTION', 'sev-caution'],
] as const;

describe('3D 색표와 CSS 심각도 토큰', () => {
  describe.each(['dark', 'light'] as const)('%s', (theme) => {
    it.each(LEVELS)('%s 색은 %s 토큰과 같다', (level, name) => {
      expect(cssHex(PALETTE[theme].risk[level].color)).toBe(token(theme, name));
    });
  });

  it('위험·경고·주의 색은 서로 다르다', () => {
    for (const theme of ['dark', 'light'] as const) {
      const colors = LEVELS.map(([level]) => PALETTE[theme].risk[level].color);
      expect(new Set(colors).size).toBe(LEVELS.length);
    }
  });
});
