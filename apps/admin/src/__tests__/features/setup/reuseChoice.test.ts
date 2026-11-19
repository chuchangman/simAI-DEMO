import type { ReuseCandidate, ReuseCheck } from '@/features/setup/types';
import {
  changedCamerasLabel,
  changedCamerasOf,
  chosenReuseMap,
  mapDateLabel,
  reuseChoiceOf,
  reuseMapsOf,
} from '@/features/setup/useReuseScene';
import { describe, expect, it } from 'vitest';

// 1단계 「이전 맵 재사용」 판정 → 화면 문구(S15P31A101-689)

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const check = (overrides: Partial<ReuseCheck>): ReuseCheck => ({
  available: true,
  blocked_reason: null,
  scene_version: 'scene-1',
  camera_status: 'NOT_DETECTED',
  changed_cameras: [],
  camera_source: null,
  ...overrides,
});

describe('reuseChoiceOf', () => {
  it('고를 수 있으면 막지 않고, 카메라 변화를 모를 때만 시작 뒤 확인 한 줄을 붙인다', () => {
    expect(reuseChoiceOf(check({}), CAMS)).toEqual({ blocked: null, note: null });
    expect(reuseChoiceOf(check({ camera_status: 'UNKNOWN' }), CAMS)).toEqual({
      blocked: null,
      note: '카메라가 그대로인지는 시작한 뒤 확인해요',
    });
  });

  it('이전 맵 없음·World 어긋남·카메라 변화는 무엇이/어떻게 두 줄로 막는다', () => {
    expect(
      reuseChoiceOf(check({ available: false, blocked_reason: 'NO_SCENE' }), CAMS).blocked,
    ).toEqual({ what: '이전 맵이 없어요', how: '새 맵 만들기를 골라 주세요' });
    expect(
      reuseChoiceOf(check({ available: false, blocked_reason: 'SCENE_MISMATCH' }), CAMS).blocked
        ?.what,
    ).toBe('이전 맵이 지금 카메라 보정과 맞지 않아요');
    expect(
      reuseChoiceOf(
        check({
          available: false,
          blocked_reason: 'CAMERA_CHANGED',
          camera_status: 'CHANGED',
          changed_cameras: ['cam_B', 'cam_D'],
        }),
        CAMS,
      ).blocked?.what,
    ).toBe('카메라 2·카메라 4의 위치나 방향이 직전 세팅과 달라졌어요');
    expect(
      reuseChoiceOf(
        check({ available: false, blocked_reason: 'CAMERA_CHANGED', camera_status: 'CHANGED' }),
        CAMS,
      ).blocked?.what,
    ).toBe('카메라 배치가 직전 세팅과 달라졌어요');
    // 모르는 사유는 확인하지 못한 것으로 막는다(서버도 시작을 거절한다)
    expect(
      reuseChoiceOf(check({ available: false, blocked_reason: 'SOMETHING' }), CAMS).blocked?.what,
    ).toBe('이전 맵을 확인하지 못했어요');
  });

  it('현장 목록에 없는 카메라 ID 는 번호를 지어내지 않고 원문 그대로 둔다', () => {
    expect(changedCamerasLabel(CAMS, ['cam_C', 'cam_X'])).toBe('카메라 3·cam_X');
  });

  it('1단계 시점 확인(VIEW_MATCH)이 막으면 「카메라가 바뀐 것 같아요」와 이전 맵 화면과 다르다는 이유를 보인다(S15P31A101-712)', () => {
    const changed = check({
      available: false,
      blocked_reason: 'CAMERA_CHANGED',
      camera_status: 'CHANGED',
      changed_cameras: ['cam_B', 'cam_C'],
      camera_source: 'VIEW_MATCH',
    });
    expect(reuseChoiceOf(changed, CAMS).blocked).toEqual({
      what: '카메라가 바뀐 것 같아요(카메라 2·카메라 3)',
      how: '이전 맵을 만들 때와 화면이 달라요 · 새 맵 만들기를 골라 주세요',
    });
    expect(changedCamerasOf(changed)).toEqual(['cam_B', 'cam_C']);
    expect(reuseChoiceOf({ ...changed, changed_cameras: [] }, CAMS).blocked?.what).toBe(
      '카메라가 바뀐 것 같아요',
    );
  });
});

