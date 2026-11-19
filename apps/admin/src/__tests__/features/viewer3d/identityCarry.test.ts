import {
  aliasOwners,
  identityUncertainSince,
  pureMergeBase,
} from '@/features/viewer3d/data/identityCarry';
import type { TrackView, WorldFrame } from '@/features/viewer3d/data/spatialFrame';
import { describe, expect, it } from 'vitest';

type Track = Pick<
  TrackView,
  'worldId' | 'aliases' | 'identityConfidence' | 'identityRevision' | 'splitFrom'
>;
const frame = (t: number, tracks: Track[], since?: Map<string, number>) =>
  ({
    tLatestGlobal: t,
    tracks: tracks as unknown as TrackView[],
    ...(since ? { identityUncertainSince: since } : {}),
  }) as unknown as WorldFrame;
const track = (worldId: string, over: Partial<Track> = {}): Track => ({
  worldId,
  aliases: [],
  identityConfidence: 'HIGH',
  identityRevision: 0,
  splitFrom: null,
  ...over,
});

describe('aliasOwners', () => {
  it('흡수된 ID 를 지금 그 사람의 World ID 로 잇고 자기 ID 는 무시한다', () => {
    const owners = aliasOwners([track('w-1', { aliases: ['w-2', 'w-1'] }), track('w-3')]);
    expect([...owners]).toEqual([['w-2', 'w-1']]);
  });
});

describe('identityUncertainSince', () => {
  it('같은 차수로 이어진 불확실은 시작 시각을 잇고, 차수가 바뀌거나 풀리면 새로 센다', () => {
    const first = identityUncertainSince(
      null,
      frame(1000, [track('w-1', { identityConfidence: 'IDENTITY_UNCERTAIN' })]),
    );
    expect(first.get('w-1')).toBe(1000);
    const prev = frame(
      1000,
      [track('w-1', { identityConfidence: 'IDENTITY_UNCERTAIN' })],
      new Map(first),
    );
    const same = identityUncertainSince(
      prev,
      frame(1400, [track('w-1', { identityConfidence: 'IDENTITY_UNCERTAIN' })]),
    );
    expect(same.get('w-1')).toBe(1000);
    const bumped = identityUncertainSince(
      prev,
      frame(1500, [
        track('w-1', { identityConfidence: 'IDENTITY_UNCERTAIN', identityRevision: 1 }),
      ]),
    );
    expect(bumped.get('w-1')).toBe(1500);
    expect(identityUncertainSince(prev, frame(1600, [track('w-1')])).size).toBe(0);
  });
});

describe('pureMergeBase (-743)', () => {
  const withBase = (t: number, tracks: Track[], base: Map<string, number>) =>
    ({ ...frame(t, tracks), pureMergeBase: base }) as WorldFrame;

  it('별칭만 붙은 차수 상승은 사슬 시작 차수를 남기고, 같은 차수 동안 잇고, 연쇄 병합도 처음 차수를 유지한다', () => {
    const merged = pureMergeBase(
      frame(1000, [track('w-1')]),
      frame(1100, [track('w-1', { identityRevision: 1, aliases: ['w-2'] })]),
    );
    expect([...merged]).toEqual([['w-1', 0]]);
    const prev = withBase(
      1100,
      [track('w-1', { identityRevision: 1, aliases: ['w-2'] })],
      new Map(merged),
    );
    expect(
      pureMergeBase(
        prev,
        frame(1200, [track('w-1', { identityRevision: 1, aliases: ['w-2'] })]),
      ).get('w-1'),
    ).toBe(0);
    expect(
      pureMergeBase(
        prev,
        frame(1300, [track('w-1', { identityRevision: 3, aliases: ['w-2', 'w-3'] })]),
      ).get('w-1'),
    ).toBe(0);
  });

  it('분할·별칭 없는 상승·별칭 순서 변화·split_from 변화·같은 차수 분할 겹침은 값이 없다', () => {
    const prev = frame(1000, [track('w-1', { aliases: ['w-2'] })]);
    const cases: Track[][] = [
      [track('w-1', { identityRevision: 1, aliases: ['w-2'] })],
      [track('w-1', { identityRevision: 1, aliases: ['w-3', 'w-2'] })],
      [track('w-1', { identityRevision: 1, aliases: ['w-2', 'w-3'], splitFrom: 'w-9' })],
      [
        track('w-1', { identityRevision: 1, aliases: ['w-2', 'w-3'] }),
        track('w-5', { identityRevision: 1, splitFrom: 'w-1' }),
      ],
    ];
    for (const tracks of cases)
      expect(pureMergeBase(prev, frame(1100, tracks)).has('w-1')).toBe(false);
    expect(pureMergeBase(null, frame(1100, [track('w-1')])).size).toBe(0);
  });
});
