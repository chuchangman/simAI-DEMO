import { ec2Now } from '@/features/events/format';
import { useSharedNow } from '@/features/events/useSharedNow';
import { formatClock } from '@/features/history/works';
import {
  IDLE_LABEL,
  monitoringText,
  type MonitoringPhase,
} from '@/features/monitor/monitoringPhase';
import { MonitoringBadge, MonitoringProblemNote } from '@/features/monitor/MonitoringStatus';
import { TestInputBadge } from '@/features/monitor/TestInputBadge';
import { useMonitoringPhase } from '@/features/monitor/useMonitoringPhase';
import { useMonitorWorks } from '@/features/monitor/useMonitorWorks';
import { useTodayWorks } from '@/features/monitor/useTodayWorks';
import { workElapsedLabel, workStartedAt, workZoneLabel } from '@/features/monitor/workSession';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { workNameOf } from '@/features/work/workDay';
import { selectTrackedCount, useRealtimeStore } from '@/store/realtime.store';
import { Button } from '@simai/ui/components/button';
import { useNavigate } from '@tanstack/react-router';

/** 작업 경과. 매 초 바뀌므로 이 칸만 다시 그린다(EC2 시계 기준, Since 와 같다). */
function Elapsed({ startedAt }: { startedAt: number }) {
  const now = useSharedNow();
  const offset = useRealtimeStore((s) => s.health?.clockOffsetMs);
  return <span className="tabular-nums">{workElapsedLabel(ec2Now(now, offset) - startedAt)}</span>;
}

const PANEL =
  'pointer-events-auto flex max-w-[680px] flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-card/94 px-4 py-2 shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset';

/**
 * 진행 중 작업의 세션 바. 맨 앞 배지가 관제 단계다: 이번 작업 묶음이 현장에 적용되기 전에는 「관제 준비 중」, 적용되면 「관제 중」,
 * 늦음·거부·현장 끊김은 그 이름과 무엇이 / 어떻게 두 줄(거부는 「현장에 다시 보내기」). 작업 시작 성공만으로 「관제 중」이라 하지 않는다.
 * 녹화 파일 재생(시험 입력) 중이면 배지 옆에 「녹화 재생 중 · 실제 알림 꺼짐」을 붙인다(S15P31A101-731).
 */
function ActiveSession({ work, phase }: { work: TbmWorkUnit; phase: MonitoringPhase }) {
  const navigate = useNavigate();
  const startedAt = workStartedAt(work);
  const text = monitoringText(phase);
  return (
    <section aria-label="작업 세션" className={PANEL}>
      <MonitoringBadge text={text} />
      <TestInputBadge />
      <b className="min-w-0 truncate">{workNameOf(work.name)}</b>
      {startedAt !== null && (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          시작 {formatClock(startedAt)} · 경과 <Elapsed startedAt={startedAt} />
        </span>
      )}
      <span className="min-w-0 truncate text-sm text-muted-foreground">
        작업 구역 {workZoneLabel(work)}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => void navigate({ to: '/work', search: { workUnitId: work.work_id } })}
      >
        작업 관리로
      </Button>
      <MonitoringProblemNote text={text} />
    </section>
  );
}

/** 작업을 끝냈는데 현장이 아직 그 작업 묶음을 쓰는 동안(종료 묶음 적용 전). 대기 화면 위에도 보인다. */
function EndingNotice({ phase }: { phase: MonitoringPhase }) {
  const text = monitoringText(phase);
  return (
    <section aria-label="작업 종료" className={PANEL}>
      <MonitoringBadge text={text} />
      <MonitoringProblemNote text={text} />
    </section>
  );
}

/** 작업을 시작하지 않으면 경보가 없다는 안내(사람이 보일 때만 할 일과 단추를 붙인다). */
export const START_HINT_TEXT = '작업을 시작해야 경보가 켜집니다';

/** 작업 시작 = 관제 시작(S15P31A101-679): 세팅을 마쳤지만 작업을 시작하지 않은 동안 Tier 0 는 경보를 내지 않는다. 짧게 알린다. */
export const IDLE_NOTICE = IDLE_LABEL;

function IdleNotice() {
  const navigate = useNavigate();
  const tracked = useRealtimeStore(selectTrackedCount);
  return (
    <section
      aria-label="관제 상태"
      className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full bg-card/94 px-3 py-1 text-sm text-muted-foreground shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground" />
      {IDLE_NOTICE}
      {tracked > 0 && (
        <>
          <span className="text-sev-caution">· {START_HINT_TEXT}</span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => void navigate({ to: '/work' })}
          >
            작업 관리로
          </Button>
        </>
      )}
    </section>
  );
}

/**
 * 실시간 관제 상단의 관제 상태(경보 배너 아래 한 자리).
 * - 진행 중 작업: 세션 바(관제 단계 배지·이름·시작 시각·경과·작업 구역·「작업 관리로」)
 * - 작업을 끝냈는데 현장이 아직 그 묶음을 쓰면: 「종료 요청됨 · 현장 경보 끄는 중」(늦음·거부·끊김은 안내)
 * - 진행 중 작업이 없고 관제 화면이 열려 있으면(세팅을 마친 오늘 작업, 대기 화면 아님): 「작업 시작 전 · 경보 꺼짐」(-679).
 *   사람이 보이면 작업 시작 안내와 「작업 관리로」를 붙인다
 * 작업 목록을 아직 모르면 그리지 않는다(없음은 대기 화면이 보인다, MonitorStandby).
 */
export function WorkSessionBar() {
  const works = useMonitorWorks({ passive: true });
  const today = useTodayWorks({ passive: true });
  const phase = useMonitoringPhase();
  if (works.state !== 'ready') return null;
  if (works.active) return <ActiveSession work={works.active} phase={phase} />;
  if (phase.stage === 'ending') return <EndingNotice phase={phase} />;
  return phase.stage === 'idle' && today.state === 'ready' && today.standby === null ? (
    <IdleNotice />
  ) : null;
}
