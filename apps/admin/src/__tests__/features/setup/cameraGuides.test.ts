import {
  cameraGuideView,
  connectivitySummary,
  freshnessLabel,
  riskyPairs,
  visibleGuides,
} from '@/features/setup/cameraGuides';
import type {
  CoverageGuideItem,
  CoveragePairItem,
  GuideDirection,
  PairGrade,
} from '@/features/setup/types';
import { describe, expect, it } from 'vitest';

const DB_IDS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const AI_IDS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

const pair = (
  a: string,
  b: string,
  grade: PairGrade,
  centroids: Pick<CoveragePairItem, 'centroid_a' | 'centroid_b'> = {
    centroid_a: null,
    centroid_b: null,
  },
): CoveragePairItem => ({
  a,
  b,
  raw_matches: null,
  inliers: null,
  inlier_ratio: null,
  grade,
  ...centroids,
});

const guide = (
  camera_id: string,
  pairIds: [string, string],
  reason_code: CoverageGuideItem['reason_code'] = 'WEAK_PAIR_EDGE_CLUSTER',
  direction: GuideDirection = 'RIGHT',
  magnitude: CoverageGuideItem['magnitude'] = 'SMALL',
): CoverageGuideItem => ({ camera_id, pair: pairIds, direction, magnitude, reason_code });

describe('보일 안내 거르기', () => {
  it('옆 카메라 쌍의 안내만 남기고 마주 보는 쌍(대각)의 안내는 숨긴다', () => {
    const guides = [
      guide('cam_A', ['cam_A', 'cam_B']),
      guide('cam_A', ['cam_A', 'cam_C']),
      guide('cam_D', ['cam_D', 'cam_A']),
      guide('cam_B', ['cam_B', 'cam_D']),
    ];
    expect(visibleGuides(DB_IDS, guides, []).map((g) => g.pair)).toEqual([
      ['cam_A', 'cam_B'],
      ['cam_D', 'cam_A'],
    ]);
  });

  it('선택 보강(OPTIONAL_IMPROVE)은 숨기되 그 쌍 등급이 LACK 이면 쌍 순서와 상관없이 보인다', () => {
    const optional = guide('cam_B', ['cam_B', 'cam_C'], 'OPTIONAL_IMPROVE');
    const enough = [pair('cam_B', 'cam_C', 'ENOUGH')];
    const weak = [pair('cam_B', 'cam_C', 'WEAK')];
    const lackReversed = [pair('cam_C', 'cam_B', 'LACK')];
    expect(visibleGuides(DB_IDS, [optional], enough)).toEqual([]);
    expect(visibleGuides(DB_IDS, [optional], weak)).toEqual([]);
    expect(visibleGuides(DB_IDS, [optional], [])).toEqual([]);
    expect(visibleGuides(DB_IDS, [optional], lackReversed)).toEqual([optional]);
  });

  it('겹치는 곳 없음(NO_OVERLAP_VISIBLE)과 그 밖의 이유 코드는 등급과 상관없이 보인다', () => {
    const noOverlap = guide('cam_B', ['cam_B', 'cam_C'], 'NO_OVERLAP_VISIBLE', 'NONE', 'NONE');
    const edge = guide('cam_C', ['cam_C', 'cam_D']);
    const pairs = [pair('cam_B', 'cam_C', 'ENOUGH'), pair('cam_C', 'cam_D', 'ENOUGH')];
    expect(visibleGuides(DB_IDS, [noOverlap, edge], pairs)).toEqual([noOverlap, edge]);
  });

  it('카메라 id 가 cam_A..D 여도 같은 순서 규칙으로 거른다', () => {
    const guides = [guide('cam_D', ['cam_D', 'cam_A']), guide('cam_A', ['cam_A', 'cam_C'])];
    expect(visibleGuides(AI_IDS, guides, [])).toEqual([guides[0]]);
  });
});

describe('보정이 실패할 수 있는 쌍', () => {
  it('옆 쌍 가운데 등급이 LACK 인 쌍만 돌려준다(마주 보는 쌍·다른 등급 제외)', () => {
    const pairs = [
      pair('cam_A', 'cam_B', 'ENOUGH'),
      pair('cam_A', 'cam_C', 'LACK'),
      pair('cam_B', 'cam_C', 'LACK'),
      pair('cam_B', 'cam_D', 'LACK'),
      pair('cam_C', 'cam_D', 'WEAK'),
      pair('cam_D', 'cam_A', 'LACK'),
      pair('cam_A', 'cam_D', 'UNKNOWN'),
    ];
    expect(riskyPairs(DB_IDS, pairs).map((p) => `${p.a}–${p.b}`)).toEqual([
      'cam_B–cam_C',
      'cam_D–cam_A',
    ]);
  });

  it('위험한 쌍이 없으면 빈 배열이다', () => {
    expect(riskyPairs(DB_IDS, [pair('cam_A', 'cam_B', 'WEAK')])).toEqual([]);
    expect(riskyPairs(DB_IDS, [])).toEqual([]);
  });
});

