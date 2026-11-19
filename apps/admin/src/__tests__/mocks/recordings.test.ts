import { requestVideoSegments, requestVideoUrl } from '@/features/history/api';
import { createHttp } from '@/lib/http';
import { historyWorks } from '@/mocks/history';
import { createRecordingVideoMock, recordingSegments } from '@/mocks/recordings';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 관제 녹화 작업 구간 영상 mock(S15P31A101-668): 끝난 작업만, 카메라 4대 × 5분 조각, 관리자만, 재생 주소는 mp4.
const NOW = new Date(2026, 9, 29, 11, 0).getTime();
const BASE = 'http://api.test';
const works = historyWorks(NOW);
const done = works.find((w) => w.actual_ended_at !== null)!;

const server = setupServer(
  ...createRecordingVideoMock({ now: () => NOW, video: () => 'blob:test-mp4' }).handlers,
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const admin = createHttp({ baseUrl: BASE, getToken: () => 'mock-token.admin' });
const viewer = createHttp({ baseUrl: BASE, getToken: () => 'mock-token.viewer' });

describe('recordingSegments', () => {
  it('끝난 작업의 작업 구간만 카메라마다 이어진 5분 조각으로 나눈다', () => {
    const segments = recordingSegments([done]);
    const cam_A = segments.filter((s) => s.camera_id === 'cam_A');
    expect(cam_A[0]!.segment_start_capture_ms).toBe(done.actual_started_at);
    expect(cam_A.at(-1)!.segment_end_capture_ms).toBe(done.actual_ended_at);
    for (let i = 1; i < cam_A.length; i++) {
      expect(cam_A[i]!.segment_start_capture_ms).toBe(cam_A[i - 1]!.segment_end_capture_ms);
    }
    expect(new Set(segments.map((s) => s.camera_id)).size).toBe(4);
    expect(segments.every((s) => s.container === 'mp4' && s.origin === 'GATEWAY_RECORDING')).toBe(
      true,
    );
    expect(recordingSegments(works.filter((w) => w.actual_ended_at === null))).toEqual([]);
  });
});

describe('GET /api/videos mock', () => {
  it('관리자는 작업 구간과 겹치는 조각 목록과 mp4 재생 주소를 받는다', async () => {
    const from = done.actual_started_at! + 60_000;
    const { segments } = await requestVideoSegments(admin, { from, to: from + 1_000 });
    expect(segments.map((s) => s.camera_id).sort()).toEqual(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
    const url = await requestVideoUrl(admin, segments[0]!.segment_id);
    expect(url.container).toBe('mp4');
    expect(url.url).toBe('blob:test-mp4');
  });

  it('관리자가 아니면 403 이다', async () => {
    await expect(requestVideoSegments(viewer, { from: NOW - 1000, to: NOW })).rejects.toMatchObject(
      {
        status: 403,
      },
    );
  });
});
