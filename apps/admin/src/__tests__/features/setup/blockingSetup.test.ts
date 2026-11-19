import { workDayOf } from '@/__tests__/features/work/workFixture';
import {
  BLOCKING_SETUP_LOOKBACK_DAYS,
  isBlockedBySetupSession,
  isSetupSessionRunning,
  monthDayLabel,
  pickBlockingSetup,
  requestBlockingSetup,
} from '@/features/setup/blockingSetup';
import type { SetupSessionResponse } from '@/features/setup/types';
import { ApiError, type Http } from '@/lib/http';
import { describe, expect, it, vi } from 'vitest';

const sessionOf = (
  id: string,
  workUnitId: number,
  status: SetupSessionResponse['status'],
): SetupSessionResponse =>
  ({ setup_session_id: id, work_unit_id: workUnitId, status }) as SetupSessionResponse;

describe('isSetupSessionRunning', () => {
  it('완료·실패가 아닌 세션만 진행 중이다', () => {
    expect(isSetupSessionRunning(null)).toBe(false);
    expect(isSetupSessionRunning(sessionOf('a', 1, 'COMPLETED'))).toBe(false);
    expect(isSetupSessionRunning(sessionOf('a', 1, 'FAILED'))).toBe(false);
    expect(isSetupSessionRunning(sessionOf('a', 1, 'COLLECTING_BACKGROUND'))).toBe(true);
    expect(isSetupSessionRunning(sessionOf('a', 1, 'READY_FOR_ZONES'))).toBe(true);
    expect(isSetupSessionRunning(sessionOf('a', 1, 'BAKING_TEXTURE'))).toBe(true);
  });
});

describe('isBlockedBySetupSession', () => {
  it('새 세팅이 진행 중인 세팅 때문에 거절된 오류만 맞다(작업 시작은 세팅 완료만 본다, -642)', () => {
    expect(isBlockedBySetupSession(new ApiError(409, { code: 'SETUP_ALREADY_IN_PROGRESS' }))).toBe(
      true,
    );
    expect(isBlockedBySetupSession(new ApiError(409, { code: 'WORK_SETUP_NOT_COMPLETED' }))).toBe(
      false,
    );
    expect(isBlockedBySetupSession(new ApiError(409, { code: 'SETUP_ALREADY_COMPLETED' }))).toBe(
      false,
    );
    expect(isBlockedBySetupSession(new ApiError(409))).toBe(false);
    expect(isBlockedBySetupSession(new Error('x'))).toBe(false);
    expect(isBlockedBySetupSession(null)).toBe(false);
  });
});

describe('pickBlockingSetup', () => {
  const works = [
    workDayOf({ work_id: '11', date: '2026-11-09' }),
    workDayOf({ work_id: '12', date: '2026-11-10' }),
    workDayOf({ work_id: '13', date: '2026-11-11' }),
  ];

  it('진행 중인 세션을 그 작업의 날짜와 함께 고른다(세션의 작업 id 는 숫자, 작업의 id 는 문자열)', () => {
    expect(pickBlockingSetup(works, [sessionOf('s-12', 12, 'COLLECTING_BACKGROUND')])).toEqual({
      sessionId: 's-12',
      date: '2026-11-10',
    });
  });

  it('끝난(완료·실패) 세션과 작업을 찾을 수 없는 세션은 고르지 않는다', () => {
    expect(
      pickBlockingSetup(works, [
        sessionOf('s-11', 11, 'FAILED'),
        sessionOf('s-13', 13, 'COMPLETED'),
        sessionOf('s-99', 99, 'READY_FOR_ZONES'),
      ]),
    ).toBeNull();
    expect(pickBlockingSetup([], [])).toBeNull();
  });

  it('진행 중인 세션이 여럿이면 날짜가 늦은 작업의 것을 고른다', () => {
    expect(
      pickBlockingSetup(works, [
        sessionOf('s-11', 11, 'BAKING_TEXTURE'),
        sessionOf('s-13', 13, 'READY_FOR_ZONES'),
        sessionOf('s-12', 12, 'PREVIEW_AND_VLM_DRAFT'),
      ]),
    ).toEqual({ sessionId: 's-13', date: '2026-11-11' });
  });
});

describe('requestBlockingSetup', () => {
  /** 경로마다 답을 주는 가짜 http. 세션 조회는 sessions 에서, 목록은 works 에서 준다. */
  function fakeHttp(works: unknown[], sessions: Record<string, SetupSessionResponse | Error>) {
    const calls: string[] = [];
    const http = vi.fn(async (path: string) => {
      calls.push(path);
      if (path.startsWith('/api/work-units')) return { works };
      const id = decodeURIComponent(path.replace('/api/setup-sessions/', ''));
      const found = sessions[id];
      if (found instanceof Error || found === undefined) throw found ?? new Error('없음');
      return found;
    });
    return { http: http as unknown as Http, calls };
  }

  it('오늘부터 90일 전까지 작업을 받아 세션이 있는 작업만 조회하고 막는 세션을 돌려준다', async () => {
    const { http, calls } = fakeHttp(
      [
        workDayOf({ work_id: '12', date: '2026-11-10', active_setup_session_id: 's-12' }),
        workDayOf({ work_id: '13', date: '2026-11-11', active_setup_session_id: null }),
        workDayOf({ work_id: '14', date: '2026-11-12', active_setup_session_id: 's-12' }),
      ],
      { 's-12': sessionOf('s-12', 12, 'COLLECTING_BACKGROUND') },
    );
    const blocking = await requestBlockingSetup(http, new Date(2026, 10, 12));
    expect(blocking).toEqual({ sessionId: 's-12', date: '2026-11-10' });
    expect(BLOCKING_SETUP_LOOKBACK_DAYS).toBe(90);
    expect(calls).toEqual([
      '/api/work-units?from=2026-08-14&to=2026-11-12',
      '/api/setup-sessions/s-12',
    ]);
  });

  it('세션 하나를 못 받아도 나머지로 막는 세션을 찾는다', async () => {
    const { http } = fakeHttp(
      [
        workDayOf({ work_id: '11', date: '2026-11-09', active_setup_session_id: 's-11' }),
        workDayOf({ work_id: '12', date: '2026-11-10', active_setup_session_id: 's-12' }),
      ],
      { 's-11': new Error('404'), 's-12': sessionOf('s-12', 12, 'READY_FOR_ZONES') },
    );
    expect(await requestBlockingSetup(http, new Date(2026, 10, 12))).toEqual({
      sessionId: 's-12',
      date: '2026-11-10',
    });
  });

  it('세션이 있는 작업이 없으면 null 이고 세션을 조회하지 않는다', async () => {
    const { http, calls } = fakeHttp([workDayOf({ active_setup_session_id: null })], {});
    expect(await requestBlockingSetup(http, new Date(2026, 10, 12))).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('monthDayLabel', () => {
  it('날짜 키를 M월 D일로 바꾸고 잘못된 키는 그대로 둔다', () => {
    expect(monthDayLabel('2026-11-10')).toBe('11월 10일');
    expect(monthDayLabel('2026-01-05')).toBe('1월 5일');
    expect(monthDayLabel('nope')).toBe('nope');
  });
});
