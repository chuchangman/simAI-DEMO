import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { useCamSplitStore, type CamSplit } from '@/features/cctv/camSplit.store';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { LiveBadge } from '@/features/cctv/CctvDemo';
import { CameraTile, StateTile } from '@/features/cctv/CctvPage';
import { useCameraStates } from '@/features/cctv/useCameraStates';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { AckButton } from '@/features/events/AckButton';
import { entryStatus, isActive } from '@/features/events/entries';
import { useEventsStore } from '@/features/events/events.store';
import { statusText } from '@/features/events/format';
import {
  bestCamera,
  groupIncidents,
  topEntry,
  withoutStale,
  type Incident,
} from '@/features/events/incidents';
import { cardTitle, targetFont, targetLabel } from '@/features/events/incidentView';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import { useLiveEvents } from '@/features/events/useLiveEvents';
import { useZoneName } from '@/features/zones/useZoneName';
import { useCameraNames } from '@/hooks/useCameraNames';
import { env } from '@/lib/env';
import { useRealtimeStore } from '@/store/realtime.store';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { Video, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';

// 실시간 관제 오른쪽 카메라 미리보기. 이벤트 카드·경보 배너의 「CCTV로 확인」이 연다.
// 카메라 탭, CCTV 관제 화면과 같은 영상 칸, 이 사람의 사건 요약과 경보 확인·사건 상세를 한 칸에 둔다.
// 영상은 관리자만 본다(명세 3.3). 다른 역할은 카메라 상태만 본다. 영상은 알림·판정에 쓰지 않는다.

type Attach = ReturnType<typeof useCctvPreview>['attach'];

function IncidentSummary({
  incident,
  onClose,
}: {
  incident: Incident | undefined;
  onClose: () => void;
}) {
  const openEvent = useEventsStore((s) => s.openEvent);
  const zoneName = useZoneName();
  if (!incident) {
    return <p className="text-sm text-muted-foreground">활성 사건이 없습니다</p>;
  }
  const top = topEntry(incident);
  const status = entryStatus(top);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {incident.target && (
          <b className={targetFont(incident.target)}>{targetLabel(incident.target, zoneName)}</b>
        )}
        <SeverityBadge severity={top.event.severity} />
        <span className="ml-auto text-xs text-muted-foreground">{statusText(status)}</span>
      </div>
      <p className="text-sm">{cardTitle(incident, zoneName)}</p>
      <div className="flex items-center justify-end gap-2">
        <AckButton entry={top} label="경보 확인(ACK)" zoneName={zoneName} />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            openEvent(top.event.event_id);
            onClose();
          }}
        >
          사건 상세
        </Button>
      </div>
    </div>
  );
}

/**
 * 탭에 올리는 카메라: 중계가 이어졌으면 중계가 알린 카메라, 아니면 Tier 0 health 의 카메라. 현장 목록 순서로 둔다.
 * 이름은 이 둘이 같다(예: cam_A). 이벤트의 카메라(world 트랙)도 같은 이름이라 추천 탭이 맞는 탭을 가리킨다.
 */
function useCameraIds(relayed: boolean, healthIds: readonly string[]): readonly string[] {
  const link = useCctvStore((s) => s.link);
  const relayCameras = useCctvStore((s) => s.cameras);
  const ids = relayed && link === 'open' && relayCameras.length > 0 ? relayCameras : healthIds;
  return ids;
}

