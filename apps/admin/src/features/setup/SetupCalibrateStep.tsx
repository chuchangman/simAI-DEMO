import {
  REPLAY_SKIP_DETAIL,
  REPLAY_SKIP_LABEL,
  type CameraCheckView,
  type PairOutcome,
} from '@/features/setup/cameraCheck';
import { cameraLabel } from '@/features/setup/cameraLabels';
import type { NextStep } from '@/features/setup/nextStep';
import {
  deriveStageRows,
  formatMinSec,
  WAITING_STAGES,
  type HeightCheckRowView,
  type HeightWarningItem,
  type SetupWaitingView,
  type SetupWaitReasonView,
  type WaitingStageRowView,
  type WaitingStepStatus,
} from '@/features/setup/setup';
import { failureGuide } from '@/features/setup/setupFailures';
import { Details, NextStepCard } from '@/features/setup/SetupPanels';
import { SetupPreviewViewport, SetupSplit } from '@/features/setup/SetupPreviewModel';
import { Button } from '@simai/ui/components/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { cn } from '@simai/ui/lib/utils';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

// 세팅 2단계 '보정·생성'(S15P31A101-691 정리). 1단계와 같은 두 칸 배치(SetupSplit).
// 왼쪽: 카메라 영상 4칸이 보이고, 미리보기 맵이 준비되면(85%) 「3D 미리보기」 탭으로 바꿔 볼 수 있다. 정밀 3D 맵까지 끝나면 3D 로 바뀐다.
// 오른쪽: 「지금 할 일」 카드 한 장(무엇이 / 어떻게 + 전체 진행 막대 하나)과 실패 안내. 진단(5단계 막대·단계별 %·경과 시간·대기 이유
// 덧붙임·카메라별 배경 수집 %·높이 불일치 문구·복원 높이 표·쌍별 px 표)은 관리자용 「자세히」로 접는다. 막대·%는 서버 값만 쓴다.
// 사람이 움직일 일(배경 촬영·높이 확인·카메라 확인 걷기)은 큰 창이 맡는다(-686·-690·-687). 맵 보강 촬영은 '다음' 에 끼어들지 않고
// 「자세히 · 맵 보강」에서만 연다. 서버가 더는 내지 않는 옛 품질 게이트 멈춤 안내(PausedNotice)는 지웠다(-690 메모).

/** 새 진행 정보 없이 이만큼(초) 지나면 멈춘 것으로 알린다. */
const STALLED_AFTER_SEC = 30;

const VALUE_TONE: Record<WaitingStepStatus, string> = {
  done: 'text-ok',
  current: 'text-foreground',
  upcoming: 'text-muted-foreground',
  failed: 'font-semibold text-delay',
  paused: 'font-semibold text-delay',
};

function stageValueText(row: WaitingStageRowView): string {
  if (row.status === 'done') return '완료';
  if (row.status === 'upcoming') return '대기';
  if (row.status === 'failed') return '실패';
  if (row.status === 'paused') return '멈춤';
  return `${Math.round(row.stagePct)}%`;
}

