import {
  clipPreparing,
  clipTags,
  currentClipMissing,
  deletedLabel,
  groupClips,
  isDeleted,
  retentionState,
} from '@/features/clips/clips';
import type { Clip } from '@/features/clips/types';
import { useClipPlayback } from '@/features/clips/useClipPlayback';
import { useClipRetention } from '@/features/clips/useClipRetention';
import { useEventClips } from '@/features/clips/useEventClips';
import { formatTime } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import { useSharedNow } from '@/features/events/useSharedNow';
import { useCameraNames } from '@/hooks/useCameraNames';
import { Button } from '@simai/ui/components/button';
import { Play, X } from 'lucide-react';
import { useState } from 'react';

// 이벤트 클립(명세 5.1·11.5·14장, FR-59·FR-99). 관리자만 보고, 얼굴을 흐리지 않은 영상이라 내려받기는 두지 않는다.

const TAG = 'rounded bg-surface-3 px-1.5 py-0.5';

type Playback = ReturnType<typeof useClipPlayback>;
type Retention = ReturnType<typeof useClipRetention>;

/** 보존 표시 붙이기·떼기. 자동 보존은 뗄 수 없어 표시만 보인다. */
function RetentionControl({
  clip,
  retention,
  label,
}: {
  clip: Clip;
  retention: Retention;
  label: string;
}) {
  const held = retentionState(clip);
  if (held === 'AUTO') return <span className={TAG}>자동 보존</span>;
  return (
    <Button
      size="xs"
      variant={held === 'HELD' ? 'secondary' : 'ghost'}
      aria-pressed={held === 'HELD'}
      aria-label={`${label} 보존`}
      disabled={retention.pending}
      onClick={() => retention.setRetention(!clip.retention_hold)}
    >
      보존
    </Button>
  );
}

function ClipVideo({ playback, url, label }: { playback: Playback; url: string; label: string }) {
  return (
    <video
      key={playback.videoKey}
      src={url}
      aria-label={`${label} 클립`}
      controls
      // 브라우저 기본 메뉴의 내려받기·다른 이름으로 저장을 감춘다(완전히 막지는 못한다).
      controlsList="nodownload"
      onContextMenu={(e) => e.preventDefault()}
      autoPlay
      muted
      playsInline
      preload="metadata"
      onError={playback.onError}
      className="aspect-video w-full rounded-md bg-black"
    />
  );
}

function ClipRow({ eventId, clip, label }: { eventId: string; clip: Clip; label: string }) {
  const [open, setOpen] = useState(false);
  const playback = useClipPlayback(eventId, clip);
  const retention = useClipRetention(eventId, clip.clip_id);
  const deleted = isDeleted(clip) || playback.deleted;
  const error = playback.error ?? retention.error;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono font-semibold" title={clip.camera_id}>
          {label}
        </span>
        <span className="font-mono text-muted-foreground">
          {formatTime(clip.clip_start_capture_ms)} ~ {formatTime(clip.clip_end_capture_ms)}
        </span>
        {clipTags(clip).map((tag) => (
          <span key={tag} className={TAG}>
            {tag}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {deleted ? (
            <span className="text-muted-foreground">{deletedLabel(clip)}</span>
          ) : (
            <>
              <RetentionControl clip={clip} retention={retention} label={label} />
              {open ? (
                <Button
                  size="xs"
                  variant="secondary"
                  aria-label={`${label} 닫기`}
                  onClick={() => setOpen(false)}
                >
                  <X aria-hidden />
                  닫기
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="secondary"
                  aria-label={`${label} 재생`}
                  disabled={playback.pending}
                  onClick={() => {
                    setOpen(true);
                    playback.play();
                  }}
                >
                  <Play aria-hidden />
                  재생
                </Button>
              )}
            </>
          )}
        </span>
      </div>
      {open && !deleted && playback.url && (
        <ClipVideo playback={playback} url={playback.url} label={label} />
      )}
      {error && (
        <span role="alert" className="text-xs text-muted-foreground">
          {error}
        </span>
      )}
    </li>
  );
}

/**
 * 이벤트 상세의 카메라별 클립. 관리자가 아니거나 클립이 생기지 않는 이벤트면 그리지 않는다.
 * 사건 상세에서는 규칙마다 하나씩 두므로 제목에 규칙 이름을 넘긴다.
 */
export function EventClips({ event, title = '클립' }: { event: EventItem; title?: string }) {
  const { enabled, clips, failed } = useEventClips(event);
  const label = useCameraNames(clips?.map((clip) => clip.camera_id));
  const now = useSharedNow();
  if (!enabled) return null;
  const groups = groupClips(clips ?? []);
  // 목록을 받은 뒤에만 판단한다(받기 전·실패는 준비 중으로 보이지 않는다).
  const preparing = !failed && clips !== undefined && clipPreparing(event, clips, now);

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      {failed && (
        <p role="alert" className="text-sm text-muted-foreground">
          클립 목록을 받지 못했습니다
        </p>
      )}

      {groups.map((group) => (
        <div key={group.resumeCount} className="flex flex-col gap-1.5">
          {groups.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {group.resumeCount === 0 ? '발생' : `재개 ${group.resumeCount}`}
            </span>
          )}
          <ul className="flex flex-col gap-1.5">
            {group.clips.map((clip) => (
              <ClipRow
                key={clip.clip_id}
                eventId={event.event_id}
                clip={clip}
                label={label(clip.camera_id)}
              />
            ))}
          </ul>
        </div>
      ))}
      {preparing && <p className="text-sm text-muted-foreground">영상 준비 중</p>}
      {/* 기다림(2분)이 지나도 영상이 없으면 끝없이 기다리게 두지 않고 다음 행동을 알린다(S15P31A101-757). */}
      {!failed && !preparing && clips !== undefined && currentClipMissing(event, clips) && (
        <p className="text-sm text-muted-foreground">
          영상을 받지 못했습니다(녹화 업로드가 끝나지 않았습니다). CCTV 화면에서 그 시각을 확인해
          주세요.
        </p>
      )}
    </section>
  );
}
