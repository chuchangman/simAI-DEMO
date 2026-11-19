import { completeBlockedReason } from '@/features/setup/setup';
import {
  canCompleteSetup,
  completedAtLabel,
  emptyZonePlanConfirm,
  SetupCompleteCard,
  setupCompleted,
  setupSummaryRows,
} from '@/features/setup/SetupCompleteCard';
import {
  SETUP_COMPLETE_ERROR_TEXT,
  setupCompleteErrorMessage,
} from '@/features/setup/setupErrorMessage';
import { REBAKE_BLOCKED_LABEL, SUPPLEMENT_ERROR_TEXT } from '@/features/setup/supplement';
import type { SetupSessionResponse } from '@/features/setup/types';
import { ApiError } from '@/lib/http';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// 세팅 완료(C17, S15P31A101-615): 완료할 수 있는 때, 적용 결과 요약, 완료 뒤 상태 카드, 거부 코드 안내.
// 완료를 부르는 일은 구역 단계 아래 오른쪽 단추가 하며 useCompleteSetup.test.tsx 와 SetupPage 시험이 본다.

afterEach(cleanup);

const COMPLETED_AT_MS = 1_800_000_000_000;
const sessionOf = (patch: Partial<SetupSessionResponse>) =>
  ({ setup_completed_at_ms: null, ...patch }) as SetupSessionResponse;

describe('setupCompleted·canCompleteSetup·완료 요약·빈 구역 확인 글', () => {
  const base = sessionOf({});
  it('완료 시각이 있으면 완료한 세션이다', () => {
    expect(setupCompleted(base)).toBe(false);
    expect(setupCompleted({ ...base, setup_completed_at_ms: 1 })).toBe(true);
    expect(setupCompleted(null)).toBe(false);
  });

  it('새 모델은 정밀 3D 맵이 나온 뒤·완료 전일 때만 완료할 수 있다(-688: 미리보기로는 완료하지 않는다)', () => {
    const preview = { ...base, preview_scene_version: 'scene-preview-1' };
    expect(canCompleteSetup({ ...preview, status: 'PREVIEW_AND_VLM_DRAFT' })).toBe(false);
    expect(canCompleteSetup({ ...preview, status: 'READY_FOR_ZONES' })).toBe(false);
    expect(canCompleteSetup({ ...preview, status: 'BAKING_TEXTURE' })).toBe(false);
    expect(
      canCompleteSetup({ ...preview, status: 'COMPLETED', bake_skipped: 'LIVE_WORK_STARTED' }),
    ).toBe(false);
    const baked = { ...preview, status: 'COMPLETED', scene_version: 'scene-final-1' } as const;
    expect(canCompleteSetup(baked)).toBe(true);
    expect(canCompleteSetup({ ...baked, status: 'FAILED' })).toBe(false);
    expect(canCompleteSetup({ ...baked, camera_check_passed: false })).toBe(false);
    expect(canCompleteSetup({ ...baked, setup_completed_at_ms: 1 })).toBe(false);
    expect(canCompleteSetup(null)).toBe(false);
  });

  it('재사용은 기존 맵 맞추기가 채택된 미리보기 단계 이후면 완료할 수 있다', () => {
    const reuse = { ...base, mode: 'REUSE', status: 'READY_FOR_ZONES' } as const;
    expect(canCompleteSetup(reuse)).toBe(false);
    expect(canCompleteSetup({ ...reuse, world_anchor: { accepted: true } })).toBe(true);
  });

  it('서버가 complete_blocked_reason 을 실으면 그 판정을 그대로 따른다', () => {
    const baked = { ...base, status: 'COMPLETED', scene_version: 'scene-final-1' } as const;
    expect(completeBlockedReason(baked)).toBeNull();
    expect(
      canCompleteSetup({ ...baked, complete_blocked_reason: 'SETUP_CAMERA_CHECK_NOT_PASSED' }),
    ).toBe(false);
    expect(
      canCompleteSetup({
        ...base,
        status: 'READY_FOR_ZONES',
        complete_blocked_reason: null,
      }),
    ).toBe(true);
    expect(
      completeBlockedReason({ ...base, status: 'READY_FOR_ZONES', preview_scene_version: 'p' }),
    ).toBe('SETUP_FINAL_MAP_NOT_READY');
    expect(
      completeBlockedReason({
        ...base,
        status: 'BAKING_TEXTURE',
        camera_check_passed: false,
      }),
    ).toBe('SETUP_CAMERA_CHECK_NOT_PASSED');
  });

  it('완료 요약은 사용 맵·카메라 확인·구역 수·저장 결과를 줄마다 보이고 0 인 항목은 뺀다(S15P31A101-691)', () => {
    const camera = (verdict: string) => ({
      observed_views: 40,
      loo_samples: 0,
      loo_median_px: null,
      verdict,
    });
    const done = sessionOf({
      status: 'COMPLETED',
      mode: 'NEW',
      scene_version: 'scene-final-1',
      camera_check_passed: true,
      camera_check: {
        cameras: {
          cam_A: camera('PASS'),
          cam_B: camera('PASS'),
          cam_C: camera('PASS'),
          cam_D: camera('PASS'),
        },
      } as unknown as SetupSessionResponse['camera_check'],
    });
    expect(
      setupSummaryRows(done, { created: ['a', 'b'], updated: ['c'], kept: [], archived: ['d'] }),
    ).toEqual([
      { label: '사용 맵', value: '새 맵 · 정밀 3D 맵' },
      { label: '카메라 확인', value: '카메라 4대 모두 통과' },
      { label: '위험 구역', value: '3개' },
      { label: '저장 결과', value: '관제 구역에 적용 · 새로 2 · 고침 1 · 보관 1' },
    ]);
    // 이전 맵 재사용 · 카메라 확인 결과 없음 · 적용 결과를 모름(다른 화면에서 완료) → 아는 줄만
    expect(setupSummaryRows(sessionOf({ status: 'COMPLETED', mode: 'REUSE' }), null)).toEqual([
      { label: '사용 맵', value: '이전 맵 재사용' },
    ]);
    expect(
      setupSummaryRows(sessionOf({ status: 'COMPLETED', mode: 'REUSE' }), {
        created: [],
        updated: [],
        kept: [],
        archived: [],
      }).slice(1),
    ).toEqual([
      { label: '위험 구역', value: '없음' },
      { label: '저장 결과', value: '바뀐 구역 없음' },
    ]);
  });

  it('구역 목록이 비었을 때 확인 글은 보관될 관제 구역 수와 이름을 적고, 모르면 개수 없이 묻는다', () => {
    expect(emptyZonePlanConfirm(['개구부', '작업대 A', '작업대 B', '사다리'])).toBe(
      '저장한 구역이 없습니다. 완료하면 지금 관제 구역 4개(개구부, 작업대 A, 작업대 B 외 1개)가 모두 보관되고 위험 구역 없이 관제합니다. 그래도 세팅을 완료할까요?',
    );
    expect(emptyZonePlanConfirm([])).toContain('지금 관제 구역도 없습니다');
    expect(emptyZonePlanConfirm(null)).toBe(
      '저장한 구역이 없어 지금 관제 구역이 모두 보관됩니다. 그래도 세팅을 완료할까요?',
    );
  });
});