/** attach 가 없으면(관리자가 아님) 영상 없이 카메라 상태만 보인다. */
function Panel({ split, attach }: { split: CamSplit; attach?: Attach }) {
  const setCam = useCamSplitStore((s) => s.setCam);
  const close = useCamSplitStore((s) => s.close);
  const { entries } = useLiveEvents();
  const { cameras, fresh, stateOf } = useCameraStates();
  const best = useRealtimeStore((s) => bestCamera(s.world?.payload.tracks, split.target));
  const healthIds = useMemo(() => cameras.map((camera) => camera.id), [cameras]);
  const ids = useCameraIds(attach !== undefined, healthIds);
  const label = useCameraNames(ids);

  // 지금 보는 사람의 사건만 보인다. 지난 관제(지금 Tier 0 가 들고 있지 않음)의 같은 World ID 는 섞지 않는다(S15P31A101-595).
  const incidents = useMemo(() => groupIncidents(withoutStale(entries)), [entries]);
  const { target } = split;
  const incident = target
    ? incidents.find((i) => i.target?.type === target.type && i.target.id === target.id)
    : undefined;

  // 요청한 카메라가 목록에 없으면 첫 카메라를 보인다.
  const camId = ids.includes(split.cam) ? split.cam : ids[0];
  const state = camId === undefined ? undefined : stateOf(camId);
  const down = state === 'down';

  // Esc 로 닫는다(입력 칸에 있을 때는 제외).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <section
      aria-label="CCTV 확인"
      className="absolute top-[72px] right-3.5 bottom-3.5 z-[6] flex w-(--cam-split-width) flex-col gap-2.5 overflow-y-auto rounded-[16px] bg-card/94 p-3 shadow-float ring-1 ring-border backdrop-blur-[8px] ring-inset motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-right-8"
    >
      <div className="flex items-center gap-2">
        <Video aria-hidden className="size-[18px]" />
        {camId && (
          <b className="font-mono" title={camId}>
            {label(camId)}
          </b>
        )}
        {/* World 가 멈췄을 때(정지)는 배지를 두지 않는다(S15P31A101-665). 끊김은 그대로 보인다. */}
        {(down || fresh) && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs">
            {down ? '끊김' : <LiveBadge />}
          </span>
        )}
        <button
          type="button"
          aria-label="CCTV 닫기 (Esc)"
          title="닫기 (Esc)"
          onClick={close}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div
        role="tablist"
        aria-label="카메라"
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-surface-2 p-1"
      >
        {ids.map((id) => {
          const dn = stateOf(id) === 'down';
          const selected = id === camId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setCam(id)}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm',
                selected
                  ? 'bg-card font-semibold ring-1 ring-primary ring-inset'
                  : 'hover:bg-surface-3',
                dn && 'text-delay',
              )}
            >
              <span className="font-mono" title={id}>
                {label(id)}
              </span>
              {dn ? (
                <em className="text-xs not-italic">끊김</em>
              ) : id === best ? (
                <em className="rounded bg-primary/15 px-1 text-xs font-semibold text-primary not-italic">
                  추천
                </em>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg">
        {camId === undefined || state === undefined ? (
          <p
            role="status"
            className="flex size-full items-center justify-center bg-surface-2 text-sm text-muted-foreground"
          >
            카메라 상태를 받지 못했습니다
          </p>
        ) : attach ? (
          <CameraTile key={camId} cameraId={camId} attach={attach} state={state} />
        ) : (
          <StateTile cameraId={camId} state={state} />
        )}
      </div>
      {down && best && best !== camId && ids.includes(best) && (
        <Button size="sm" onClick={() => setCam(best)}>
          {label(best)}로 보기
        </Button>
      )}
      <div className="rounded-[10px] bg-surface-2 p-3">
        <IncidentSummary
          incident={
            incident && incident.entries.some((e) => isActive(e.event)) ? incident : undefined
          }
          onClose={close}
        />
      </div>
    </section>
  );
}

/** 관리자: 영상 중계에 한 번만 붙고, 카메라 탭을 바꿔도 같은 연결을 쓴다. 패널을 닫으면 끊는다. */
function AdminPanel({ split }: { split: CamSplit }) {
  const { attach } = useCctvPreview(env.VITE_CCTV_PREVIEW_URL, env.VITE_STOMP_URL);
  return <Panel split={split} attach={attach} />;
}

/** 열려 있을 때만 그린다. 실시간 관제(이벤트 패널이 있는 화면)에서만 둔다. */
export function CamSplitPanel() {
  const split = useCamSplitStore((s) => s.split);
  const isAdmin = useCurrentRole() === 'ADMIN';
  if (!split) return null;
  return isAdmin ? <AdminPanel split={split} /> : <Panel split={split} />;
}