describe('카메라 연결 요약과 신선도', () => {
  const split = [
    ['cam_A', 'cam_B'],
    ['cam_C', 'cam_D'],
  ];

  it('연결·확인 중·갈림 세 가지를 문구로 만든다', () => {
    expect(connectivitySummary(DB_IDS, 'CONNECTED', [DB_IDS], null)).toBe('4대 모두 연결');
    expect(connectivitySummary(DB_IDS, 'UNKNOWN', [DB_IDS], null)).toBe('연결 확인 중');
    expect(connectivitySummary(DB_IDS, 'DISCONNECTED', split, null)).toBe(
      '카메라 1·카메라 2 / 카메라 3·카메라 4 갈림',
    );
    expect(
      connectivitySummary(AI_IDS, 'DISCONNECTED', [['cam_A', 'cam_B', 'cam_C'], ['cam_D']], null),
    ).toBe('카메라 1·카메라 2·카메라 3 / 카메라 4 갈림');
  });

  it('연결된 카메라 수는 카메라 목록 길이를 센다', () => {
    expect(connectivitySummary(['cam_A', 'cam_B', 'cam_C'], 'CONNECTED', [], null)).toBe(
      '3대 모두 연결',
    );
  });

  it('확인 시각은 서버가 준 age_ms 로 세어 뒤에 붙이고 1초 안이면 방금이라 한다', () => {
    expect(freshnessLabel(0)).toBe('방금');
    expect(freshnessLabel(999)).toBe('방금');
    expect(freshnessLabel(1000)).toBe('1초 전 확인');
    expect(freshnessLabel(3400)).toBe('3초 전 확인');
    expect(connectivitySummary(DB_IDS, 'CONNECTED', [DB_IDS], 400)).toBe('4대 모두 연결 · 방금');
    expect(connectivitySummary(DB_IDS, 'DISCONNECTED', split, 2600)).toBe(
      '카메라 1·카메라 2 / 카메라 3·카메라 4 갈림 · 2초 전 확인',
    );
  });
});

describe('카메라 안내 문장과 영상 위 표시 값', () => {
  const view = (
    direction: GuideDirection,
    magnitude: CoverageGuideItem['magnitude'],
    reason: CoverageGuideItem['reason_code'] = 'WEAK_PAIR_EDGE_CLUSTER',
  ) =>
    cameraGuideView(AI_IDS, guide('cam_B', ['cam_B', 'cam_C'], reason, direction, magnitude), []);

  it('방향과 크기로 문장을 만들고 쌍 이름을 괄호로 붙인다(카메라 이름은 넣지 않는다)', () => {
    expect(view('RIGHT', 'MORE').text).toBe('오른쪽으로 더 돌려 주세요 (카메라 2–카메라 3)');
    expect(view('LEFT', 'SMALL').text).toBe('왼쪽으로 조금 돌려 주세요 (카메라 2–카메라 3)');
    // 받침 없는 방향(위·아래)은 '로', 받침 있는 방향(왼쪽·오른쪽)은 '으로'.
    expect(view('UP', 'MORE').text).toBe('위로 더 돌려 주세요 (카메라 2–카메라 3)');
    expect(view('DOWN', 'SMALL').text).toBe('아래로 조금 돌려 주세요 (카메라 2–카메라 3)');
    expect(view('UP', 'NONE').text).toBe('위로 돌려 주세요 (카메라 2–카메라 3)');
  });

  it('방향이 없거나 겹치는 곳 없음이면 각도 조정·무늬 있는 물건을 안내하고 꺾쇠는 그리지 않는다', () => {
    const none = view('NONE', 'NONE', 'NO_OVERLAP_VISIBLE');
    expect(none.text).toBe(
      '겹치는 곳이 없습니다. 각도를 조정하거나 겹치는 곳에 무늬 있는 물건을 두세요 (카메라 2–카메라 3)',
    );
    expect(none.direction).toBe('NONE');
    // 서버가 방향을 같이 줘도 겹치는 곳이 없다는 안내와 모순되는 꺾쇠는 그리지 않는다.
    const withDirection = view('RIGHT', 'MORE', 'NO_OVERLAP_VISIBLE');
    expect(withDirection.text).toBe(none.text);
    expect(withDirection.direction).toBe('NONE');
  });

  it('같이 보는 곳은 그 카메라 쪽 centroid 이고(쌍 순서 무관) 이웃 이름과 함께 준다', () => {
    const centroids: Pick<CoveragePairItem, 'centroid_a' | 'centroid_b'> = {
      centroid_a: [0.7, 0.5],
      centroid_b: [0.2, 0.4],
    };
    const pairs = [pair('cam_B', 'cam_C', 'WEAK', centroids)];
    const asA = cameraGuideView(AI_IDS, guide('cam_B', ['cam_B', 'cam_C']), pairs);
    expect(asA.spot).toEqual([0.7, 0.5]);
    expect(asA.neighborLabel).toBe('카메라 3');
    const asB = cameraGuideView(AI_IDS, guide('cam_C', ['cam_C', 'cam_B']), pairs);
    expect(asB.spot).toEqual([0.2, 0.4]);
    expect(asB.neighborLabel).toBe('카메라 2');
    expect(view('RIGHT', 'SMALL').spot).toBeNull();
  });
});
