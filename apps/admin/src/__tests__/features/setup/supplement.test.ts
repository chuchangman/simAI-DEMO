import {
  checkSupplementFile,
  contentTypeOf,
  DEFAULT_SUPPLEMENT_LIMITS,
  describeRebake,
  phoneSupplementUrl,
  rebakeBlockedText,
  rebakeRunning,
  SUPPLEMENT_REASON_LABEL,
  supplementErrorMessage,
  supplementReasonText,
  supplementVisible,
  uploadBlockedText,
} from '@/features/setup/supplement';
import {
  setupSessionResponseSchema,
  supplementRebakeSchema,
  type SetupSessionResponse,
  type SupplementRebake,
} from '@/features/setup/types';
import { ApiError } from '@/lib/http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MB = 1024 * 1024;
const file = (name: string, size: number, type = '') => ({ name, size, type });
const EMPTY = { count: 0, totalBytes: 0 };

function session(patch: Partial<SetupSessionResponse> = {}): SetupSessionResponse {
  return setupSessionResponseSchema.parse({
    setup_session_id: 'sess-1',
    site_id: 'classroom-1',
    work_unit_id: 3,
    status: 'COMPLETED',
    progress_pct: 100,
    camera_heights_m: { cam_A: 2.4 },
    preview_scene_version: 'scene-preview-1',
    ...patch,
  });
}

function rebake(patch: Partial<SupplementRebake> = {}): SupplementRebake {
  return supplementRebakeSchema.parse({
    rebake_id: 'rb-1',
    status: 'SUCCEEDED',
    progress_pct: 100,
    base_scene_version: 'scene-1',
    requested_at_ms: 1,
    ...patch,
  });
}

describe('보강 촬영 파일 검사', () => {
  it('형식은 MIME 을 먼저 보고 비었으면 확장자로 고른다', () => {
    expect(contentTypeOf(file('a.mp4', 1, 'video/mp4'))).toBe('video/mp4');
    expect(contentTypeOf(file('IMG_1.MOV', 1, ''))).toBe('video/quicktime');
    expect(contentTypeOf(file('x.jpeg', 1, 'application/octet-stream'))).toBe('image/jpeg');
    expect(contentTypeOf(file('x.heic', 1, 'image/heic'))).toBeNull();
    expect(contentTypeOf(file('x.webm', 1, 'video/webm'))).toBeNull();
  });

  it('종류별 크기·개수·합계 상한에 걸리면 사유를 준다', () => {
    const limits = DEFAULT_SUPPLEMENT_LIMITS;
    expect(checkSupplementFile(file('a.mp4', 500 * MB, 'video/mp4'), limits, EMPTY)).toEqual({
      ok: true,
      contentType: 'video/mp4',
      kind: 'VIDEO',
    });
    const bigVideo = checkSupplementFile(file('a.mp4', 1025 * MB, 'video/mp4'), limits, EMPTY);
    expect(bigVideo).toEqual({ ok: false, reason: '동영상은 1 GB까지 올릴 수 있습니다' });
    const bigPhoto = checkSupplementFile(file('a.jpg', 51 * MB, 'image/jpeg'), limits, EMPTY);
    expect(bigPhoto).toEqual({ ok: false, reason: '사진은 50 MB까지 올릴 수 있습니다' });
    expect(
      checkSupplementFile(file('a.jpg', MB, 'image/jpeg'), limits, { count: 32, totalBytes: 0 }),
    ).toEqual({ ok: false, reason: '파일은 32개까지 올릴 수 있습니다' });
    expect(
      checkSupplementFile(file('a.mp4', 600 * MB, 'video/mp4'), limits, {
        count: 4,
        totalBytes: 3.8 * 1024 * MB,
      }),
    ).toEqual({ ok: false, reason: '합계 4 GB를 넘습니다' });
    expect(checkSupplementFile(file('a.gif', MB, 'image/gif'), limits, EMPTY).ok).toBe(false);
    expect(checkSupplementFile(file('a.png', 0, 'image/png'), limits, EMPTY).ok).toBe(false);
  });
});