describe('세팅 완료 상태 카드', () => {
  it('완료 전 세션이면 아무것도 그리지 않는다(완료 단추·설명도 없다)', () => {
    render(<SetupCompleteCard session={sessionOf({ status: 'READY_FOR_ZONES' })} />);
    expect(screen.queryByTestId('setup-complete-card')).toBeNull();
    expect(screen.queryByRole('button', { name: '세팅 완료' })).toBeNull();
  });

  it('완료한 세션은 완료 시각과 안내를 보이고, 방금 받은 적용 결과가 없으면 구역·저장 줄은 없다', () => {
    render(
      <SetupCompleteCard
        session={sessionOf({ status: 'COMPLETED', setup_completed_at_ms: COMPLETED_AT_MS })}
      />,
    );
    expect(screen.getByRole('heading', { name: '세팅 완료' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/에 세팅을 완료했습니다$/);
    expect(screen.getByText(/구역 수정은 관제 화면의 구역 편집에서/)).toBeTruthy();
    expect(screen.queryByText('저장 결과')).toBeNull();
    expect(screen.getByText('사용 맵')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('방금 완료한 화면은 구역 수와 저장 결과를 함께 보인다', () => {
    render(
      <SetupCompleteCard
        session={sessionOf({ status: 'COMPLETED', setup_completed_at_ms: COMPLETED_AT_MS })}
        applied={{ created: ['a'], updated: [], kept: ['b', 'c'], archived: [] }}
      />,
    );
    const summary = screen.getByLabelText('세팅 요약');
    expect(summary.textContent).toContain('위험 구역3개');
    expect(summary.textContent).toContain('관제 구역에 적용 · 새로 1 · 그대로 2');
  });
});

describe('세팅 완료 거부 안내', () => {
  it.each([
    'SETUP_ALREADY_COMPLETED',
    'SETUP_NOT_READY_TO_COMPLETE',
    'SETUP_FINAL_MAP_NOT_READY',
    'SETUP_FINAL_MAP_SKIPPED',
    'SETUP_SESSION_NOT_ACTIVE',
    'WORK_NOT_TODAY',
    'WORK_INVALID_STATE',
    'SETUP_COMPLETE_BLOCKED_BY_LIVE_WORK',
    'SETUP_ZONE_WORLD_MISMATCH',
    'SUPPLEMENT_SETUP_COMPLETED',
  ])('%s 는 한국어 안내로 바꾼다', (code) => {
    const text = setupCompleteErrorMessage(new ApiError(409, { code, serverMessage: 'server' }));
    expect(text).toBe(SETUP_COMPLETE_ERROR_TEXT[code]);
    expect(text).not.toBe('server');
  });

  it('모르는 4xx 는 서버 문구, 그 밖에는 기본 문구', () => {
    expect(
      setupCompleteErrorMessage(new ApiError(409, { code: 'X', serverMessage: '서버 안내' })),
    ).toBe('서버 안내');
    expect(setupCompleteErrorMessage(new Error('x'))).toBe(
      '세팅을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요',
    );
  });

  it('완료 뒤 보강 거부 사유(SETUP_COMPLETED)와 코드도 안내한다', () => {
    expect(REBAKE_BLOCKED_LABEL.SETUP_COMPLETED).toBeTruthy();
    expect(SUPPLEMENT_ERROR_TEXT.SUPPLEMENT_SETUP_COMPLETED).toBeTruthy();
  });
});

describe('완료 시각 글(-752)', () => {
  const now = new Date(2026, 10, 16, 10, 0).getTime();
  it('오늘이면 시각만, 오늘이 아니면 날짜를 앞에 붙이고 올해가 아니면 연도도 붙인다', () => {
    expect(completedAtLabel(new Date(2026, 10, 16, 16, 16).getTime(), now)).toBe('오후 04:16');
    expect(completedAtLabel(new Date(2026, 10, 15, 16, 16).getTime(), now)).toBe(
      '11월 15일 오후 04:16',
    );
    expect(completedAtLabel(new Date(2025, 11, 31, 9, 5).getTime(), now)).toBe(
      '2025년 12월 31일 오전 09:05',
    );
  });
});
