import { tileLabel } from '@/features/cctv/cctv';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { DIMMED, TILE_FRAME } from '@/features/cctv/tileStyle';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { ROOM } from '@/features/plan/plan';
import {
  AIM_ALL_ALIGNED_TEXT,
  AIM_ALL_SETUP_READY_TEXT,
  AIM_OVERLAY_LABEL,
} from '@/features/setup/aimCheck';
import { AimOverlay } from '@/features/setup/AimOverlay';
import type { CameraBadge } from '@/features/setup/cameraBadge';
import { CameraCue } from '@/features/setup/CameraCue';
import { CALIBRATION_RISK_TITLE } from '@/features/setup/cameraGuides';
import { cameraLabel, cameraText } from '@/features/setup/cameraLabels';
import type { NextStep } from '@/features/setup/nextStep';
import {
  CAMERA_HEIGHT_HELP,
  CANDIDATE_KIND_LABEL,
  MAP_TITLE,
  MAX_CAMERA_HEIGHT_M,
  type CoverageCameraView,
  type HeightFieldNote,
  type HeightFieldView,
  type HeightWarningItem,
  type SetupTone,
  type Step1CoverageView,
} from '@/features/setup/setup';
import { SetupMap } from '@/features/setup/SetupMap';
import { draftReason } from '@/features/setup/setupUx';
import { StageAWarning } from '@/features/setup/StageAWarning';
import type { SetupZoneDraftsResponse, ZoneDraftItem } from '@/features/setup/types';
import type { DraftAcceptFailure } from '@/features/setup/useAcceptZoneDraft';
import { useAimReferenceImages } from '@/features/setup/useAimReferenceImages';
import { useTwoCardsMaxHeight } from '@/features/setup/useTwoCardsMaxHeight';
import { DEFAULT_CCTV_PREVIEW_URL } from '@/lib/parseEnv';
import { SEVERITY_LABEL } from '@/lib/ruleNames';
import { Alert, AlertDescription, AlertTitle } from '@simai/ui/components/alert';
import { Badge } from '@simai/ui/components/badge';
import { Button } from '@simai/ui/components/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { cn } from '@simai/ui/lib/utils';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

// 세팅 화면 패널: 카메라 영상 4칸(칸마다 배지 하나, 기존 디코딩 재사용)·「지금 할 일」 카드·「자세히」(카메라 상태·겹침 2D 지도)·
// 카메라 높이 입력, 이후 단계 요약(S15P31A101-691 정리).
// 색은 위험 등급색(sev-critical·sev-high·sev-caution)과 겹치지 않는 토큰만 쓴다.

const DOT: Record<SetupTone, string> = {
  ok: 'bg-ok',
  active: 'bg-primary',
  delay: 'bg-delay',
  idle: 'bg-faint',
};

const TONE_BADGE: Record<SetupTone, string> = {
  ok: 'bg-ok/15 text-ok',
  active: 'bg-primary/15 text-point-soft',
  delay: 'bg-delay/15 text-delay',
  idle: 'bg-surface-3 text-muted-foreground',
};

const CAPTION =
  'absolute flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-xs backdrop-blur-[4px]';

/** 카메라 영상 미리보기 주소(현장 노트북 중계, 안 되면 EC2 원격 시청). 배경 촬영 창(-686)도 같은 값을 쓴다. */
export function readPreviewUrls() {
  const raw = import.meta.env as Record<string, unknown>;
  const localUrl =
    typeof raw.VITE_CCTV_PREVIEW_URL === 'string' && raw.VITE_CCTV_PREVIEW_URL.trim() !== ''
      ? raw.VITE_CCTV_PREVIEW_URL.trim()
      : DEFAULT_CCTV_PREVIEW_URL;
  const stompUrl =
    typeof raw.VITE_STOMP_URL === 'string' && raw.VITE_STOMP_URL.trim() !== ''
      ? raw.VITE_STOMP_URL.trim()
      : 'ws://localhost:8080/ws';
  return { localUrl, stompUrl };
}

function Dot({ tone }: { tone: SetupTone }) {
  return <i aria-hidden className={cn('size-2 flex-none rounded-full', DOT[tone])} />;
}

