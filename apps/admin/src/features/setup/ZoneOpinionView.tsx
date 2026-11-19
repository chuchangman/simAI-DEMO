import { cameraLabel, cameraText } from '@/features/setup/cameraLabels';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import type { ZoneAiAction, ZoneAiOpinion, ZoneOpinionPhoto } from '@/features/zones/types';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useState, type CSSProperties } from 'react';

// 변경 의심 구역의 AI 의견과 전후 사진(S15P31A101-631). 이전·이번 세팅의 같은 카메라 대표 프레임(서버 서명 주소)을 워커가 낸
// 크롭 박스로 잘라 보인다(사진을 새로 올리지 않는다). 의견은 표시용 제안이고 구역 목록·확인 필요를 바꾸지 않는다(AGENTS 규칙 4).

const ACTION_LABEL: Record<ZoneAiAction, string> = {
  KEEP: '유지 권고',
  MODIFY: '수정 권고',
  REMOVE: '삭제 권고',
};

const ACTION_BADGE_CLASS: Record<ZoneAiAction, string> = {
  KEEP: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  MODIFY: 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  REMOVE: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
};

const MUTED_BADGE_CLASS = 'border-border bg-muted/50 text-muted-foreground';

/** 의견 없음 사유(계약 vlm_zone_draft 1.1.0 zone_opinion_reason) 짧은 말. 모르는 값은 그대로 두지 않고 빈칸으로 둔다. */
const REASON_TEXT: Record<string, string> = {
  NO_PREVIOUS_FRAMES: '이전 세팅 사진이 없습니다',
  PREVIOUS_FRAMES_UNAVAILABLE: '이전 사진을 읽지 못했습니다',
  CURRENT_FRAMES_UNAVAILABLE: '이번 사진을 읽지 못했습니다',
  CALIBRATION_UNAVAILABLE: '보정을 읽지 못했습니다',
  NOT_VISIBLE: '두 사진에 함께 잘 보이는 카메라가 없습니다',
  VLM_UNAVAILABLE: 'AI 모델을 쓸 수 없습니다',
  VLM_FAILED: 'AI 응답을 받지 못했습니다',
  TIME_BUDGET: '시간이 모자라 건너뛰었습니다',
  ZONE_LIMIT: '한 번에 볼 수 있는 구역 수를 넘었습니다',
};

/** 배지 글. */
export function opinionLabel(opinion: ZoneAiOpinion): string {
  if (opinion.status === 'PENDING') return 'AI 의견 준비 중';
  if (opinion.status === 'OPINION' && opinion.recommended_action) {
    return ACTION_LABEL[opinion.recommended_action];
  }
  return 'AI 의견 없음';
}

/** 한 줄 설명: 의견이면 AI 이유, 의견 없음이면 사유. */
export function opinionLine(opinion: ZoneAiOpinion): string | null {
  if (opinion.status === 'OPINION') return opinion.rationale;
  if (opinion.status === 'NO_OPINION')
    return (opinion.reason && REASON_TEXT[opinion.reason]) || null;
  return null;
}

type Box = readonly [number, number, number, number];

/** 크롭 박스가 0~1 안이고 순서가 맞으면 그대로, 아니면 사진 전체. */
export function safeBox(box: ZoneOpinionPhoto['crop_box_norm'] | undefined): Box {
  if (!box) return [0, 0, 1, 1];
  const [u1, v1, u2, v2] = box;
  const inUnit = box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
  return inUnit && u1 < u2 && v1 < v2 ? [u1, v1, u2, v2] : [0, 0, 1, 1];
}

/** 크롭 영역이 틀을 꽉 채우도록 원본 사진을 키우고 옮기는 스타일(틀 비율이 크롭 비율과 같을 때 정확하다). */
export function cropImageStyle(box: Box): CSSProperties {
  const [u1, v1, u2, v2] = box;
  const bw = u2 - u1;
  const bh = v2 - v1;
  return {
    width: `${100 / bw}%`,
    height: `${100 / bh}%`,
    left: `${(-100 * u1) / bw}%`,
    top: `${(-100 * v1) / bh}%`,
  };
}

