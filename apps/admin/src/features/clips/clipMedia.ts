import { CONTAINER_ANNEXB, CONTAINER_MP4, MP4_MIME } from '@/features/clips/constants';
import { H264Error, parseAnnexB } from '@/features/clips/h264';
import { muxAvcMp4Parts } from '@/features/clips/mp4';
import type { Clip, ClipUrl } from '@/features/clips/types';

// 서명 주소로 받은 클립을 <video> 가 재생할 수 있는 주소로 만든다. 서버는 영상을 변환하지 않는다(server-event-clips.md).

export type ClipMediaFailure = 'UNSUPPORTED' | 'DOWNLOAD' | 'FORMAT';

export class ClipMediaError extends Error {
  constructor(readonly reason: ClipMediaFailure) {
    super(`클립을 재생할 수 없다 (${reason})`);
    this.name = 'ClipMediaError';
  }
}

export interface PlayableClip {
  /** <video> 의 src. */
  url: string;
  /** 이 주소를 쓸 수 있는 마지막 시각. 감싼 영상은 이 브라우저가 가지고 있어 만료가 없다. */
  expiresAtMs: number;
  /** 감싼 영상의 blob 주소를 해제한다. 서버 주소면 아무 일도 하지 않는다. */
  release: () => void;
}

type ClipTiming = Pick<Clip, 'clip_start_capture_ms' | 'clip_end_capture_ms'>;

/** 서명 주소의 영상 바이트를 받는다. 서명 주소에는 Authorization 을 싣지 않는다(서명이 깨진다). */
async function download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  try {
    const response = await fetch(url, { signal, credentials: 'omit' });
    if (!response.ok) throw new ClipMediaError('DOWNLOAD');
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error instanceof ClipMediaError ? error : new ClipMediaError('DOWNLOAD');
  }
}

/** Annex B 바이트를 MP4 로 감싼 blob 주소로 만든다. */
function wrapAsMp4(bytes: Uint8Array, clip: ClipTiming): PlayableClip {
  try {
    const parts = muxAvcMp4Parts(parseAnnexB(bytes), {
      windowMs: clip.clip_end_capture_ms - clip.clip_start_capture_ms,
    });
    const url = URL.createObjectURL(new Blob(parts, { type: MP4_MIME }));
    return { url, expiresAtMs: Number.POSITIVE_INFINITY, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    if (error instanceof H264Error) throw new ClipMediaError('FORMAT');
    throw error;
  }
}

/**
 * - `mp4`: 서명 주소를 그대로 재생한다.
 * - `h264-annexb`: 받아서 MP4 로 감싼 blob 주소를 만든다.
 *   다른 출처의 저장소에서 받으므로 저장소 CORS 가 이 앱의 출처에서 오는 GET 을 허용해야 한다.
 */
export async function loadPlayableClip(
  info: ClipUrl,
  clip: ClipTiming,
  signal?: AbortSignal,
): Promise<PlayableClip> {
  if (info.container === CONTAINER_MP4) {
    return { url: info.url, expiresAtMs: info.expires_at_ms, release: () => {} };
  }
  if (info.container !== CONTAINER_ANNEXB) throw new ClipMediaError('UNSUPPORTED');
  return wrapAsMp4(await download(info.url, signal), clip);
}