function Panel({
  title,
  children,
  dense = false,
  fill = 0,
}: {
  title: string;
  children: ReactNode;
  /** 세로 공간이 모자랄 때: 안쪽 간격을 줄인다. */
  dense?: boolean;
  /**
   * 놓인 칸의 남은 높이를 나눠 갖는 비율(같은 칸의 다른 패널과의 비). 0 이면 내용 높이 그대로다. 내용보다 작아지지는 않는다.
   */
  fill?: number;
}) {
  return (
    <Card
      size="sm"
      className={cn(fill > 0 && 'shrink-0')}
      style={fill > 0 ? { flexGrow: fill } : undefined}
    >
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('flex flex-col', dense ? 'gap-2' : 'gap-3', fill > 0 && 'grow')}>
        {children}
      </CardContent>
    </Card>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-1 flex-col divide-y divide-border">{children}</ul>;
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex flex-1 items-center gap-2.5 px-0.5 py-1 text-sm">{children}</li>;
}

/** 영상 칸 비율(중계가 영상 크기를 알리기 전). */
const TILE_ASPECT = 16 / 9;

/** 배지 톤 → 배지 모양(위험 등급색과 겹치지 않는 토큰). */
function CameraBadgeChip({ badge }: { badge: CameraBadge }) {
  return (
    <Badge
      data-badge={badge.kind}
      className={cn('h-auto rounded px-1.5 py-0.5 text-xs font-semibold', TONE_BADGE[badge.tone])}
    >
      {badge.label}
    </Badge>
  );
}

/**
 * 카메라 영상 한 칸. 이름표에는 카메라 이름과 배지 하나만 둔다(S15P31A101-691). 영상이 오지 않을 때만 칸을 흐리게 하고 영상 상태를
 * 덧붙인다(카메라 상태가 아니라 이 화면의 영상 중계 상태다). 각도 안내가 있으면 영상 위에 꺾쇠·같이 보는 곳을 얹는다.
 * 기준 시점 맞추기(S15P31A101-765)가 이 카메라를 판단했으면 옆 카메라 쌍 꺾쇠 대신 기준 시점 표시(십자선·목표 점·화살표·각도)를 얹고,
 * 재사용 허용 오차 안이면 칸 테두리 초록, 새 맵 세팅 허용 오차 안이면 노랑으로 한다. 기준 사진 겹쳐 보기를 켜면 기준 사진을 반투명으로 겹친다.
 */
function CameraTile({
  camera,
  attach,
  showBadge,
  referenceUrl,
}: {
  camera: CoverageCameraView;
  attach: (cameraId: string, canvas: HTMLCanvasElement | null) => void;
  showBadge: boolean;
  /** 겹쳐 볼 기준 사진(겹쳐 보기를 켰을 때만). */
  referenceUrl?: string;
}) {
  const phase = useCctvStore((s) => s.views[camera.id]?.phase);
  const videoWidth = useCctvStore((s) => s.views[camera.id]?.width);
  const videoHeight = useCctvStore((s) => s.views[camera.id]?.height);
  const link = useCctvStore((s) => s.link);
  const playing = link === 'open' && phase === 'playing';
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => attach(camera.id, canvas),
    [attach, camera.id],
  );
  const aspect = videoWidth && videoHeight ? videoWidth / videoHeight : TILE_ASPECT;
  const cues = showBadge && camera.status === 'OK' && camera.badge.kind !== 'DISCONNECTED';
  const aim = showBadge ? camera.aim : null;
  const aimKnown = aim !== null && aim.status !== 'UNKNOWN';
  return (
    <div
      data-testid="setup-camera-tile"
      data-aim={aim?.status}
      className={cn(
        TILE_FRAME,
        'min-h-0 bg-surface-2',
        aim?.aligned && 'after:ring-2 after:ring-ok',
        aim?.status === 'NEAR' && 'after:ring-2 after:ring-delay',
      )}
    >
      <canvas
        ref={ref}
        aria-label={`${camera.label} 영상`}
        className={cn('size-full object-contain', !playing && DIMMED)}
      />
      {cues &&
        !aimKnown &&
        camera.guides.map((guide) => <CameraCue key={guide.text} guide={guide} aspect={aspect} />)}
      <AimOverlay aim={aim} aspect={aspect} imageUrl={showBadge ? referenceUrl : undefined} />
      {aim && (
        <span
          data-testid="aim-text"
          className={cn(
            CAPTION,
            'bottom-2 left-2 max-w-[calc(100%-1rem)]',
            aim.aligned && 'text-ok',
            aim.status === 'NEAR' && 'text-delay',
          )}
        >
          {aim.setupReady && <CircleCheck aria-hidden className="size-3.5 flex-none" />}
          <span>{aim.text}</span>
        </span>
      )}
      <span className={cn(CAPTION, 'top-2 left-2')}>
        <span className="font-semibold">{camera.label}</span>
        {showBadge && <CameraBadgeChip badge={camera.badge} />}
        {!playing && (
          <span className="text-muted-foreground">
            {link === 'stopped' ? '미리보기 멈춤' : tileLabel(phase, link)}
          </span>
        )}
      </span>
    </div>
  );
}

