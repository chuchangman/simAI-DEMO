import type { EventPhoto } from '@/features/eventPhotos/types';
import { useEventPhotos } from '@/features/eventPhotos/useEventPhotos';
import { formatTime } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import { useCameraNames } from '@/hooks/useCameraNames';
import { Button } from '@simai/ui/components/button';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

// 이벤트 사진(CRITICAL R1~R4 이벤트 프레임, 명세 5.4·14장, S15P31A101-753). 관리자만 보고, 사진이 없으면 칸 자체를 그리지 않는다.
// 얼굴은 관측된 픽셀 그대로다(AGENTS 규칙 8, 기본 OBSERVED). 내려받기 단추는 두지 않는다.

const captionOf = (label: string, photo: EventPhoto) =>
  photo.capture_ms === null ? label : `${label} ${formatTime(photo.capture_ms)}`;

function Lightbox({
  photo,
  caption,
  onClose,
  onError,
}: {
  photo: EventPhoto;
  caption: string;
  onClose: () => void;
  onError: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 사건 상세 창도 Esc 로 닫히므로 사진 창만 닫고 여기서 멈춘다.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={`${caption} 사진 크게 보기`}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6"
    >
      <Button
        size="xs"
        variant="secondary"
        aria-label="사진 닫기"
        className="absolute top-4 right-4"
        onClick={onClose}
      >
        <X aria-hidden />
        닫기
      </Button>
      <img
        src={photo.url}
        alt={`${caption} 사진`}
        onClick={(e) => e.stopPropagation()}
        onError={onError}
        onContextMenu={(e) => e.preventDefault()}
        draggable={false}
        className="max-h-[85vh] max-w-full rounded-md object-contain"
      />
      <span className="text-sm text-white">{caption}</span>
    </div>
  );
}

/**
 * 한 이벤트의 카메라별 사진 썸네일 줄. 누르면 크게 본다. 서명 주소가 만료돼 사진이 깨지면 새 주소를 받는다.
 * compact 는 관제 경보 카드용(작은 썸네일, 제목 없음).
 */
export function EventPhotos({
  event,
  title = '사진',
  compact = false,
}: {
  event: EventItem;
  title?: string;
  compact?: boolean;
}) {
  const { photos, reload } = useEventPhotos(event);
  const label = useCameraNames(photos.map((p) => p.camera_id));
  const [open, setOpen] = useState<string>();
  if (photos.length === 0) return null;
  const big = photos.find((p) => p.camera_id === open);

  return (
    <section data-photos aria-label={`${title} 사진`} className="flex flex-col gap-1.5">
      {!compact && <h3 className="text-sm text-muted-foreground">{title}</h3>}
      <ul className="flex flex-wrap gap-1.5">
        {photos.map((photo) => {
          const caption = captionOf(label(photo.camera_id), photo);
          return (
            <li key={photo.camera_id}>
              <button
                type="button"
                aria-label={`${caption} 사진 크게 보기`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(photo.camera_id);
                }}
                className="flex flex-col gap-0.5 rounded-md text-left hover:ring-1 hover:ring-point-soft"
              >
                <img
                  src={photo.url}
                  alt={caption}
                  loading="lazy"
                  draggable={false}
                  onError={reload}
                  className={
                    compact
                      ? 'aspect-video w-24 rounded-md bg-surface-3 object-cover'
                      : 'aspect-video w-36 rounded-md bg-surface-3 object-cover'
                  }
                />
                <span className="text-xs text-muted-foreground">{caption}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {big && (
        <Lightbox
          photo={big}
          caption={captionOf(label(big.camera_id), big)}
          onClose={() => setOpen(undefined)}
          onError={reload}
        />
      )}
    </section>
  );
}