/** 사진 한 장의 크롭. 원본 크기를 읽은 뒤 틀 비율을 크롭 비율로 맞춘다(읽기 전에는 4:3). */
export function CroppedPhoto({
  photo,
  alt,
  className,
}: {
  photo: ZoneOpinionPhoto | null;
  alt: string;
  className?: string;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const url = photo?.image_url ?? null;
  if (!url || failed) {
    return (
      <div
        className={cn(
          'grid aspect-[4/3] w-full place-items-center rounded bg-muted text-[11px] text-muted-foreground',
          className,
        )}
      >
        사진 없음
      </div>
    );
  }
  const box = safeBox(photo?.crop_box_norm);
  const aspect =
    natural && natural.h > 0
      ? ((box[2] - box[0]) * natural.w) / ((box[3] - box[1]) * natural.h)
      : 4 / 3;
  return (
    <div
      className={cn('relative w-full overflow-hidden rounded bg-muted', className)}
      style={{ aspectRatio: String(aspect) }}
    >
      <img
        src={url}
        alt={alt}
        draggable={false}
        onLoad={(e) =>
          setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
        }
        onError={() => setFailed(true)}
        className="absolute max-w-none select-none"
        style={cropImageStyle(box)}
      />
    </div>
  );
}

function PhotoPair({
  opinion,
  large = false,
  cameraIds,
}: {
  opinion: ZoneAiOpinion;
  large?: boolean;
  cameraIds: readonly string[];
}) {
  const camera = opinion.camera_id ? ` · ${cameraLabel(cameraIds, opinion.camera_id)}` : '';
  return (
    <div className={cn('grid grid-cols-2', large ? 'gap-3' : 'gap-1.5')}>
      <figure className="flex min-w-0 flex-col gap-0.5">
        <CroppedPhoto photo={opinion.before} alt={`이전 세팅${camera}`} />
        <figcaption className="truncate text-[11px] text-muted-foreground">{`이전${camera}`}</figcaption>
      </figure>
      <figure className="flex min-w-0 flex-col gap-0.5">
        <CroppedPhoto photo={opinion.after} alt={`이번 세팅${camera}`} />
        <figcaption className="truncate text-[11px] text-muted-foreground">{`이번${camera}`}</figcaption>
      </figure>
    </div>
  );
}

/** 구역 행 아래의 의견 칸: 배지 + 한 줄 + 전후 썸네일(누르면 크게 보기). */
export function ZoneOpinionBlock({
  zoneName,
  opinion,
  cameraIds = [],
}: {
  zoneName: string;
  opinion: ZoneAiOpinion;
  cameraIds?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const action = opinion.status === 'OPINION' ? opinion.recommended_action : null;
  const rawLine = opinionLine(opinion);
  const line = rawLine ? cameraText(cameraIds, rawLine) : null;
  const hasPhotos = Boolean(opinion.before?.image_url || opinion.after?.image_url);
  return (
    <div
      data-ai-opinion={opinion.status}
      className="ml-1 flex flex-col gap-1 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-[12px]"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium',
            action ? ACTION_BADGE_CLASS[action] : MUTED_BADGE_CLASS,
          )}
        >
          {opinionLabel(opinion)}
        </span>
        <span className="text-[11px] text-muted-foreground">AI 제안 · 직접 확인하세요</span>
      </div>
      {line && <p className="leading-snug">{line}</p>}
      {hasPhotos && (
        <button
          type="button"
          aria-label={`${zoneName} 전후 사진 크게 보기`}
          onClick={() => setOpen(true)}
          className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PhotoPair opinion={opinion} cameraIds={cameraIds} />
        </button>
      )}
      {open && (
        <ModalDialog
          label={`${zoneName} 전후 사진`}
          onClose={() => setOpen(false)}
          closeOnBackdrop
          className="w-[min(960px,92vw)]"
        >
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <h4 className="min-w-0 flex-1 truncate text-sm font-medium">{`${zoneName} · ${opinionLabel(opinion)}`}</h4>
              <Button
                variant="secondary"
                className="h-7 px-2 text-[12px]"
                onClick={() => setOpen(false)}
              >
                닫기
              </Button>
            </div>
            {line && <p className="text-[13px]">{line}</p>}
            <PhotoPair opinion={opinion} cameraIds={cameraIds} large />
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