describe('보강 촬영 화면 상태', () => {
  it('미리보기 맵이 있는 READY_FOR_ZONES 이후 단계에서만 카드를 보인다', () => {
    expect(supplementVisible(session())).toBe(true);
    expect(supplementVisible(session({ status: 'READY_FOR_ZONES' }))).toBe(true);
    expect(supplementVisible(session({ preview_scene_version: null }))).toBe(false);
    expect(supplementVisible(session({ status: 'FAILED' }))).toBe(false);
    expect(supplementVisible(session({ status: 'PREVIEW_AND_VLM_DRAFT' }))).toBe(false);
    expect(supplementVisible(null)).toBe(false);
  });

  it('휴대폰 주소는 세션 ID 를 경로에 넣는다', () => {
    expect(phoneSupplementUrl('https://simai.live/', 'a b')).toBe(
      'https://simai.live/m/supplement/a%20b',
    );
  });

  it('다시 굽기 막힘·올리기 막힘 사유를 한국어로 보인다', () => {
    expect(rebakeBlockedText('SETUP_JOB_RUNNING')).toBe(
      '정식 맵 굽기가 끝나면 다시 구울 수 있습니다',
    );
    expect(rebakeBlockedText('NEW_CODE')).toBe('지금은 다시 구울 수 없습니다');
    expect(rebakeBlockedText(null)).toBeNull();
    expect(uploadBlockedText('SESSION_NOT_READY')).toBe('미리보기 맵이 준비되면 올릴 수 있습니다');
    expect(uploadBlockedText(null)).toBe('지금은 보강 촬영을 올릴 수 없습니다');
  });

  it('계약의 보조 촬영 사유 코드는 모두 문구가 있다', () => {
    const schema = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../../../../../../../contracts/messages/site_setup.schema.json',
        ),
        'utf-8',
      ),
    ) as { $defs: { supplement_summary: { properties: { reason: { enum: (string | null)[] } } } } };
    const reasons = schema.$defs.supplement_summary.properties.reason.enum.filter(
      (r): r is string => r !== null,
    );
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(SUPPLEMENT_REASON_LABEL[reason]).toBeTruthy();
    expect(supplementReasonText('SOMETHING_NEW')).toBe('사유 SOMETHING_NEW');
  });

  it('다시 굽는 중이면 끝난 세션도 계속 조회한다', () => {
    const base = session();
    expect(rebakeRunning(base)).toBe(false);
    const running = session({
      supplement: {
        media: [],
        limits: DEFAULT_SUPPLEMENT_LIMITS,
        can_upload: true,
        can_rebake: false,
        rebake_blocked_reason: 'REBAKE_RUNNING',
        rebake: rebake({ status: 'RUNNING', progress_pct: 40 }),
      },
    });
    expect(rebakeRunning(running)).toBe(true);
  });
});

