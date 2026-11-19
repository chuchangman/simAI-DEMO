import {
  EMPTY_TRACK_LIFE,
  identityOf,
  knownLifeMs,
  noteWatched,
  noteWorldFrame,
  rootOf,
  type TrackLifeState,
} from '@/lib/trackLife';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;
const STEP = 100;

type Track = { world_id: string; track_lifecycle: string; aliases?: string[] };
const track = (world_id: string, aliases?: string[], track_lifecycle = 'CONFIRMED'): Track => ({
  world_id,
  track_lifecycle,
  ...(aliases ? { aliases } : {}),
});

/** 프레임을 100ms 간격으로 차례로 넣는다. */
function play(frames: Track[][], start = T, state: TrackLifeState = EMPTY_TRACK_LIFE) {
  return frames.reduce(
    (s, tracks, i) => noteWorldFrame(s, tracks as never, start + i * STEP),
    state,
  );
}

describe('noteWorldFrame', () => {
  it('이어서 받은 프레임에 생겼다 사라진 ID 는 생긴 때·끝난 때를 봤고 길이를 안다', () => {
    const s = play([
      [track('w-1')],
      [track('w-1'), track('w-2')],
      [track('w-1'), track('w-2')],
      [track('w-1')],
    ]);
    expect(s.lives['w-2']).toEqual({
      first: T + STEP,
      last: T + 2 * STEP,
      bornSeen: true,
      endSeen: true,
    });
    expect(knownLifeMs(s, ['w-2'])).toBe(STEP);
  });

  it('첫 프레임에 이미 있던 ID 는 언제 생겼는지 모르므로 길이를 모른다', () => {
    const s = play([[track('w-1')], [track('w-1')], []]);
    expect(s.lives['w-1']!.bornSeen).toBe(false);
    expect(knownLifeMs(s, ['w-1'])).toBeNull();
  });

  it('지금 보이는 ID 는 끝나지 않았으므로 길이를 모른다', () => {
    const s = play([[], [track('w-1')], [track('w-1')]]);
    expect(knownLifeMs(s, ['w-1'])).toBeNull();
  });

  it('프레임이 끊긴 뒤(1.5초 넘게) 나타나거나 사라진 ID 는 이어서 보지 못한 것으로 친다', () => {
    let s = play([[]]);
    s = noteWorldFrame(s, [track('w-1')] as never, T + 5_000);
    expect(s.lives['w-1']!.bornSeen).toBe(false);
    s = play([[], [track('w-2')]], T + 6_000, s);
    s = noteWorldFrame(s, [] as never, T + 60_000);
    expect(s.lives['w-2']!.endSeen).toBe(false);
    expect(knownLifeMs(s, ['w-2'])).toBeNull();
  });

  it('시계가 뒤로 가면(Tier 0 재시작) 이어서 보지 않은 것으로 친다', () => {
    const s = play([[], [track('w-1')]]);
    const back = noteWorldFrame(s, [track('w-9')] as never, T - 10_000);
    expect(back.lives['w-9']!.bornSeen).toBe(false);
  });

  it('LOST 트랙은 보인 것으로 치지 않는다', () => {
    const s = play([[], [track('w-1')], [track('w-1', undefined, 'LOST')]]);
    expect(s.lives['w-1']!.endSeen).toBe(true);
    expect(s.present).toEqual([]);
  });

  it('다시 보이면 끝난 표시를 지우고 마지막 시각을 늘린다', () => {
    const s = play([[], [track('w-1')], [], [track('w-1')]]);
    expect(s.lives['w-1']).toMatchObject({ first: T + STEP, last: T + 3 * STEP, endSeen: false });
  });

  it('병합(aliases)을 기억하고, 같은 사람의 ID 전부로 길이를 잰다', () => {
    const s = play([
      [],
      [track('w-1'), track('w-2')],
      [track('w-1', ['w-2'])],
      [track('w-3'), track('w-1', ['w-2'])],
      [track('w-3', ['w-1', 'w-2'])],
      [],
    ]);
    expect(rootOf(s, 'w-2')).toBe('w-3');
    expect(identityOf(s, 'w-2').sort()).toEqual(['w-1', 'w-2', 'w-3']);
    expect(knownLifeMs(s, identityOf(s, 'w-2'))).toBe(3 * STEP);
    // 병합 기록은 트랙이 사라져도 남는다
    expect(s.survivorOf).toEqual({ 'w-2': 'w-3', 'w-1': 'w-3' });
  });

  it('병합에 고리가 있어도 멈춘다', () => {
    expect(rootOf({ survivorOf: { a: 'b', b: 'a' } }, 'a')).toBe('b');
  });

  it('기록이 없는 ID 가 섞이면 길이를 모른다', () => {
    const s = play([[], [track('w-1')], []]);
    expect(knownLifeMs(s, ['w-1', 'w-x'])).toBeNull();
  });
});

describe('noteWatched', () => {
  it('워치가 배정된 ID 를 더하고, 새 ID 가 없으면 같은 기록을 돌려준다', () => {
    const s = noteWatched(EMPTY_TRACK_LIFE, ['w-1']);
    expect(s.watched).toEqual({ 'w-1': true });
    expect(noteWatched(s, ['w-1'])).toBe(s);
  });
});