type ReferenceUrls = Readonly<Record<string, string>> | undefined;

/**
 * 기준 시점 맞추기 기준 사진 주소를 받아 올려 준다(S15P31A101-765). 기준이 있을 때만 그린다: 영상 칸(미리보기 연결)을 다시 만들지 않으려고
 * 주소 받기를 따로 둔 칸으로 뺐다.
 */
function AimReferenceProbe({
  scene,
  onUrls,
}: {
  scene: string;
  onUrls: (loaded: { scene: string; urls: ReferenceUrls }) => void;
}) {
  const urls = useAimReferenceImages(scene);
  useEffect(() => onUrls({ scene, urls }), [scene, urls, onUrls]);
  return null;
}

/** 교실 모서리 위치대로 2×2 칸 순서(위 왼쪽 → 위 오른쪽 → 아래 왼쪽 → 아래 오른쪽). */
function camerasByCorner(cameras: readonly CoverageCameraView[]): CoverageCameraView[] {
  const top = (camera: CoverageCameraView) => camera.corner[1] >= ROOM.depth / 2;
  return [...cameras].sort((a, b) => Number(top(b)) - Number(top(a)) || a.corner[0] - b.corner[0]);
}

/**
 * 세팅의 카메라 영상 4칸(2×2, 교실 모서리 위치대로). 1단계와 보정·생성 단계 끝까지 같은 자리에 보인다(S15P31A101-691). 1단계는 칸마다
 * 배지 하나를 단다(showBadges). 보정·생성 중에는 각도 안내를 다시 받지 않아 배지 근거가 없으므로 배지를 달지 않는다.
 * 겹침 2D 지도는 「자세히」로 옮겼다(CameraStatusDetails).
 */
