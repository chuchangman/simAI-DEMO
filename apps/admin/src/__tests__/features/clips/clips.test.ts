import {
  clipPreparing,
  clipTags,
  deletedLabel,
  groupClips,
  hasClips,
  isDeleted,
  retentionState,
} from '@/features/clips/clips';
import { CLIP_PREPARE_MS } from '@/features/clips/constants';
import { clipUrlSchema, eventClipsSchema, type Clip } from '@/features/clips/types';
import type { EventItem } from '@/features/events/types';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;

const clip = (change: Partial<Clip> = {}): Clip => ({
  clip_id: 'c-1',
  camera_id: 'cam_A',
  resume_count: 0,
  clip_start_capture_ms: T - 20_000,
  clip_end_capture_ms: T + 20_000,
  frame_count: 600,
  truncated_start: false,
  truncated_end: false,
  has_gaps: false,
  content_type: 'video/h264',
  container: 'h264-annexb',
  size_bytes: 1_200_000,
  retention_hold: false,
  auto_retained: false,
  delete_after_ms: T + 14 * 24 * 60 * 60 * 1000,
  deleted_at_ms: null,
  ...change,
});

const event = (change: Partial<EventItem> = {}): EventItem => ({
  event_id: 'e-1',
  rule_id: 'R1',
  source: 'LIVE',
  lifecycle: 'RAISED',
  verification: 'VERIFIED',
  severity: 'HIGH',
  confidence: 'HIGH',
  needs_check: false,
  world_ids: ['w-0012'],
  zone_id: 'z-02',
  metrics: {},
  rationale: null,
  proposed_severity: null,
  ...change,
});

// 저장소 루트 contracts/ 의 정본. 클립 칸 이름이 계약 media_clip 과 같은지 본다.
const SCHEMAS = import.meta.glob<{ default: { properties: { payload: { properties: object } } } }>(
  '../../../../../../../contracts/messages/media_clip.schema.json',
  { eager: true },
);

/** EC2 가 계약 칸에 더하는 칸(ClipService.view). */
const EC2_FIELDS = ['auto_retained', 'deleted_at_ms', 'uploaded_at_ms', 'received_at_ms'];

describe('클립 응답 형식', () => {
  it('클립 칸 이름은 계약 media_clip 과 같다(EC2 가 더하는 칸만 다르다)', () => {
    const schema = Object.values(SCHEMAS)[0]?.default;
    const contractFields = Object.keys(schema?.properties.payload.properties ?? {});
    expect(contractFields.length).toBeGreaterThan(0);
    const fields = Object.keys(clip()).filter((key) => !EC2_FIELDS.includes(key));
    expect(fields.filter((key) => !contractFields.includes(key))).toEqual([]);
  });

  it('목록은 contract 표시 없이 받고, 형식이 틀린 클립 하나는 빼고 나머지를 받는다', () => {
    const body = {
      event_id: 'e-1',
      clips: [clip(), { ...clip({ clip_id: 'c-2' }), camera_id: 3 }, 'x', clip({ clip_id: 'c-3' })],
    };
    expect(eventClipsSchema.parse(body).clips.map((c) => c.clip_id)).toEqual(['c-1', 'c-3']);
    expect(eventClipsSchema.safeParse({ clips: [] }).success).toBe(false);
  });

  it('서버가 지금 보내는 칸을 그대로 받는다(content_type·container·보존·삭제 칸)', () => {
    const [parsed] = eventClipsSchema.parse({
      event_id: 'e-1',
      clips: [clip({ retention_hold: true, auto_retained: true, deleted_at_ms: T })],
    }).clips;
    expect(parsed).toMatchObject({
      content_type: 'video/h264',
      container: 'h264-annexb',
      retention_hold: true,
      auto_retained: true,
      deleted_at_ms: T,
    });
  });

  it('형식(content_type·container)이 없는 클립은 받지 않는다', () => {
    const withoutContainer: Record<string, unknown> = { ...clip() };
    delete withoutContainer.container;
    const body = { event_id: 'e-1', clips: [withoutContainer, clip({ clip_id: 'c-2' })] };
    expect(eventClipsSchema.parse(body).clips.map((c) => c.clip_id)).toEqual(['c-2']);
  });

  it('지운 시각은 없어도 된다(null·생략)', () => {
    const withoutDeleted: Record<string, unknown> = { ...clip() };
    delete withoutDeleted.deleted_at_ms;
    const body = { event_id: 'e-1', clips: [withoutDeleted] };
    expect(eventClipsSchema.parse(body).clips).toHaveLength(1);
  });

  it('재생 주소는 형식(content_type·container)과 비어 있지 않은 주소가 있어야 받는다', () => {
    const body = {
      clip_id: 'c-1',
      url: '/c.h264',
      expires_at_ms: T,
      content_type: 'video/h264',
      container: 'h264-annexb',
    };
    expect(clipUrlSchema.parse(body).container).toBe('h264-annexb');
    expect(clipUrlSchema.safeParse({ ...body, url: '' }).success).toBe(false);
    expect(clipUrlSchema.safeParse({ ...body, container: undefined }).success).toBe(false);
  });
});