// 재사용 맵 고르기(S15P31A101-714)
describe('reuse maps', () => {
  const candidate = (id: string, overrides: Partial<ReuseCandidate> = {}): ReuseCandidate => ({
    setup_session_id: id,
    scene_version: `scene-${id}`,
    completed_at_ms: Date.UTC(2026, 10, 12, 6, 20),
    camera_heights_m: { cam_A: 2.41, cam_B: 2.42, cam_C: 2.47, cam_D: 2.48 },
    status: 'MATCH',
    reason: null,
    selectable: true,
    recommended: false,
    changed_cameras: [],
    shifted_cameras: [],
    unconfirmed_cameras: [],
    camera_source: null,
    ...overrides,
  });

  it('한국 시간 날짜·요일·시각으로 보인다', () => {
    expect(mapDateLabel(Date.UTC(2026, 10, 12, 6, 20))).toBe('11-12(목) 15:20');
    expect(mapDateLabel(Date.UTC(2026, 10, 14, 16, 5))).toBe('11-15(일) 01:05');
  });

  it('상태마다 한 줄 이유를 보이고 MATCH 만 고를 수 있다', () => {
    const maps = reuseMapsOf(
      check({
        candidates: [
          candidate('a', { recommended: true }),
          candidate('b', { status: 'SHIFTED', selectable: false, shifted_cameras: ['cam_D'] }),
          candidate('c', { status: 'UNCONFIRMED', selectable: false, reason: 'NO_PHOTOS' }),
          candidate('d', {
            status: 'UNCONFIRMED',
            selectable: false,
            reason: 'CHECKING',
            unconfirmed_cameras: ['cam_A'],
          }),
          candidate('e', { status: 'EXCLUDED', selectable: false, reason: 'NOT_COMPLETED' }),
          candidate('f', { status: 'CHANGED', selectable: false, changed_cameras: [] }),
        ],
      }),
      CAMS,
    );
    expect(maps.map((m) => m.selectable)).toEqual([true, false, false, false, false, false]);
    expect(maps[0]).toMatchObject({
      recommended: true,
      note: '카메라가 그때와 같은 자리예요',
      heightsLabel: '2.41·2.42·2.47·2.48 m',
    });
    expect(maps[1]!.note).toBe('그때보다 조금 돌아간 카메라: 카메라 4');
    expect(maps[2]!.note).toBe('그 맵의 카메라 사진이 없어 확인할 수 없어요');
    expect(maps[3]!.note).toBe('확인하고 있는 카메라: 카메라 1');
    expect(maps[4]!.note).toBe('세팅 완료까지 하지 않은 맵이에요');
    expect(maps[5]!.note).toBe('카메라 배치가 그때와 달라요');
    // 옛 서버(목록 없음)는 빈 목록
    expect(reuseMapsOf(check({}), CAMS)).toEqual([]);
  });

  it('고른 맵이 아직 맞으면 그 맵, 어긋나면 추천 맵, 맞는 맵이 없으면 null', () => {
    const maps = reuseMapsOf(
      check({
        candidates: [
          candidate('a', { recommended: true }),
          candidate('b'),
          candidate('c', { status: 'CHANGED', selectable: false }),
        ],
      }),
      CAMS,
    );
    expect(chosenReuseMap(maps, null, 'a')).toBe('a');
    expect(chosenReuseMap(maps, 'b', 'a')).toBe('b');
    expect(chosenReuseMap(maps, 'c', 'a')).toBe('a');
    expect(chosenReuseMap(maps, 'c', null)).toBeNull();
  });

  it('맞는지 아직 모르면(VIEW_UNCONFIRMED) 확인 중이라고 막는다', () => {
    expect(
      reuseChoiceOf(check({ available: false, blocked_reason: 'VIEW_UNCONFIRMED' }), CAMS).blocked,
    ).toEqual({
      what: '카메라가 이전 맵 때와 같은 자리인지 확인하고 있어요',
      how: '카메라 앞을 비우고 잠시 기다리거나 새 맵 만들기를 골라 주세요',
    });
  });
});

describe('게이트웨이 헬퍼 끊김(S15P31A101-719)', () => {
  it('시점 확인을 기다리는 판정은 「확인하고 있어요」 대신 끊겨서 확인할 수 없다고 말한다', () => {
    const waiting = check({ available: false, blocked_reason: 'VIEW_UNCONFIRMED' });
    expect(reuseChoiceOf(waiting, CAMS, true).blocked).toEqual({
      what: '현장 게이트웨이와 연결이 끊겨 카메라 위치를 확인할 수 없어요',
      how: '게이트웨이 노트북이 켜져 있는지 확인하거나 새 맵 만들기를 골라 주세요',
    });
    expect(reuseChoiceOf(waiting, CAMS).blocked?.what).toBe(
      '카메라가 이전 맵 때와 같은 자리인지 확인하고 있어요',
    );
  });

  it('확인 중인 맵 한 줄도 끊김 이유로 바꾸고, 사진 없음·판정이 끝난 맵은 그대로 둔다', () => {
    const base = {
      scene_version: 's',
      completed_at_ms: 0,
      camera_heights_m: {},
      selectable: false,
      recommended: false,
      changed_cameras: [],
      shifted_cameras: [],
      unconfirmed_cameras: [],
      camera_source: null,
    };
    const maps = reuseMapsOf(
      check({
        candidates: [
          { ...base, setup_session_id: 'a', status: 'UNCONFIRMED', reason: null },
          { ...base, setup_session_id: 'b', status: 'UNCONFIRMED', reason: 'NO_PHOTOS' },
          { ...base, setup_session_id: 'c', status: 'EXCLUDED', reason: 'NOT_COMPLETED' },
        ],
      }),
      CAMS,
      true,
    );
    expect(maps.map((m) => m.note)).toEqual([
      '게이트웨이 연결이 끊겨 카메라 위치를 확인할 수 없어요',
      '그 맵의 카메라 사진이 없어 확인할 수 없어요',
      '세팅 완료까지 하지 않은 맵이에요',
    ]);
  });
});
