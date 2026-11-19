import { useThemeStore } from '@/features/layout/theme.store';
import { beforeEach, describe, expect, it } from 'vitest';

describe('useThemeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' });
    document.documentElement.classList.add('dark');
  });

  it('다크에서 화이트로, 다시 다크로 바꾸고 html 의 dark 클래스를 맞춘다', () => {
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('고른 테마를 브라우저에 저장한다', () => {
    useThemeStore.getState().toggle();
    expect(JSON.parse(localStorage.getItem('simai.theme') ?? '{}').state.theme).toBe('light');
  });
});