export function CameraVideoPanel({
  coverage,
  showBadges = true,
  title = MAP_TITLE[0],
}: {
  coverage: Step1CoverageView;
  showBadges?: boolean;
  /** 카드 제목. 보정·생성 단계처럼 위에 탭이 있으면 null 로 제목을 뺀다. */
  title?: string | null;
}) {
  const { localUrl, stompUrl } = readPreviewUrls();
  const { attach } = useCctvPreview(localUrl, stompUrl);
  // 기준 시점 맞추기(-765): 1단계에서 기준이 있을 때만. 겹쳐 보기는 기본 끔(지금 영상이 흐려지고 옛 물건 배치가 섞여 보인다)
  const aimScene = showBadges ? coverage.aimSceneVersion : null;
  const [loadedUrls, setLoadedUrls] = useState<{ scene: string; urls: ReferenceUrls }>();
  const referenceUrls =
    aimScene !== null && loadedUrls?.scene === aimScene ? loadedUrls.urls : undefined;
  const [overlay, setOverlay] = useState(false);
  const probe = aimScene !== null && <AimReferenceProbe scene={aimScene} onUrls={setLoadedUrls} />;
  const body = (
    <div
      role="group"
      aria-label="카메라 영상"
      className="grid size-full min-h-0 grid-cols-2 grid-rows-2 gap-3"
    >
      {camerasByCorner(coverage.cameras).map((camera) => (
        <CameraTile
          key={camera.id}
          camera={camera}
          attach={attach}
          showBadge={showBadges}
          referenceUrl={overlay ? referenceUrls?.[camera.id] : undefined}
        />
      ))}
    </div>
  );
  if (title === null)
    return (
      <>
        {probe}
        {body}
      </>
    );
  const allAligned = showBadges && coverage.aimAllAligned;
  // 4칸 모두 노랑 이상이면(모두 초록은 아님) 「새 맵 세팅 시작해도 됨」
  const allSetupReady = showBadges && !allAligned && coverage.aimAllSetupReady;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {(allAligned || allSetupReady || (aimScene !== null && referenceUrls !== undefined)) && (
          <CardAction className="flex items-center gap-3">
            {allAligned && (
              <span
                data-testid="aim-all-aligned"
                className="flex items-center gap-1.5 text-sm font-medium text-ok"
              >
                <CircleCheck aria-hidden className="size-4" />
                {AIM_ALL_ALIGNED_TEXT}
              </span>
            )}
            {allSetupReady && (
              <span
                data-testid="aim-all-setup-ready"
                className="flex items-center gap-1.5 text-sm font-medium text-delay"
              >
                <CircleCheck aria-hidden className="size-4" />
                {AIM_ALL_SETUP_READY_TEXT}
              </span>
            )}
            {aimScene !== null && referenceUrls !== undefined && (
              <Button
                size="sm"
                variant={overlay ? 'secondary' : 'outline'}
                aria-pressed={overlay}
                onClick={() => setOverlay((on) => !on)}
              >
                {AIM_OVERLAY_LABEL}
              </Button>
            )}
          </CardAction>
        )}
        {probe}
      </CardHeader>
      <CardContent className="min-h-0 flex-1">{body}</CardContent>
    </Card>
  );
}

