import { camerasInMessage, failureGuide, SETUP_FAILURES } from '@/features/setup/setupFailures';
import type { CameraCheck } from '@/features/setup/types';
import { describe, expect, it } from 'vitest';

const LETTERS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const LEGACY_NUMBERS = ['cam1', 'cam2', 'cam3', 'cam4'];

describe('세팅 실패 안내표(SETUP_FAILURES)', () => {
  it('같은 상태로 다시 시도해 볼 만한 실패만 다시 시도를 허용한다', () => {
    const retry = Object.fromEntries(Object.entries(SETUP_FAILURES).map(([k, v]) => [k, v.retry]));
    expect(retry).toEqual({
      BACKGROUND_INCOMPLETE: true,
      FLOOR_FIT_FAILED: false,
      INSUFFICIENT_FEATURES: false,
      VALIDATION_REJECTED: true,
      CAMERA_CHECK_NOT_PASSED: true,
      CAMERA_CHECK_UNAVAILABLE: true,
      TIMEOUT: true,
      SETUP_QUEUE_TIMEOUT: true,
      CANCELLED_BY_ADMIN: true,
      CANCELLED: true,
      LIVE_EXP_BLOCKED: true,
      INVALID_INPUT: false,
      INTERNAL_CONTRACT_ERROR: true,
      REUSE_WORLD_REJECTED: false,
      LEASE_EXPIRED: true,
    });
  });

  it('REUSE_WORLD_REJECTED: 달라진 카메라와 새 맵으로 다시 하기를 두 줄로 보인다(S15P31A101-689)', () => {
    const guide = failureGuide('REUSE_WORLD_REJECTED', 'cam_B 이(가) 직전 세팅과 달라져', LETTERS, [
      'cam_B',
      'cam_D',
    ]);
    expect(guide).toEqual({
      title: '카메라 2·카메라 4의 위치나 방향이 직전 세팅과 달라졌어요',
      fix: '새 맵으로 다시 하세요.',
      retry: false,
      newMap: true,
    });
    expect(failureGuide('REUSE_WORLD_REJECTED', null, LETTERS).title).toBe(
      '카메라를 직전 세팅과 맞추지 못해 이전 맵을 쓸 수 없어요',
    );
  });

  it.each([
    [
      'BACKGROUND_INCOMPLETE',
      '사람 없는 배경을 다 모으지 못했어요',
      '그 카메라 앞에서 사람과 장비가 비키고 영상이 들어오는지 확인한 뒤 다시 시도하세요.',
    ],
    [
      'FLOOR_FIT_FAILED',
      '바닥을 찾지 못했어요',
      '카메라 연결 관리에서 카메라 높이를 확인하고, 바닥이 영상에 넓게 보이게 맞춘 뒤 다시 시작하세요.',
    ],
    [
      'TIMEOUT',
      '시간이 너무 오래 걸렸어요 (15분)',
      '잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요.',
    ],
    ['CANCELLED_BY_ADMIN', '세팅을 취소했어요', '다시 시작하려면 다시 시도하세요.'],
    [
      'LEASE_EXPIRED',
      '분석 서버와 연결이 끊겼어요',
      '분석 서버가 켜져 있는지 확인한 뒤 다시 시도하세요.',
    ],
  ])('%s 는 원인과 해결을 준다', (code, title, fix) => {
    const guide = failureGuide(code, null, LETTERS);
    expect(guide.title).toBe(title);
    expect(guide.fix).toBe(fix);
    expect(guide.retry).toBe(SETUP_FAILURES[code]!.retry);
  });

  it('표에 없는 코드와 코드가 없는 실패는 폴백(다시 시도 가능)이다', () => {
    for (const code of ['RECONSTRUCT_FAILED', 'constructor', null]) {
      expect(failureGuide(code, 'whatever', LETTERS)).toEqual({
        title: '서버에서 세팅을 끝내지 못했어요',
        fix: '잠시 뒤 다시 시도하세요. 계속되면 관리자에게 알려 주세요.',
        retry: true,
        newMap: false,
      });
    }
  });
});

const check = (problems: CameraCheck['problems'], status: CameraCheck['status'] = 'FAILED') =>
  ({
    status,
    calibration_version: 'cal-1',
    progress_pct: 40,
    elapsed_s: 30,
    pairs: {},
    cameras: {},
    problems,
  }) as CameraCheck;

const problem = (reason: string, kind = 'CHECK', camera_ids: string[] = []) => ({
  kind,
  id: `${kind}-${reason}`,
  camera_ids,
  reason,
  message: reason,
});