/** 세팅이 왜 기다리는지 한 줄 + 대기 시간 + 할 수 있는 일(S15P31A101-583). */
function WaitReasonNotice({ reason, now }: { reason: SetupWaitReasonView; now: number }) {
  const waited = Math.max(0, Math.floor((now - reason.sinceMs) / 1000));
  const lastSeen =
    reason.lastSeenMs === null
      ? '연결 기록 없음'
      : `마지막 연결 ${formatMinSec(Math.max(0, (now - reason.lastSeenMs) / 1000))} 전`;
  return (
    <div
      role="status"
      aria-label="세팅 대기 이유"
      className={cn(
        'flex flex-col gap-1 rounded-md px-2.5 py-2 text-xs',
        reason.tone === 'delay' ? 'bg-delay/15 text-delay' : 'bg-surface-3 text-muted-foreground',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{reason.title}</span>
        <span className="font-mono">
          대기 {formatMinSec(waited)}
          {reason.showLastSeen ? ` · ${lastSeen}` : ''}
        </span>
      </div>
      {reason.notes.map((note) => (
        <span key={note} className="font-mono text-[11px]">
          {note}
        </span>
      ))}
      <span className="text-foreground">{reason.hint}</span>
    </div>
  );
}

/** 5단계 막대와 진행률·경과 시간. 서버 대기 이유·지연·접수 안내도 이 카드 안에 보인다. */
function ProgressCard({
  waiting,
  pollingError,
}: {
  waiting: SetupWaitingView;
  pollingError: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - (waiting.startedAtMs ?? openedAt)) / 1000));
  const unchanged = Math.max(
    0,
    Math.floor((now - (waiting.updatedAtMs ?? waiting.startedAtMs ?? openedAt)) / 1000),
  );
  const stalled =
    !waiting.failed &&
    waiting.pausedStageIndex === null &&
    !waiting.previewReady &&
    unchanged >= STALLED_AFTER_SEC;
  const percent = waiting.progressPct;
  const rows = deriveStageRows(
    waiting.progressPct,
    waiting.failedStageIndex,
    waiting.pausedStageIndex,
  );
  const currentIndex = rows.find((row) => row.status === 'current')?.index;
  const stageKey = `${waiting.sessionId}:${currentIndex}`;
  const enteredAt = (currentIndex === 0 ? waiting.startedAtMs : waiting.updatedAtMs) ?? openedAt;
  const [stageClock, setStageClock] = useState({ key: stageKey, since: enteredAt });
  if (stageClock.key !== stageKey) {
    // 같은 단계의 하위 진행·카메라 확인 updated_at 은 경과 시간을 초기화하지 않는다.
    setStageClock({ key: stageKey, since: waiting.updatedAtMs ?? now });
  }
  const stageElapsed = Math.max(0, Math.floor((now - stageClock.since) / 1000));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>진행 단계</h2>
        </CardTitle>
        <CardAction className="flex items-baseline gap-2 font-mono text-xs">
          <span
            role="progressbar"
            aria-label="세팅 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="font-semibold text-foreground"
          >
            진행 {percent}%
          </span>
          <span className="text-muted-foreground">경과 {formatMinSec(elapsed)}</span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        {pollingError ? (
          <p role="alert" className="text-xs text-delay">
            서버에서 진행 상태를 가져오지 못했습니다. 연결을 확인해 주세요.
          </p>
        ) : waiting.waitReason ? (
          <WaitReasonNotice reason={waiting.waitReason} now={now} />
        ) : stalled ? (
          <p role="status" className="text-xs text-delay">
            {unchanged}초 동안 새 진행 정보가 없습니다. 계속 유지되면 워커와 배경 수집 상태를 확인해
            주세요.
          </p>
        ) : !waiting.failed && waiting.progressPct === 0 ? (
          <p role="status" className="text-xs text-muted-foreground">
            세팅 요청이 접수됐습니다. 워커의 진행 정보를 기다리는 중입니다.
          </p>
        ) : null}

        <ol aria-label="보정·생성 단계" className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <li key={row.stage} data-status={row.status} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                <span className={cn(row.status === 'upcoming' && 'text-muted-foreground')}>
                  {row.label}
                </span>
                <span className={cn('font-mono text-xs font-medium', VALUE_TONE[row.status])}>
                  {row.status === 'current' && (
                    <span className="mr-2 inline-flex items-center gap-1 text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                      />
                      진행 중 · {formatMinSec(stageElapsed)} 경과
                    </span>
                  )}
                  {stageValueText(row)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${row.label} 진행률`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(row.stagePct)}
                className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className={cn(
                    'h-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
                    row.status === 'failed' || row.status === 'paused' ? 'bg-delay' : 'bg-primary',
                  )}
                  style={{ width: `${Math.round(row.stagePct)}%` }}
                />
              </div>
              {row.index === 0 && row.status === 'current' && (
                <p role="status" className="rounded-md bg-surface-2 px-2.5 py-2 text-xs">
                  배경을 모으는 동안 카메라 앞에서 비켜 주세요.
                </p>
              )}
              {row.index === 0 &&
                (row.status === 'current' || row.status === 'failed') &&
                waiting.backgroundCollection.length > 0 && (
                  <p
                    aria-label="카메라별 배경 수집 진행률"
                    className="font-mono text-xs text-muted-foreground"
                  >
                    {waiting.backgroundCollection
                      .map((cam) => `${cameraLabel(waiting.cameraIds, cam.cameraId)} ${cam.pct}%`)
                      .join(' · ')}
                  </p>
                )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** 실패 안내: 어느 단계에서 멈췄는지, 원인, 해결, 그리고 다시 시도(가능할 때)·카메라 연결 관리로 단추. */
function FailureNotice({
  waiting,
  retryPending,
  onRetry,
  onRetryNewMap,
  changedCameras,
  repeatedValidationPairs,
  onReturnToStep1,
  onTurnOnGpu,
}: {
  waiting: SetupWaitingView;
  retryPending: boolean;
  onRetry: () => void;
  onRetryNewMap?: () => void;
  changedCameras?: readonly string[];
  repeatedValidationPairs?: string;
  onReturnToStep1: () => void;
  onTurnOnGpu?: () => void;
}) {
  const guide = failureGuide(
    waiting.failureCode,
    waiting.failureMessage,
    waiting.cameraIds,
    changedCameras,
    {
      cameraCheck: waiting.cameraCheck,
      backgroundCollection: waiting.backgroundCollection,
      repeatedValidationPairs,
    },
  );
  const newMap = guide.newMap && onRetryNewMap !== undefined;
  const stage =
    waiting.failedStageIndex === null ? undefined : WAITING_STAGES[waiting.failedStageIndex];
  return (
    <div
      role="alert"
      aria-label="세팅 실패 안내"
      className="flex flex-col gap-1.5 rounded-lg bg-delay/15 px-3.5 py-3 text-sm"
    >
      {stage && (
        <span className="text-xs text-muted-foreground">{stage.label} 단계에서 멈췄어요</span>
      )}
      <span className="font-semibold text-delay">{guide.title}</span>
      {onTurnOnGpu && (
        <span className="font-semibold text-foreground">
          GPU 가 꺼져 있어요. 켠 뒤 다시 시도하세요.
        </span>
      )}
      <span className="text-foreground">{guide.fix}</span>
      <div className="mt-1 flex flex-wrap gap-2">
        {onTurnOnGpu && (
          // GPU 가 꺼져 있으면 다시 시도해도 같은 곳에서 멈추므로 주 단추는 「GPU 켜기」다(S15P31A101-734). 나머지는 보조로 내린다
          <Button size="sm" onClick={onTurnOnGpu}>
            GPU 켜기
          </Button>
        )}
        {guide.retry && (
          <Button
            size="sm"
            variant={onTurnOnGpu ? 'secondary' : 'default'}
            disabled={retryPending}
            onClick={onRetry}
          >
            다시 시도
          </Button>
        )}
        {newMap && (
          <Button
            size="sm"
            variant={onTurnOnGpu ? 'secondary' : 'default'}
            disabled={retryPending}
            onClick={onRetryNewMap}
          >
            새 맵으로 다시 하기
          </Button>
        )}
        <Button
          size="sm"
          variant={onTurnOnGpu || guide.retry || newMap ? 'secondary' : 'default'}
          onClick={onReturnToStep1}
        >
          카메라 연결 관리로
        </Button>
      </div>
    </div>
  );
}

/** 카메라 높이 불일치 안내(서버 height_checks·height_warnings 문구를 그대로 보인다). */
function HeightNotice({ warnings }: { warnings: readonly HeightWarningItem[] }) {
  return (
    <div
      role="alert"
      aria-label="카메라 높이 불일치 경고"
      className="flex items-start gap-2.5 rounded-lg bg-delay/15 px-3.5 py-3 text-sm text-delay"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <ul className="flex flex-col gap-1">
        {warnings.map((warning) => (
          <li key={warning.cameraId}>{warning.message}</li>
        ))}
      </ul>
    </div>
  );
}

const formatMeters = (meters: number) => `${meters.toFixed(2).replace(/0$/, '')} m`;
const formatDiffCm = (cm: number) => `${Math.abs(cm).toFixed(1)} cm`;

/** 보정 검증 결과: 카메라마다 입력 높이·복원 높이·차이. 맞는지는 서버 판정(within_tolerance)을 그대로 쓴다. */
function ResultCard({
  rows,
  cameraIds,
  toleranceCm,
}: {
  rows: readonly HeightCheckRowView[];
  cameraIds: readonly string[];
  toleranceCm: number | null;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>보정 검증 결과</h2>
        </CardTitle>
        {toleranceCm !== null && (
          <CardAction className="text-xs text-muted-foreground">
            높이 차이 허용 {toleranceCm} cm
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <table className="w-full font-mono text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="pb-1 text-left font-normal">
                카메라
              </th>
              <th scope="col" className="pb-1 pl-4 text-right font-normal">
                입력
              </th>
              <th scope="col" className="pb-1 pl-4 text-right font-normal">
                복원
              </th>
              <th scope="col" className="pb-1 pl-4 text-right font-normal">
                차이
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={row.cameraId}
                data-within-tolerance={row.withinTolerance}
                className={cn(!row.withinTolerance && 'text-delay')}
              >
                <th scope="row" className="py-1.5 text-left font-semibold">
                  {cameraLabel(cameraIds, row.cameraId)}
                </th>
                <td className="py-1.5 pl-4 text-right">{formatMeters(row.inputHeightM)}</td>
                <td className="py-1.5 pl-4 text-right">
                  {row.restoredHeightM === null ? '—' : formatMeters(row.restoredHeightM)}
                </td>
                <td
                  className={cn(
                    'py-1.5 pl-4 text-right',
                    row.withinTolerance ? 'text-muted-foreground' : 'font-semibold',
                  )}
                >
                  {row.differenceCm === null ? '—' : formatDiffCm(row.differenceCm)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const OUTCOME_TEXT: Record<PairOutcome, string> = {
  pass: '통과',
  fail: '실패',
  pending: '확인 중',
  na: '—',
};

const OUTCOME_TONE: Record<PairOutcome, string> = {
  pass: 'text-ok',
  fail: 'font-semibold text-delay',
  pending: 'text-muted-foreground',
  na: 'text-muted-foreground',
};

const formatPx = (median: number | null, p90: number | null) =>
  median === null ? '—' : `${median.toFixed(2)}${p90 === null ? '' : ` / ${p90.toFixed(2)}`}`;
const formatRate = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

/**
 * 쌍별 검증(S15P31A101-646): 옆 카메라 4쌍마다 세팅 보정의 배경 홀드아웃 오차(중앙값/p90 px)와 카메라 확인의 사람 통과율, 종합 판정.
 * 관제의 쌍 연결 검사와 같은 계산이라, 여기서 실패한 쌍은 관제에서 같은 사람을 둘로 가르기 쉽다.
 */
function PairResultCard({ view }: { view: CameraCheckView }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2>쌍별 검증</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <table aria-label="카메라 쌍별 검증" className="w-full font-mono text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="pb-1 text-left font-normal">
                쌍
              </th>
              <th scope="col" className="pb-1 pl-3 text-right font-normal">
                보정 오차 px
              </th>
              <th scope="col" className="pb-1 pl-3 text-right font-normal">
                사람 통과율
              </th>
              <th scope="col" className="pb-1 pl-3 text-right font-normal">
                판정
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {view.pairs.map((row) => (
              <tr key={row.key} data-outcome={row.outcome}>
                <th scope="row" className="py-1.5 text-left font-semibold">
                  {row.label}
                </th>
                <td
                  className={cn(
                    'py-1.5 pl-3 text-right',
                    row.holdoutVerdict === 'FAIL' ? 'text-delay' : 'text-muted-foreground',
                  )}
                >
                  {formatPx(row.holdoutMedianPx, row.holdoutP90Px)}
                </td>
                <td
                  className={cn(
                    'py-1.5 pl-3 text-right',
                    row.checkVerdict === 'FAIL' ? 'text-delay' : 'text-muted-foreground',
                  )}
                >
                  {formatRate(row.passRate)}
                </td>
                <td className={cn('py-1.5 pl-3 text-right', OUTCOME_TONE[row.outcome])}>
                  {OUTCOME_TEXT[row.outcome]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** 오른쪽 「지금 할 일」 카드 아래의 전체 진행 막대 하나(단계별 %는 「자세히」). */
function OverallBar({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label="전체 진행"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"
    >
      <div
        className="h-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

type LeftTab = 'cameras' | 'map';

const TAB =
  'h-7 rounded-md px-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const TAB_ON = 'bg-primary text-primary-foreground';
const TAB_OFF = 'text-muted-foreground enabled:hover:bg-surface-3';

/**
 * 왼쪽 칸: 「카메라 영상」(기본)과 「3D 미리보기」(미리보기 맵이 생긴 뒤) 탭. 미리보기 맵만 있는 동안은 사용자가 고를 때만 3D 가 보이고
 * (S15P31A101-691: 예전에는 85% 에서 저절로 바뀌었다), 정밀 3D 맵까지 끝나면 고른 적이 없을 때 3D 로 바뀐다.
 */
function CalibrateLeft({
  cameraView,
  waiting,
}: {
  cameraView: ReactNode;
  waiting: SetupWaitingView;
}) {
  const [picked, setTab] = useState<LeftTab | null>(null);
  const tab = picked ?? (waiting.mapComplete ? 'map' : 'cameras');
  const showMap = tab === 'map' && waiting.previewReady;
  return (
    <Card size="sm">
      <CardHeader>
        <div role="tablist" aria-label="왼쪽 칸 보기" className="flex items-center gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={!showMap}
            className={cn(TAB, showMap ? TAB_OFF : TAB_ON)}
            onClick={() => setTab('cameras')}
          >
            카메라 영상
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showMap}
            disabled={!waiting.previewReady}
            title={waiting.previewReady ? undefined : '미리보기 맵이 생기면 볼 수 있어요'}
            className={cn(TAB, showMap ? TAB_ON : TAB_OFF)}
            onClick={() => setTab('map')}
          >
            3D 미리보기
          </button>
        </div>
      </CardHeader>
      <CardContent role="tabpanel" className="min-h-0 flex-1">
        {showMap ? <SetupPreviewViewport sceneTier={waiting.sceneTier} /> : cameraView}
      </CardContent>
    </Card>
  );
}

export function SetupCalibrateStep({
  waiting,
  cameraView,
  nextStep = null,
  cameraCheck,
  showCameraCheck = false,
  pollingError = false,
  retryPending = false,
  retryError = null,
  onRetry,
  onRetryNewMap,
  changedCameras,
  repeatedValidationPairs,
  onNavigateLiveWork,
  onReturnToStep1,
  onOpenSupplement,
  onTurnOnGpu,
  demo = false,
}: {
  waiting: SetupWaitingView;
  /** 왼쪽 「카메라 영상」 탭(카메라 영상 4칸). */
  cameraView: ReactNode;
  /** 오른쪽 「지금 할 일」(실패면 null: 실패 안내가 대신한다). */
  nextStep?: NextStep | null;
  /** 보정 품질 게이트·카메라 확인(S15P31A101-646). 없으면 쌍별 표를 그리지 않는다. 카메라 확인 자체는 걷기 창이 한다(-687). */
  cameraCheck?: CameraCheckView;
  /** 보정이 등록돼 쌍별 표를 보일 때(실패 세션 제외). */
  showCameraCheck?: boolean;
  pollingError?: boolean;
  retryPending?: boolean;
  retryError?: string | null;
  onRetry: () => void;
  /** 이전 맵 재사용이 카메라 변화로 멈춘 시도를 새 맵으로 다시 한다(S15P31A101-689). */
  onRetryNewMap?: () => void;
  /** 직전 세팅과 달라진 카메라(세션 world_anchor.changed_cameras). */
  changedCameras?: readonly string[];
  repeatedValidationPairs?: string;
  onNavigateLiveWork?: () => void;
  onReturnToStep1: () => void;
  /** 맵 보강 촬영 창을 연다(미리보기 맵이 있을 때만 준다). 없으면 「자세히 · 맵 보강」을 두지 않는다. */
  onOpenSupplement?: () => void;
  /** GPU 가 꺼져 있을 때만 준다. 실패 안내의 주 단추 「GPU 켜기」가 GPU 패널을 연다(S15P31A101-734). */
  onTurnOnGpu?: () => void;
  /** 시연 계정(features/demo): 「지금 할 일」 없이 「자세히 · 진행 단계」를 펼쳐 보인다. */
  demo?: boolean;
}) {
  const column = (
    <>
      {nextStep && !demo && (
        <NextStepCard step={nextStep}>
          <OverallBar percent={waiting.progressPct} />
          {waiting.mapComplete && cameraCheck && !cameraCheck.passed && (
            <Button size="sm" variant="secondary" onClick={onReturnToStep1}>
              카메라 연결 관리로
            </Button>
          )}
        </NextStepCard>
      )}
      {cameraCheck?.skippedForReplay && (
        // 녹화 재생 시험이라 걷기 확인을 건너뛰었다(S15P31A101-736). 조작 없음, 스위치는 EC2 .env 로만 켜고 끈다
        <div
          role="status"
          data-testid="setup-replay-skip"
          className="rounded-md bg-destructive/15 px-3 py-2 text-destructive"
        >
          <p className="text-base font-bold">{REPLAY_SKIP_LABEL}</p>
          <p className="text-xs">{REPLAY_SKIP_DETAIL}</p>
        </div>
      )}
      {waiting.failed && (
        <FailureNotice
          waiting={waiting}
          retryPending={retryPending}
          onRetry={onRetry}
          onRetryNewMap={onRetryNewMap}
          changedCameras={changedCameras}
          repeatedValidationPairs={repeatedValidationPairs}
          onReturnToStep1={onReturnToStep1}
          onTurnOnGpu={onTurnOnGpu}
        />
      )}
      {retryError && (
        <div
          role="alert"
          data-testid="setup-retry-error"
          className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-delay"
        >
          <span>{retryError}</span>
          {onNavigateLiveWork && (
            <Button size="sm" variant="secondary" onClick={onNavigateLiveWork}>
              진행 중인 작업으로 이동
            </Button>
          )}
        </div>
      )}
      <Details label="진행 단계 자세히" summary="자세히 · 진행 단계" defaultOpen={demo}>
        <ProgressCard waiting={waiting} pollingError={pollingError} />
      </Details>
      {(waiting.showHeightNotice || waiting.heightChecks.length > 0) && (
        // 높이는 3D 공간을 만든 직후 높이 확인 창에서 이미 확인했다(-690). 거치대 문구·복원 높이 표는 접어 둔다
        <Details label="카메라 높이 자세히" summary="자세히 · 카메라 높이">
          {waiting.showHeightNotice && <HeightNotice warnings={waiting.heightWarnings} />}
          {waiting.heightChecks.length > 0 && (
            <ResultCard
              rows={waiting.heightChecks}
              cameraIds={waiting.cameraIds}
              toleranceCm={waiting.heightToleranceCm}
            />
          )}
        </Details>
      )}
      {cameraCheck && (showCameraCheck || cameraCheck.qualityVerdict !== null) && (
        <Details label="카메라 쌍 검증 자세히" summary="자세히 · 카메라 쌍 검증">
          <PairResultCard view={cameraCheck} />
        </Details>
      )}
      {onOpenSupplement && (
        <Details label="맵 보강 자세히" summary="자세히 · 맵 보강">
          <p className="text-xs text-muted-foreground">
            카메라가 못 보는 곳을 휴대폰·사진으로 찍어 올리면 맵을 다시 구워 빈 곳을 채웁니다(선택).
          </p>
          <div>
            <Button size="sm" variant="secondary" onClick={onOpenSupplement}>
              맵 보강 촬영
            </Button>
          </div>
        </Details>
      )}
    </>
  );

  return (
    <SetupSplit left={<CalibrateLeft cameraView={cameraView} waiting={waiting} />}>
      {column}
    </SetupSplit>
  );
}
