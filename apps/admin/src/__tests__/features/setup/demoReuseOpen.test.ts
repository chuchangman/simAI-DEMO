import { demoReuseOpen, demoReuseShown } from '@/features/demo/demoSetup';
import type { ReuseChoiceState, ReuseMapOption } from '@/features/setup/useReuseScene';
import { describe, expect, it } from 'vitest';

// 시연 계정의 이전 맵 재사용: 보이는 맵(최근 2개)을 시점 확인·추천 없이 고른다(서버 SetupDemoAccounts 와 같은 판정)

const map = (overrides: Partial<ReuseMapOption>): ReuseMapOption => ({
  id: 'm',
  dateLabel: '11-17(화) 16:38',
  completedAtMs: 0,
  selectable: false,
  recommended: false,
  status: 'UNCONFIRMED',
  note: '카메라 위치를 확인하고 있어요',
  heightsLabel: '2.41·2.42 m',
  ...overrides,
});

const state = (overrides: Partial<ReuseChoiceState>): ReuseChoiceState => ({
  checking: false,
  blocked: { what: '카메라가 바뀐 것 같아요', how: '새 맵 만들기를 골라 주세요' },
  note: null,
  changedCameras: [],
  maps: [],
  recommendedId: null,
  ...overrides,
});

describe('demoReuseOpen', () => {
  it('제외가 아닌 맵은 상태와 관계없이 고를 수 있고 추천 표시·상태 문구가 없으며, 기본 선택은 가장 최근 맵이다', () => {
    const opened = demoReuseOpen(
      state({
        maps: [
          map({
            id: 'match',
            status: 'MATCH',
            selectable: true,
            recommended: true,
            completedAtMs: 100,
          }),
          map({
            id: 'changed',
            status: 'CHANGED',
            completedAtMs: 300,
            note: '카메라 배치가 그때와 달라요',
          }),
          map({ id: 'shifted', status: 'SHIFTED', completedAtMs: 200 }),
        ],
        recommendedId: 'match',
      }),
    );
    expect(opened.blocked).toBeNull();
    expect(opened.maps.every((m) => m.selectable && !m.recommended && m.note === '')).toBe(true);
    expect(opened.recommendedId).toBe('changed');
  });

  it('보정이 없거나 완료 전인 맵(EXCLUDED)은 그대로 꺼 두고 이유를 남긴다', () => {
    const excluded = map({
      id: 'x',
      status: 'EXCLUDED',
      note: '세팅 완료까지 하지 않은 맵이에요',
      completedAtMs: 900,
    });
    const opened = demoReuseOpen(
      state({ maps: [excluded, map({ id: 'ok', status: 'UNCONFIRMED', completedAtMs: 10 })] }),
    );
    expect(opened.maps[0]).toEqual(excluded);
    expect(opened.recommendedId).toBe('ok');
  });

  it('고를 맵이 하나도 없으면 막는 이유를 그대로 둔다', () => {
    const blocked = { what: '이전 맵이 없어요', how: '새 맵 만들기를 골라 주세요' };
    const opened = demoReuseOpen(state({ blocked, maps: [map({ status: 'EXCLUDED' })] }));
    expect(opened.blocked).toEqual(blocked);
    expect(opened.recommendedId).toBeNull();
  });
});

describe('demoReuseShown', () => {
  it('재사용이면 이전 맵을 최근 순으로 둘만, 새 맵이면 목록 없이 보인다', () => {
    const maps = [1, 5, 3, 4, 2].map((n) => map({ id: `m${n}`, completedAtMs: n }));
    expect(demoReuseShown(state({ maps }), 'REUSE').maps.map((m) => m.id)).toEqual(['m5', 'm4']);
    expect(demoReuseShown(state({ maps }), 'NEW').maps).toEqual([]);
  });
});