describe('CAMERA_CHECK_NOT_PASSED: 걷기 창과 같은 원인을 첫 줄에(S15P31A101-719)', () => {
  it('사람이 안 보였으면 그 원인과 다시 걸을 방법을 보인다', () => {
    const guide = failureGuide(
      'CAMERA_CHECK_NOT_PASSED',
      '카메라 확인을 1번 걸었지만…',
      LETTERS,
      [],
      {
        cameraCheck: check([problem('NO_PERSON')]),
      },
    );
    expect(guide.title).toBe('어느 카메라에서도 사람이 보이지 않았습니다');
    expect(guide.fix).toContain('한 사람만 카메라 앞을 고루 지나가며 30초 걸어 주세요');
    expect(guide).toMatchObject({ retry: true, newMap: false });
  });

  it('덜 보인 카메라를 이름으로 짚는다', () => {
    const guide = failureGuide('CAMERA_CHECK_NOT_PASSED', null, LETTERS, [], {
      cameraCheck: check([problem('FEW_SAMPLES', 'CAMERA', ['cam_D'])], 'INCOMPLETE'),
    });
    expect(guide.title).toBe('카메라 4에서 사람이 충분히 보이지 않았습니다');
  });

  it('기하 실패는 카메라 위치 문제와 고정 뒤 다시 시도를 말한다', () => {
    const guide = failureGuide('CAMERA_CHECK_NOT_PASSED', null, LETTERS, [], {
      cameraCheck: check([problem('LOO_REPROJECTION', 'CAMERA', ['cam_B'])]),
    });
    expect(guide.title).toBe('카메라 2 위치가 보정과 맞지 않습니다');
    expect(guide.fix).toBe(
      '카메라와 거치대가 흔들리지 않게 고정한 뒤 다시 시도하세요(보정부터 다시 해요).',
    );
  });

  it('「걷기 시작」을 누르지 않아 끝났으면 그렇게 말한다(문제 사유·서버 문구 어느 쪽이든)', () => {
    const byProblem = failureGuide('CAMERA_CHECK_NOT_PASSED', null, LETTERS, [], {
      cameraCheck: check([problem('NOT_STARTED')], 'INCOMPLETE'),
    });
    const byMessage = failureGuide(
      'CAMERA_CHECK_NOT_PASSED',
      '카메라 확인을 「걷기 시작」을 받지 못해 맵을 만들지 않았습니다: …',
      LETTERS,
    );
    for (const guide of [byProblem, byMessage]) {
      expect(guide.title).toBe('「걷기 시작」을 누르지 않아 카메라 확인 시간이 지났어요');
      expect(guide.fix).toContain('「걷기 시작」을 누르고');
    }
  });

  it('확인 결과가 없으면 서버 문구로 시간 부족을 가리고, 그 밖에는 기본 문구를 쓴다', () => {
    expect(
      failureGuide('CAMERA_CHECK_NOT_PASSED', '카메라 확인에 쓸 시간이 남지 않아 맵을…', LETTERS)
        .title,
    ).toBe('보정이 오래 걸려 카메라 확인에 쓸 시간이 남지 않았어요');
    expect(failureGuide('CAMERA_CHECK_NOT_PASSED', null, LETTERS).title).toBe(
      '카메라 확인 걷기를 통과하지 못해 맵을 만들지 않았어요',
    );
  });
});

describe('BACKGROUND_INCOMPLETE: 못 찍은 카메라 이름(S15P31A101-719)', () => {
  it('워커 메시지의 미완료 카메라 목록만 읽는다(뒤의 카메라별 % 는 보지 않는다)', () => {
    const guide = failureGuide(
      'BACKGROUND_INCOMPLETE',
      "사람 지운 배경 수집 미완료 카메라: ['cam_D', 'cam_B'] ({'cam_A': 100, 'cam_B': 40, 'cam_C': 100, 'cam_D': 0}), 300s 대기",
      LETTERS,
    );
    expect(guide.title).toBe('카메라 2, 카메라 4에서 사람 없는 배경을 다 찍지 못했어요');
  });

  it('메시지에 카메라가 없으면 수집 진행이 100% 가 안 된 카메라를 쓴다', () => {
    const guide = failureGuide('BACKGROUND_INCOMPLETE', 'timeout', LETTERS, [], {
      backgroundCollection: [
        { cameraId: 'cam_A', pct: 100 },
        { cameraId: 'cam_C', pct: 60 },
      ],
    });
    expect(guide.title).toBe('카메라 3에서 사람 없는 배경을 다 찍지 못했어요');
  });

  it('Stage A 의 영어 메시지에서도 카메라를 찾는다', () => {
    expect(
      camerasInMessage("No clean background images found for camera 'cam_C'.", LETTERS),
    ).toEqual(['cam_C']);
  });
});

