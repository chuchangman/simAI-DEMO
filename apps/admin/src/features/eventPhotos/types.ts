import { z } from 'zod';

// 이벤트 프레임(사진) REST(GET /api/events/{id}/frames, 관리자, S15P31A101-753). 형식은 서버 EventFrameService 의 실제 응답이다.
// 서명 GET 주소는 짧게(약 5분) 살아서 expires_at_ms 에 다시 받는다. 형식이 틀린 사진 하나는 빼고 나머지를 보인다.

const photoSchema = z.object({
  camera_id: z.string().min(1),
  /** 촬영 시각(UTC ms, I0 프레임 헤더 값). 모르면 null. */
  capture_ms: z.number().nullable(),
  url: z.string().min(1),
  expires_at_ms: z.number(),
});

export type EventPhoto = z.infer<typeof photoSchema>;

export const eventPhotosSchema = z.object({
  event_id: z.string(),
  frames: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const photo = photoSchema.safeParse(item);
      return photo.success ? [photo.data] : [];
    }),
  ),
});