/** 오른쪽 칸 맨 위 「지금 할 일」 카드 한 장(S15P31A101-691). 무엇이 / 어떻게 두 줄과, 있으면 진행 막대 같은 덧붙임(children). */
export function NextStepCard({ step, children }: { step: NextStep; children?: ReactNode }) {
  return (
    <Card size="sm" data-testid="setup-next-step" data-tone={step.tone}>
      <CardHeader>
        <CardTitle>
          <h2>지금 할 일</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p
          role="status"
          className={cn(
            'text-sm font-semibold',
            step.tone === 'delay' ? 'text-delay' : step.tone === 'ok' ? 'text-ok' : '',
          )}
        >
          {step.title}
        </p>
        <p className="text-sm text-muted-foreground">{step.detail}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/** 접어 두는 관리자용 「자세히」 묶음 하나(처음에는 닫힘). label 은 묶음 이름(예: '카메라 높이 자세히'), summary 는 접힌 줄 글. */
export function Details({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  summary: string;
  /** 처음부터 펼쳐 둔다(사용자가 접을 수 있다). */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details aria-label={label} open={defaultOpen} className="rounded-xl bg-card px-3.5 py-2.5">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
        {summary}
      </summary>
      <div className="mt-2.5 flex flex-col gap-2.5">{children}</div>
    </details>
  );
}

/**
 * 1단계 「자세히 · 카메라 상태」(관리자용, 처음엔 닫힘): 카메라마다 배지와 각도 안내 문장, 연결 요약, 겹침이 부족한 옆 쌍 안내,
 * 위에서 본 겹침 2D 지도(옆 카메라 4쌍 등급). 기본 화면은 영상 칸 배지와 「지금 할 일」만 보인다(S15P31A101-691).
 */
export function CameraStatusDetails({
  coverage,
  compact = false,
}: {
  coverage: Step1CoverageView;
  /** 처음부터 펼쳐 두고 겹침 지도를 낮게 그린다(시연 계정). */
  compact?: boolean;
}) {
  return (
    <Details label="카메라 상태 자세히" summary="자세히 · 카메라 상태" defaultOpen={compact}>
      <Rows>
        {coverage.cameras.map((cam) => (
          <Row key={cam.id}>
            <Dot tone={cam.tone} />
            <b>{cam.label}</b>
            <CameraBadgeChip badge={cam.badge} />
            <span
              className={cn(
                'ml-auto min-w-0 text-right text-xs',
                cam.guides.length > 0 ? 'font-semibold text-delay' : 'text-muted-foreground',
              )}
            >
              {cam.guideLabel}
            </span>
          </Row>
        ))}
      </Rows>
      {coverage.connectivitySummary !== '' && (
        <p className="text-xs text-muted-foreground">{coverage.connectivitySummary}</p>
      )}
      {coverage.riskyPairs.length > 0 && (
        <Alert className="border-delay/30 bg-delay/10 text-delay">
          <TriangleAlert aria-hidden />
          <AlertTitle>{CALIBRATION_RISK_TITLE}</AlertTitle>
          <AlertDescription className="text-xs text-foreground">
            {coverage.riskyPairs.join(', ')} 겹침이 부족합니다. 카메라를 돌리거나 겹치는 곳에 무늬
            있는 물건을 두세요.
          </AlertDescription>
        </Alert>
      )}
      <StageAWarning alerts={coverage.stageAAlerts} />
      <div className={cn('w-full', compact ? 'h-48' : 'aspect-square')}>
        <SetupMap stage={0} coverage={coverage} className="h-full max-h-none" />
      </div>
    </Details>
  );
}

/** 1단계 카메라별 실측 높이(바닥~렌즈 중심, m) 입력 패널. 높이 확인 창(-690)도 같은 모양으로 쓴다. */
export function CameraHeightPanel({
  fields,
  onChange,
  submitError,
  onNavigateLiveWork,
  errorAction,
  heightWarnings = [],
  retrySessionId = null,
  onRetryWithHeights,
  retryLabel = '다시 시도',
  retryPending = false,
  canSubmitHeights = true,
  fieldNotes,
}: {
  fields: readonly HeightFieldView[];
  onChange: (cameraId: string, value: string) => void;
  submitError: string | null;
  onNavigateLiveWork?: () => void;
  /** 오류 글 옆에 놓을 단추(막는 세팅 취소 등). */
  errorAction?: ReactNode;
  heightWarnings?: readonly HeightWarningItem[];
  retrySessionId?: string | null;
  onRetryWithHeights?: () => void;
  /** 고친 높이로 다시 하는 단추 글(멈춘 세팅은 이어서 만들기). */
  retryLabel?: string;
  retryPending?: boolean;
  canSubmitHeights?: boolean;
  /** 카메라별 오른쪽 위 글(높이 확인 창: 「맞음」·「다른 카메라보다 약 n cm 낮게 보임」, -690). 주면 기본 글 대신 쓴다. */
  fieldNotes?: Readonly<Record<string, HeightFieldNote>>;
}) {
  const warnedCamIds = new Set([
    ...heightWarnings.map((w) => w.cameraId),
    ...Object.entries(fieldNotes ?? {})
      .filter(([, note]) => note.warn)
      .map(([cameraId]) => cameraId),
  ]);
  const cameraIds = fields.map((f) => f.cameraId);
  return (
    <Panel title="카메라 높이 입력 (바닥~렌즈 중심, m)" dense fill={1}>
      <p className="text-xs text-muted-foreground">{CAMERA_HEIGHT_HELP}</p>
      {heightWarnings.length > 0 && (
        <div
          role="alert"
          aria-label="카메라 높이 불일치 수정 안내"
          className="flex flex-col gap-1.5 rounded-lg bg-delay/15 px-3 py-2 text-xs text-delay"
        >
          <p className="font-semibold">
            높이 불일치 카메라:{' '}
            {heightWarnings.map((w) => cameraLabel(cameraIds, w.cameraId)).join(', ')}
          </p>
          {heightWarnings.map((w) => (
            <p key={w.cameraId} className="font-mono text-[11px]">
              {w.message}
            </p>
          ))}
        </div>
      )}
      <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-2">
        {fields.map((field) => {
          const inputId = `camera-height-${field.cameraId}`;
          const needsInput = field.required || field.missing;
          const isWarned = warnedCamIds.has(field.cameraId);
          const note = fieldNotes?.[field.cameraId];
          return (
            <div
              key={field.cameraId}
              className={cn(
                'flex flex-col justify-center gap-1 rounded-lg bg-surface-2 px-3 py-1.5',
                isWarned && 'ring-1 ring-delay',
              )}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <label htmlFor={inputId} className="font-semibold text-foreground">
                  {cameraLabel(cameraIds, field.cameraId)} 높이 (m)
                </label>
                <span
                  className={cn(
                    'text-[11px]',
                    field.missing || field.invalid || isWarned
                      ? 'font-semibold text-delay'
                      : note
                        ? 'text-ok'
                        : 'text-muted-foreground',
                  )}
                >
                  {note && !field.missing && !field.invalid
                    ? note.text
                    : field.missing
                      ? '입력 필수'
                      : field.invalid
                        ? `0~${MAX_CAMERA_HEIGHT_M}m 입력`
                        : isWarned
                          ? '높이 재확인 필요'
                          : field.required
                            ? '신규 입력'
                            : '지난 제출값'}
                </span>
              </div>
              <input
                id={inputId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={MAX_CAMERA_HEIGHT_M}
                required={needsInput}
                aria-invalid={field.missing || field.invalid || isWarned}
                placeholder="예: 2.70"
                value={field.rawValue}
                onChange={(e) => onChange(field.cameraId, e.target.value)}
                className={cn(
                  'h-7 w-full rounded-md border bg-card px-2.5 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  field.missing || field.invalid || isWarned ? 'border-delay' : 'border-border',
                )}
              />
            </div>
          );
        })}
      </div>
      {retrySessionId && onRetryWithHeights && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            disabled={!canSubmitHeights || retryPending}
            onClick={onRetryWithHeights}
          >
            {retryLabel}
          </Button>
        </div>
      )}
      {submitError && (
        <div
          role="alert"
          data-testid="setup-submit-error"
          className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-delay"
        >
          <span>{submitError}</span>
          {onNavigateLiveWork && (
            <Button size="sm" variant="secondary" onClick={onNavigateLiveWork}>
              진행 중인 작업으로 이동
            </Button>
          )}
          {errorAction}
        </div>
      )}
    </Panel>
  );
}

/** AI 위험 구역 초안(수락·버리기) 패널. */
export function AiZoneDraftsPanel({
  draftsResponse,
  acceptedDraftIds,
  discardedDraftIds,
  pendingDraftId,
  acceptFailure,
  onAcceptDraft,
  onDiscardDraft,
  cameraIds = [],
  mergedDraftIds = [],
  canImportPrevious = false,
  pendingText = 'AI 구역 초안 분석 중',
  onHoverDraft,
}: {
  draftsResponse: SetupZoneDraftsResponse | null;
  /** 구역으로 만든 초안. */
  acceptedDraftIds: readonly string[];
  discardedDraftIds: readonly string[];
  /** 구역으로 만드는 중인 초안. 그동안 다른 초안은 수락하지 않는다. */
  pendingDraftId: string | null;
  acceptFailure: DraftAcceptFailure | null;
  onAcceptDraft: (item: ZoneDraftItem) => void;
  onDiscardDraft: (candidateId: string) => void;
  cameraIds?: readonly string[];
  /** 같은 자리의 이어 온 구역과 한 항목으로 묶어 「이어 쓴 구역 확인」에서 고르는 초안(S15P31A101-758). 여기서는 감춘다. */
  mergedDraftIds?: readonly string[];
  /** 초안이 없을 때 「이전 구역 불러오기」를 권할지(새 모델 + World 이어짐). */
  canImportPrevious?: boolean;
  /** 초안을 찾는 동안 보이는 글. */
  pendingText?: string;
  /** 카드에 커서를 대고(candidateId) 뗄(null) 때 알린다. 3D 에서 그 초안을 도드라지게 보이는 데 쓴다. */
  onHoverDraft?: (candidateId: string | null) => void;
}) {
  const allDrafts = draftsResponse?.drafts ?? [];
  const visibleDrafts = allDrafts.filter(
    (d) => !discardedDraftIds.includes(d.candidate_id) && !mergedDraftIds.includes(d.candidate_id),
  );
  const merged = allDrafts.filter(
    (d) => mergedDraftIds.includes(d.candidate_id) && !discardedDraftIds.includes(d.candidate_id),
  );
  // 분석이 끝났는데(실패 포함) 초안이 하나도 없다: 시연은 개구부 하나를 기대한다(S15P31A101-671, -758)
  const noneFound =
    draftsResponse != null &&
    (draftsResponse.status === 'FAILED' || allDrafts.length === 0) &&
    draftsResponse.status !== 'QUEUED' &&
    draftsResponse.status !== 'NOT_REQUESTED';
  // 초안이 많아도 카드 두 장 높이까지만 보이고 나머지는 목록 안에서 스크롤한다.
  const listRef = useTwoCardsMaxHeight();

  return (
    <Panel title="AI 위험 구역 초안" fill={1}>
      {draftsResponse?.status === 'QUEUED' || draftsResponse?.status === 'NOT_REQUESTED' ? (
        <p className="text-xs text-muted-foreground">{pendingText}</p>
      ) : noneFound ? (
        <p role="status" className="text-xs text-muted-foreground">
          {canImportPrevious
            ? 'AI 가 개구부를 찾지 못했어요 — 직접 그리거나 이전 구역을 불러오세요'
            : 'AI 가 개구부를 찾지 못했어요 — 직접 그려 주세요'}
        </p>
      ) : visibleDrafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {merged.length > 0
            ? `${merged.map((d) => `「${cameraText(cameraIds, d.recommended_name)}」`).join(', ')}은(는) 같은 자리의 이전 구역과 묶어 위 「이어 쓴 구역 확인」에서 골라요.`
            : 'AI 구역 초안 없음'}
        </p>
      ) : (
        <ul
          ref={listRef}
          aria-label="AI 구역 초안 목록"
          className="relative flex flex-col gap-2.5 overflow-y-auto pr-1"
        >
          {visibleDrafts.map((item) => {
            const name = cameraText(cameraIds, item.recommended_name);
            const isAccepted = acceptedDraftIds.includes(item.candidate_id);
            const isNoOpinion = item.no_opinion;
            return (
              <li
                key={item.candidate_id}
                data-candidate-id={item.candidate_id}
                data-no-opinion={isNoOpinion ? 'true' : 'false'}
                onMouseEnter={() => onHoverDraft?.(item.candidate_id)}
                onMouseLeave={() => onHoverDraft?.(null)}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs',
                  isNoOpinion
                    ? 'border-muted-foreground/50 bg-surface-3/60 text-muted-foreground'
                    : 'border-primary/40 bg-surface-2 text-foreground',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-sm font-semibold text-foreground">{name}</strong>
                    <Badge className="h-auto rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {CANDIDATE_KIND_LABEL[item.candidate_kind]}
                    </Badge>
                    {isNoOpinion ? (
                      <Badge
                        aria-label={`${name} AI 의견 없음`}
                        className="h-auto rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground"
                      >
                        AI 의견 없음
                      </Badge>
                    ) : (
                      <Badge
                        className={cn(
                          'h-auto rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold',
                          item.recommended_severity === 'CRITICAL'
                            ? 'bg-sev-critical/15 text-sev-critical'
                            : 'bg-sev-high/15 text-sev-high',
                        )}
                      >
                        {SEVERITY_LABEL[item.recommended_severity]}
                      </Badge>
                    )}
                    {isAccepted && (
                      <Badge className="h-auto rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-point-soft">
                        반영됨
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{draftReason(item)}</p>
                <details aria-label={`${name} 근거 자세히`}>
                  <summary className="cursor-pointer text-muted-foreground">자세히</summary>
                  <p className="mt-2">{cameraText(cameraIds, item.rationale)}</p>
                  <p className="mt-1 font-mono text-muted-foreground">
                    높이 범위 {item.z_min_m.toFixed(1)}~{item.z_max_m.toFixed(1)}m
                    {item.confidence != null
                      ? ` · 신뢰도 ${Math.round(item.confidence * 100)}%`
                      : ''}
                  </p>
                </details>

                {acceptFailure?.candidateId === item.candidate_id && (
                  <p role="alert" className="text-xs font-medium text-delay">
                    {acceptFailure.text}
                  </p>
                )}

                {!isAccepted && (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${name} 버리기`}
                      disabled={pendingDraftId === item.candidate_id}
                      onClick={() => onDiscardDraft(item.candidate_id)}
                    >
                      버리기
                    </Button>
                    <Button
                      size="sm"
                      aria-label={`${name} 수락`}
                      disabled={pendingDraftId !== null}
                      onClick={() => onAcceptDraft(item)}
                    >
                      수락
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