describe('다시 굽기 결과 문구', () => {
  const media = [
    {
      media_id: 'sup-1',
      kind: 'VIDEO' as const,
      source: null,
      content_type: 'video/mp4',
      file_name: 'walk.mp4',
      size_bytes: 10,
      sha256: null,
      captured_at_ms: null,
      device: null,
      status: 'UPLOADED',
      created_at_ms: 1,
      uploaded_at_ms: 2,
    },
  ];

  it('진행 중이면 진행률을 보인다', () => {
    expect(describeRebake(rebake({ status: 'QUEUED', progress_pct: 0 }))).toMatchObject({
      running: true,
      title: '다시 굽기 대기 중',
    });
    expect(
      describeRebake(rebake({ status: 'RUNNING', progress_pct: 42.6, stage: 'BAKING_TEXTURE' })),
    ).toMatchObject({
      running: true,
      title: '다시 굽는 중 43%',
      progressPct: 43,
      detail: '맵 굽기',
    });
  });

  it('APPLIED 는 반영됨, 지금 맵으로 바꾸지 않았으면 그렇게 말한다', () => {
    const applied = rebake({
      outcome: 'APPLIED',
      scene_activated: false,
      result: {
        status: 'APPLIED',
        reason: null,
        media_count: 1,
        frames_selected: 30,
        frames_registered: 28,
        media: [
          { media_id: 'sup-1', status: 'USED', frames_selected: 30, frames_registered: 28 },
          {
            media_id: 'sup-2',
            status: 'WIDE_FOV_REJECTED',
            frames_selected: 1,
            frames_registered: 0,
          },
        ],
      },
    });
    const view = describeRebake(applied, media);
    expect(view).toMatchObject({
      tone: 'ok',
      title: '반영됨',
      detail: '새 맵을 만들었지만 지금 맵은 바꾸지 않았습니다',
    });
    expect(view.media).toEqual([
      { mediaId: 'sup-1', name: 'walk.mp4', used: true, text: '반영됨' },
      { mediaId: 'sup-2', name: 'sup-2', used: false, text: '붙지 않음 · 초광각·어안 렌즈' },
    ]);
    expect(describeRebake(rebake({ outcome: 'APPLIED', scene_activated: true })).detail).toBe(
      '보강 촬영을 넣은 새 맵으로 바꿨습니다',
    );
  });

  it('FALLBACK·SKIPPED·실패·취소는 원래 맵 유지와 사유를 말한다', () => {
    expect(
      describeRebake(rebake({ outcome: 'FALLBACK', reason: 'TOO_FEW_REGISTERED' })),
    ).toMatchObject({
      title: '원래 맵 유지',
      detail: '고정 카메라 화면과 맞춰진 장면이 너무 적습니다',
    });
    expect(describeRebake(rebake({ outcome: 'SKIPPED', reason: 'PATH_UNSUPPORTED' })).detail).toBe(
      '이 작업 서버는 보강 촬영 굽기를 지원하지 않습니다',
    );
    expect(
      describeRebake(rebake({ status: 'FAILED', failure_message: '시간 초과', outcome: null })),
    ).toMatchObject({ title: '원래 맵 유지', detail: '다시 굽기가 실패했습니다 · 시간 초과' });
    expect(describeRebake(rebake({ status: 'CANCELLED' })).detail).toBe('다시 굽기를 취소했습니다');
  });

  it('맞춰졌지만 관문에 걸린 파일은 맞추지 못한 파일과 다른 문구다(S15P31A101-652)', () => {
    const fallback = rebake({
      outcome: 'FALLBACK',
      reason: 'ALIGNMENT_WORSE',
      result: {
        status: 'FALLBACK',
        reason: 'ALIGNMENT_WORSE',
        media_count: 2,
        frames_selected: 41,
        frames_registered: 40,
        media: [
          {
            media_id: 'sup-1',
            status: 'REGISTERED_NOT_USED',
            frames_selected: 40,
            frames_registered: 40,
          },
          { media_id: 'sup-2', status: 'NOT_REGISTERED', frames_selected: 1, frames_registered: 0 },
        ],
      },
    });
    expect(describeRebake(fallback, media).media.map((m) => m.text)).toEqual([
      '붙지 않음 · 화면과 맞췄지만 품질 기준에 걸려 넣지 않음',
      '붙지 않음 · 고정 카메라 화면과 맞추지 못함',
    ]);
  });
});

describe('보강 촬영 오류 문구', () => {
  it('아는 코드는 정한 문구, 모르는 4xx 는 서버 문구, 그 밖은 기본 문구', () => {
    expect(
      supplementErrorMessage(new ApiError(409, { code: 'SUPPLEMENT_SETUP_JOB_RUNNING' }), 'x'),
    ).toBe('정식 맵 굽기가 끝나면 다시 구울 수 있습니다');
    expect(
      supplementErrorMessage(new ApiError(409, { code: 'SETUP_BLOCKED_BY_LIVE_WORK' }), 'x'),
    ).toContain('진행 중인 작업');
    expect(
      supplementErrorMessage(new ApiError(400, { code: 'OTHER', serverMessage: '서버 문구' }), 'x'),
    ).toBe('서버 문구');
    expect(
      supplementErrorMessage(new ApiError(500, { serverMessage: '내부 오류' }), '기본 문구'),
    ).toBe('기본 문구');
    expect(supplementErrorMessage(new Error('boom'), '기본 문구')).toBe('기본 문구');
  });
});
