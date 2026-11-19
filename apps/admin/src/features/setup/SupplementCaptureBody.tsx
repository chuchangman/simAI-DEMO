import {
  phoneSupplementUrl,
  rebakeBlockedText,
  supplementLimitText,
  uploadBlockedText,
  type RebakeTone,
} from '@/features/setup/supplement';
import { SupplementQr } from '@/features/setup/SupplementQr';
import { SupplementUploadList } from '@/features/setup/SupplementUploadList';
import type { useSupplementCapture } from '@/features/setup/useSupplementCapture';
import { Badge } from '@simai/ui/components/badge';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useRef, useState, type DragEvent } from 'react';

// 「맵 보강 촬영(선택)」 모달의 본문(S15P31A101-607). 미리보기 맵이 생긴 뒤 고정 카메라가 못 본 곳을 휴대폰(QR)이나
// PC 파일(액션캠·DSLR 파일 끌어 놓기)로 올리고, 고정 카메라 4대와 함께 맵을 다시 굽는다. 결과는 반영됨 / 원래 맵 유지 + 사유.
// 올리기·다시 굽기 상태(capture)는 모달이 쥐고 있다 — 아래 단추 줄이 올린 파일 유무로 글자를 바꾸기 때문이다.

const TONE_BADGE: Record<RebakeTone, string> = {
  ok: 'bg-ok/15 text-ok',
  active: 'bg-primary/15 text-point-soft',
  idle: 'bg-surface-3 text-muted-foreground',
};

/** 맵이 비기 쉬운 곳(고정 카메라 4대가 함께 보지 못하는 곳). */
const EMPTY_SPOTS = [
  '책상·기둥·사물함 뒤',
  '카메라 바로 아래 벽 쪽',
  '문 옆·창가 구석',
  '바닥이 가려진 통로',
] as const;

const ACCEPT = 'video/mp4,video/quicktime,image/jpeg,image/png,.mp4,.mov,.jpg,.jpeg,.png';

const SOFT_BUTTON = 'bg-surface-3 hover:bg-surface-3/70';

export function SupplementCaptureBody({
  sessionId,
  capture,
}: {
  sessionId: string;
  capture: ReturnType<typeof useSupplementCapture>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const phoneUrl = phoneSupplementUrl(window.location.origin, sessionId);
  const view = capture.rebakeView;
  // 맵에 넣을 파일이 있는데 서버가 굽게 해 주지 않을 때만 그 이유를 보인다(다시 굽기 단추는 창 아래 단추 줄에 있다)
  const blockedText =
    capture.pendingMedia.length > 0 && !capture.canRebakeNow
      ? rebakeBlockedText(capture.supplement?.rebake_blocked_reason)
      : null;

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (!capture.canUpload) return;
    capture.addFiles([...event.dataTransfer.files]);
  };

  const copyLink = () => {
    void navigator.clipboard
      ?.writeText(phoneUrl)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <p className="font-medium text-foreground">맵이 비어 보이는 곳을 따로 찍어 올리세요</p>
        <ul aria-label="맵이 비기 쉬운 곳" className="mt-1 list-disc pl-4 text-muted-foreground">
          {EMPTY_SPOTS.map((spot) => (
            <li key={spot}>{spot}</li>
          ))}
        </ul>
      </div>

      <div className="flex items-start gap-3">
        <SupplementQr value={phoneUrl} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-medium text-foreground">휴대폰으로 찍기</p>
          <a
            href={phoneUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-point-soft underline-offset-2 hover:underline"
          >
            {phoneUrl}
          </a>
          <div>
            <Button size="xs" variant="secondary" onClick={copyLink}>
              {copied ? '복사함' : '주소 복사'}
            </Button>
          </div>
        </div>
      </div>

      {capture.canUpload ? (
        <div
          data-testid="supplement-drop-zone"
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-center',
            dragOver && 'border-primary bg-primary/10',
          )}
        >
          <p className="text-muted-foreground">
            액션캠·DSLR 동영상(mp4·mov)이나 사진(jpg·png)을 여기에 끌어 놓으세요
          </p>
          <p className="text-xs text-muted-foreground">{supplementLimitText(capture.limits)}</p>
          <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
            파일 고르기
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            aria-label="보강 촬영 파일 고르기"
            className="hidden"
            onChange={(event) => {
              capture.addFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
        </div>
      ) : (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2 text-muted-foreground">
          {uploadBlockedText(capture.supplement?.rebake_blocked_reason)}
        </p>
      )}

      <SupplementUploadList
        rows={capture.rows}
        rejected={capture.rejected}
        onAction={capture.onRowAction}
        removingMediaId={capture.removingMediaId}
      />

      {view && (
        <div
          role="status"
          aria-label="다시 굽기 상태"
          className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                'h-auto rounded px-2 py-0.5 text-xs font-semibold',
                TONE_BADGE[view.tone],
              )}
            >
              {view.title}
            </Badge>
            {view.detail && <span className="text-muted-foreground">{view.detail}</span>}
          </div>
          {view.progressPct !== null && (
            <div
              role="progressbar"
              aria-label="다시 굽기 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view.progressPct}
              className="h-1.5 overflow-hidden rounded-full bg-surface-3"
            >
              <div className="h-full bg-primary" style={{ width: `${view.progressPct}%` }} />
            </div>
          )}
          {view.media.length > 0 && (
            <ul aria-label="파일별 결과" className="flex flex-col gap-0.5">
              {view.media.map((m) => (
                <li key={m.mediaId} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className={m.used ? 'text-ok' : 'text-muted-foreground'}>{m.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {capture.error && (
        <p role="alert" className="text-foreground">
          {capture.error}
        </p>
      )}

      {(view?.running || blockedText) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {view?.running ? (
            <Button
              size="sm"
              variant="secondary"
              className={SOFT_BUTTON}
              disabled={capture.cancelPending}
              onClick={capture.cancelRebake}
            >
              다시 굽기 취소
            </Button>
          ) : (
            <span className="text-muted-foreground">{blockedText}</span>
          )}
        </div>
      )}
    </div>
  );
}
