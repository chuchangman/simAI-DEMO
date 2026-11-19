import { SoundButton, soundLabel } from '@/features/events/SoundButton';
import type { AlarmSoundState } from '@/lib/alarmSound';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 소리 엔진은 따로 시험한다(__tests__/lib/alarmSound.test.ts). 여기서는 엔진 상태에 따른 버튼 모양과 누름 연결만 본다.
const fake = vi.hoisted(() => {
  const initial = { ready: true, muted: false, want: null } as const;
  let snapshot: AlarmSoundState = initial;
  const listeners = new Set<() => void>();
  return {
    canAck: true,
    toggle: vi.fn(),
    reset: () => {
      snapshot = initial;
    },
    get: () => snapshot,
    set(next: Partial<AlarmSoundState>) {
      snapshot = { ...snapshot, ...next };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('@/lib/alarmSound', () => ({
  alarmSound: {
    subscribe: fake.subscribe,
    getSnapshot: fake.get,
    toggle: fake.toggle,
  },
}));
vi.mock('@/features/events/ack', () => ({ useCanAck: () => fake.canAck }));

const button = () => screen.getByRole('button');
const badge = () => button().querySelector('span:not(:first-child)');
const icon = () => button().querySelector('span:first-child')!;

beforeEach(() => {
  fake.canAck = true;
  fake.reset();
});

afterEach(() => {
  cleanup();
  fake.toggle.mockClear();
});

describe('soundLabel', () => {
  it('꺼짐은 차단 여부를 덧붙이고, 켜짐은 차단되면 차단됨이다', () => {
    expect(soundLabel(true, false)).toBe('경보 소리 꺼짐');
    expect(soundLabel(true, true)).toBe('경보 소리 꺼짐 · 차단됨');
    expect(soundLabel(false, true)).toBe('경보 소리 차단됨');
    expect(soundLabel(false, false)).toBe('경보 소리 켜짐');
  });
});

describe('SoundButton', () => {
  it('확인 권한이 없는 계정에는 그리지 않는다', () => {
    fake.canAck = false;
    const { container } = render(<SoundButton />);
    expect(container.firstChild).toBeNull();
  });

  it('켜져 있고 소리를 낼 수 있으면 「경보 소리 켜짐」, 눌린 상태, 배지 없음', () => {
    render(<SoundButton />);
    expect(button().getAttribute('aria-label')).toBe('경보 소리 켜짐');
    expect(button().getAttribute('title')).toBe('경보 소리 켜짐');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(badge()).toBeNull();
  });

  it('브라우저가 막고 있으면 「경보 소리 차단됨」이고 모서리에 !가 붙는다', () => {
    fake.set({ ready: false });
    render(<SoundButton />);
    expect(button().getAttribute('aria-label')).toBe('경보 소리 차단됨');
    expect(button().getAttribute('title')).toBe('경보 소리 차단됨');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(badge()?.textContent).toBe('!');
    // 「!」에 올리면 실제 뜻이 뜬다(-752)
    expect(badge()?.getAttribute('title')).toBe('소리 꺼짐 · 화면을 한 번 누르세요');
  });

  it('꺼져 있으면 「경보 소리 꺼짐」이고 눌리지 않은 상태, 막혀 있으면 ·차단됨을 덧붙인다', () => {
    fake.set({ muted: true });
    render(<SoundButton />);
    expect(button().getAttribute('aria-label')).toBe('경보 소리 꺼짐');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(badge()).toBeNull();

    act(() => fake.set({ ready: false }));
    expect(button().getAttribute('aria-label')).toBe('경보 소리 꺼짐 · 차단됨');
    expect(button().getAttribute('title')).toBe('경보 소리 꺼짐 · 차단됨');
    expect(badge()?.textContent).toBe('!');
  });

  it('엔진 상태가 바뀌면 그대로 따라 바뀐다', () => {
    render(<SoundButton />);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    act(() => fake.set({ muted: true }));
    expect(button().getAttribute('aria-pressed')).toBe('false');
    act(() => fake.set({ muted: false, ready: false }));
    expect(button().getAttribute('aria-label')).toBe('경보 소리 차단됨');
  });

  it('누르면 엔진의 toggle 을 부른다', () => {
    render(<SoundButton />);
    fireEvent.click(button());
    expect(fake.toggle).toHaveBeenCalledTimes(1);
  });

  it('울릴 경보가 있고 켜져 있을 때만 종이 흔들리고 빨강이며, 움직임 줄이기에서는 흔들리지 않는다', () => {
    render(<SoundButton />);
    expect(icon().className).not.toContain('animate-bell-ring');

    act(() => fake.set({ want: 'CRITICAL' }));
    expect(icon().className).toContain('motion-safe:animate-bell-ring');
    expect(icon().className).not.toMatch(/(^|\s)animate-bell-ring/);
    expect(button().className).toContain('text-sev-critical');

    // 울리는 등급이 경고면 종도 경고 색이다.
    act(() => fake.set({ want: 'HIGH' }));
    expect(button().className).toContain('text-sev-high');
    expect(button().className).not.toContain('text-sev-critical');

    act(() => fake.set({ muted: true }));
    expect(icon().className).not.toContain('animate-bell-ring');
    expect(button().className).not.toContain('text-sev-critical');
  });

  it('막힌 채 울릴 경보가 있을 때만 배지가 깜박이고, 깜박임은 움직임 줄이기에서 멈춘다', () => {
    fake.set({ ready: false });
    render(<SoundButton />);
    expect(badge()!.className).not.toContain('animate-pulse');

    act(() => fake.set({ want: 'HIGH' }));
    expect(badge()!.className).toContain('motion-safe:animate-pulse');
    expect(badge()!.className).not.toMatch(/(^|\s)animate-pulse/);
  });

  it('위험 등급(빨강·주황·노랑)·지연 색을 꺼짐·차단 표시에 쓰지 않는다', () => {
    fake.set({ muted: true, ready: false });
    render(<SoundButton />);
    expect(button().className).not.toMatch(/sev-|delay/);
    expect(badge()!.className).not.toMatch(/sev-|delay/);
  });
});