describe('클립 표시 계산', () => {
  it('클립은 LIVE 의 CRITICAL·HIGH 이벤트에만 있다', () => {
    expect(hasClips(event({ severity: 'CRITICAL' }))).toBe(true);
    expect(hasClips(event({ severity: 'HIGH' }))).toBe(true);
    expect(hasClips(event({ severity: 'CAUTION' }))).toBe(false);
    expect(hasClips(event({ severity: 'INFO' }))).toBe(false);
    expect(hasClips(event({ source: 'PLANNED' }))).toBe(false);
    expect(hasClips(event({ source: 'REPLAY' }))).toBe(false);
  });

  it('보존 상태는 서버가 알려 준 auto_retained 로 가른다(표시가 꺼져 있으면 보존이 아니다)', () => {
    expect(retentionState(clip())).toBe('NONE');
    expect(retentionState(clip({ retention_hold: true }))).toBe('HELD');
    expect(retentionState(clip({ retention_hold: true, auto_retained: true }))).toBe('AUTO');
    expect(retentionState(clip({ retention_hold: false, auto_retained: true }))).toBe('NONE');
  });

  it('위험 구간(재개 횟수)별로 묶고 묶음 안은 카메라 순이다', () => {
    const groups = groupClips([
      clip({ clip_id: 'a', camera_id: 'cam_C', resume_count: 1 }),
      clip({ clip_id: 'b', camera_id: 'cam_B' }),
      clip({ clip_id: 'c', camera_id: 'cam_A', resume_count: 1 }),
      clip({ clip_id: 'd', camera_id: 'cam_A' }),
    ]);
    expect(groups.map((g) => [g.resumeCount, g.clips.map((c) => c.clip_id)])).toEqual([
      [0, ['d', 'b']],
      [1, ['c', 'a']],
    ]);
    expect(groupClips([])).toEqual([]);
  });

  it('잘림·프레임 빠짐은 Tier 0 가 알린 것만 짧게 보인다', () => {
    expect(clipTags(clip())).toEqual([]);
    expect(clipTags(clip({ truncated_start: true, truncated_end: true, has_gaps: true }))).toEqual([
      '앞 잘림',
      '뒤 잘림',
      '프레임 빠짐',
    ]);
  });

  it('지운 시각이 있으면 지운 클립이다', () => {
    expect(isDeleted(clip())).toBe(false);
    expect(isDeleted(clip({ deleted_at_ms: undefined }))).toBe(false);
    expect(isDeleted(clip({ deleted_at_ms: T }))).toBe(true);
  });

  it('지운 클립의 표시는 지운 시각을 알면 함께 보인다', () => {
    expect(deletedLabel(clip({ deleted_at_ms: undefined }))).toBe('삭제됨');
    expect(deletedLabel(clip({ deleted_at_ms: T }))).toMatch(/^삭제됨 · \d+월 \d+일 \d{2}:\d{2}$/);
  });

  it('지금 위험 구간의 클립이 없고 바뀐 지 얼마 안 됐을 때만 영상 준비 중이다', () => {
    const fresh = event({ raised_at: T, updated_at: T });
    expect(clipPreparing(fresh, [], T + 30_000)).toBe(true);
    expect(clipPreparing(fresh, [], T + CLIP_PREPARE_MS)).toBe(false);
    expect(clipPreparing(fresh, [clip()], T + 30_000)).toBe(false);
    // 재개하면 새 구간의 클립을 기다린다(앞 구간 클립은 세지 않는다).
    const resumed = event({ raised_at: T - 600_000, updated_at: T, resume_count: 1 });
    expect(clipPreparing(resumed, [clip()], T + 30_000)).toBe(true);
    expect(
      clipPreparing(resumed, [clip(), clip({ clip_id: 'c-2', resume_count: 1 })], T + 30_000),
    ).toBe(false);
    // 진행 중이라 updated_at 이 계속 바뀌어도 처음 구간의 기다림은 발생 시각부터 재어 끝난다(S15P31A101-757).
    const updating = event({ raised_at: T - 300_000, updated_at: T });
    expect(clipPreparing(updating, [], T + 1_000)).toBe(false);
    // 바뀐 시각이 없으면 처음 발생 시각으로, 둘 다 없으면 모른다(준비 중으로 보이지 않는다).
    expect(clipPreparing(event({ raised_at: T }), [], T + 30_000)).toBe(true);
    expect(clipPreparing(event(), [], T)).toBe(false);
  });
});
