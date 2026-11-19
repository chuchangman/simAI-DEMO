import { LoginHeadline, LoginHero, MASCOT_MEDIA } from '@/features/auth/LoginHero';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 움직임 줄이기 설정을 흉내 낸다. change 를 보내면 useMediaQuery 가 다시 읽는다.
function stubReducedMotion(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query === '(prefers-reduced-motion: reduce)' && matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return (next: boolean) => {
    matches = next;
    listeners.forEach((fn) => fn());
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginHero', () => {
  it('평소에는 마스코트 영상을 소리 없이 되풀이해 틀고, 장식이라 보조 기술에서 숨긴다', () => {
    stubReducedMotion(false);
    const { container } = render(<LoginHero />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.autoplay).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.getAttribute('aria-hidden')).toBe('true');
    expect(video?.getAttribute('poster')).toBe(MASCOT_MEDIA.poster);
    expect([...container.querySelectorAll('source')].map((s) => s.getAttribute('src'))).toEqual([
      MASCOT_MEDIA.webm,
      MASCOT_MEDIA.mp4,
    ]);
    expect(screen.queryByTestId('login-hero-poster')).toBeNull();
  });

  it('움직임 줄이기 설정이면 영상 없이 첫 장면만 보이고, 설정을 바꾸면 따라간다', () => {
    const setReduced = stubReducedMotion(true);
    const { container } = render(<LoginHero />);

    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByTestId('login-hero-poster').getAttribute('src')).toBe(MASCOT_MEDIA.poster);

    act(() => setReduced(false));
    expect(container.querySelector('video')).not.toBeNull();
    expect(screen.queryByTestId('login-hero-poster')).toBeNull();
  });

  it('헤드라인은 두 줄이다(왼쪽 폼 묶음에 둔다)', () => {
    render(<LoginHeadline />);

    expect(screen.getByText('현장은 입체적으로.')).toBeTruthy();
    expect(screen.getByText('위험은 한발 먼저.')).toBeTruthy();
  });

  it('장면 아래 기능 칩 세 개를 보인다(상태처럼 보이는 수치는 없다)', () => {
    stubReducedMotion(false);
    render(<LoginHero />);

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '3D 현장 재현',
      'AI 위험 감지',
      '워치 알림 연동',
    ]);
    expect(screen.getByTestId('login-hero-features').textContent).not.toMatch(/\d+\s*%|정상/);
  });

  it('영상은 장면 칸을 채운다(cover)', () => {
    stubReducedMotion(false);
    const { container } = render(<LoginHero />);

    const media = screen.getByTestId('login-hero-media');
    const video = container.querySelector('video');
    expect(media.contains(video)).toBe(true);
    expect(media.classList.contains('aspect-[9/16]')).toBe(true);
    expect(video?.classList.contains('object-cover')).toBe(true);
  });

  it('영상 재생 시간에 맞춰 해당 기능 칩만 강조한다', () => {
    stubReducedMotion(false);
    const { container } = render(<LoginHero />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const activeLabels = () =>
      screen
        .getAllByRole('listitem')
        .filter((item) => item.dataset.active === 'true')
        .map((item) => item.textContent);

    for (const [seconds, expected] of [
      [1, ['3D 현장 재현']],
      [5, ['AI 위험 감지']],
      [8, ['워치 알림 연동']],
      [10.3, []],
    ] as const) {
      Object.defineProperty(video, 'currentTime', { configurable: true, value: seconds });
      act(() => {
        video.dispatchEvent(new Event('timeupdate'));
      });
      expect(activeLabels()).toEqual(expected);
    }
  });

  it('움직임 줄이기 설정이면 기능 칩을 강조하지 않는다', () => {
    stubReducedMotion(true);
    render(<LoginHero />);

    expect(screen.getAllByRole('listitem').every((item) => item.dataset.active === 'false')).toBe(
      true,
    );
  });
});