describe('실패 메시지에서 카메라 쌍 뽑기', () => {
  it('INSUFFICIENT_FEATURES: 메시지의 카메라 쌍을 캠N–캠M 으로 보인다', () => {
    const guide = failureGuide(
      'INSUFFICIENT_FEATURES',
      'Insufficient raw feature matches on pair cam_B-cam_C: 7',
      LETTERS,
    );
    expect(guide.title).toBe('옆 카메라 카메라 2–카메라 3 사이에 같이 보이는 곳이 적어요');
    expect(guide.fix).toBe(
      '카메라 연결 관리로 돌아가 두 카메라를 서로 쪽으로 돌리거나, 겹치는 곳에 무늬 있는 물건을 두세요.',
    );
    expect(guide.retry).toBe(false);
  });

  it('VALIDATION_REJECTED: worsened_pairs 의 쌍을 모두 보이고 그 밖의 카메라 쌍 글자는 보지 않는다', () => {
    const guide = failureGuide(
      'VALIDATION_REJECTED',
      "pair cam_A-cam_B was ok; worsened_pairs=['cam_C-cam_D', 'cam_A-cam_B']",
      LETTERS,
    );
    expect(guide.title).toBe(
      '보정한 뒤 오히려 어긋난 카메라 쌍이 있어요 (카메라 3–카메라 4, 카메라 1–카메라 2)',
    );
    expect(guide.fix).toBe(
      '「다시 시도」를 누르면 같은 카메라와 높이 설정으로 세팅을 다시 시작합니다.',
    );
    expect(guide.retry).toBe(true);
  });

  it('레거시 숫자형 카메라 id(cam1-cam2 꼴)도 같은 방식으로 읽는다', () => {
    expect(
      failureGuide(
        'VALIDATION_REJECTED',
        "worsened_pairs=['cam1-cam2', 'cam3-cam4']",
        LEGACY_NUMBERS,
      ).title,
    ).toBe('보정한 뒤 오히려 어긋난 카메라 쌍이 있어요 (카메라 1–카메라 2, 카메라 3–카메라 4)');
    expect(
      failureGuide('INSUFFICIENT_FEATURES', 'matches on pair cam4-cam1: 3', LEGACY_NUMBERS).title,
    ).toBe('옆 카메라 카메라 4–카메라 1 사이에 같이 보이는 곳이 적어요');
  });

  it('카메라 id 에 -가 있어도 알려진 id 조합을 찾는다', () => {
    const ids = ['cam-1', 'cam-2', 'cam-3'];
    expect(failureGuide('INSUFFICIENT_FEATURES', 'matches on pair cam-2-cam-3: 7', ids).title).toBe(
      '옆 카메라 카메라 2–카메라 3 사이에 같이 보이는 곳이 적어요',
    );
  });

  it('id 가 다른 id 의 끝부분이어도 다른 카메라 쌍으로 읽지 않는다', () => {
    const ids = ['am1', 'cam1', 'cam2'];
    expect(failureGuide('INSUFFICIENT_FEATURES', 'matches on pair cam1-cam2: 7', ids).title).toBe(
      '옆 카메라 카메라 2–카메라 3 사이에 같이 보이는 곳이 적어요',
    );
  });

  it('카메라 id 목록에 없는 쌍이나 쌍이 없는 메시지는 쌍 없는 문구를 쓴다', () => {
    expect(
      failureGuide('INSUFFICIENT_FEATURES', 'matches on pair cam_X-cam_Y: 7', LETTERS).title,
    ).toBe('옆 카메라끼리 같이 보이는 곳이 적어요');
    expect(failureGuide('INSUFFICIENT_FEATURES', null, LETTERS).title).toBe(
      '옆 카메라끼리 같이 보이는 곳이 적어요',
    );
    expect(failureGuide('VALIDATION_REJECTED', 'rejected', LETTERS).title).toBe(
      '보정 결과가 검증을 통과하지 못했어요',
    );
    expect(failureGuide('VALIDATION_REJECTED', 'worsened_pairs=[]', LETTERS).title).toBe(
      '보정 결과가 검증을 통과하지 못했어요',
    );
  });

  it('쌍이 필요 없는 실패는 메시지에 쌍이 있어도 문구가 같다', () => {
    expect(failureGuide('TIMEOUT', 'stuck on pair cam_A-cam_B', LETTERS).title).toBe(
      '시간이 너무 오래 걸렸어요 (15분)',
    );
  });
});
