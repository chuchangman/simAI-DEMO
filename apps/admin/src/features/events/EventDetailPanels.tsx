import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { hasClips } from '@/features/clips/clips';
import { EventClips } from '@/features/clips/EventClips';
import { EventPhotos } from '@/features/eventPhotos/EventPhotos';
import { hasPhotos } from '@/features/eventPhotos/useEventPhotos';
import { AckButton } from '@/features/events/AckButton';
import { ALARM_TEXT } from '@/features/events/alarmTone';
import { entryStatus, needsConfirmation, type EventEntry } from '@/features/events/entries';
import { escalationStatusLabel, mergedEscalations } from '@/features/events/escalation';
import { EscalationControl } from '@/features/events/EscalationControl';
import {
  confidenceReasonText,
  eventRuleName,
  formatTime,
  metricLabels,
  statusText,
} from '@/features/events/format';
import type { Incident } from '@/features/events/incidents';
import { IncidentSummaryControl } from '@/features/events/IncidentSummaryControl';
import { incidentTimeline } from '@/features/events/incidentView';
import {
  needsBundlesForRelease,
  PERSON_ONLY_RULES,
  ppeReleaseOf,
} from '@/features/events/ppePolicy';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import { canRequestSummary, latestSummary } from '@/features/events/summary';
import type { EventEscalation } from '@/features/events/types';
import { useEscalationHistory } from '@/features/events/useEscalateEvent';
import { useSummaryState } from '@/features/events/useIncidentSummary';
import { vlmReadiness } from '@/features/gpu/gpuStatus';
import { useCachedGpuStatus } from '@/features/gpu/useGpu';
import type { ConfigBundle } from '@/features/zones/types';
import { useRecentBundles } from '@/features/zones/useRecentBundles';
import { useZoneName } from '@/features/zones/useZoneName';
import type { ZoneNameOf } from '@/features/zones/zoneName';
import { cn } from '@simai/ui/lib/utils';
import type { ReactNode } from 'react';

// 사건 상세 창의 칸들. 받은 이벤트 값만으로 그린다.

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-[12px] bg-card px-4 py-3">
      <h3 className="text-[15px] leading-[22px] font-bold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const None = ({ text = '—' }: { text?: string }) => (
  <p className="text-sm text-muted-foreground">{text}</p>
);

/**
 * VLM 근거를 기다리는 이벤트인지(S15P31A101-706). 근거는 LIVE CRITICAL 에만 요청되고(서버 VlmRationaleIngestor),
 * 아직 없는데 GPU 부팅 단계가 VLLM(VLM 가중치 받는 중)이면 빈 칸 대신 「AI 근거 준비 중」을 보인다.
 */
const awaitsRationale = (event: EventEntry['event'], vlmLoading: boolean) =>
  vlmLoading && !event.rationale && event.source === 'LIVE' && event.severity === 'CRITICAL';

/** 구역이 없는 이벤트의 구역 칸 문구. */
const NO_ZONE_TEXT = '구역 없음';

/**
 * 해소된 R9·R11 의 해소 원인을 가릴 최근 구성 묶음. 해소된 LIVE R9·R11 이 없으면 받지 않는다(캐시에 있으면 그것을 쓴다).
 * 묶음을 모르면 undefined 이고 "해소"로만 보인다.
 */
function useReleaseBundles(entries: readonly EventEntry[]): readonly ConfigBundle[] | undefined {
  return useRecentBundles(needsBundlesForRelease(entries.map((e) => e.event))).data;
}

/** 규칙 하나의 근거 줄: 등급 · 규칙 · 구역 · 발생 · 상태, 지표, 확인 필요 이유. */
function RuleRow({
  entry,
  current,
  zoneName,
  bundles,
}: {
  entry: EventEntry;
  current: boolean;
  zoneName: ZoneNameOf;
  bundles: readonly ConfigBundle[] | undefined;
}) {
  const { event } = entry;
  // 구역이 있는데 이름을 모르면 칸을 뺀다(구역 번호를 보이지 않는다). 사람 단위 규칙(R9·R11)은 구역을 보지 않아 칸이 없다.
  const zone = event.zone_id
    ? zoneName(event.zone_id)
    : PERSON_ONLY_RULES.has(event.rule_id)
      ? null
      : NO_ZONE_TEXT;
  const reasons = event.confidence_reasons ?? [];
  const metrics = metricLabels(event.metrics);
  return (
    <li
      aria-current={current || undefined}
      className={cn(
        'flex flex-col gap-1 py-2.5 shadow-[0_1px_0_var(--border)] last:shadow-none',
        entryStatus(entry).kind === 'resolved' && 'opacity-50',
      )}
    >
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <SeverityBadge severity={event.severity} />
        <b>{eventRuleName(event)}</b>
        <span className="text-[13px] text-muted-foreground">
          {zone && `${zone} · `}
          <span className="font-mono">{formatTime(event.raised_at)}</span> 발생 ·{' '}
          {statusText(entryStatus(entry), ppeReleaseOf(event, bundles))}
        </span>
      </span>
      {/* 규칙 번호·판정 수치는 운영자가 따질 때만 필요해 접어 둔다(S15P31A101-757). */}
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted-foreground">자세히</summary>
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-muted-foreground">규칙 {event.rule_id}</span>
          {metrics.length > 0 && (
            <span className="flex flex-wrap gap-x-2 font-mono">
              {metrics.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </span>
          )}
        </div>
      </details>
      {needsConfirmation(event) && (
        <span className="text-sm">
          확인 필요
          {reasons.length > 0 &&
            ` · ${reasons.map((r) => confidenceReasonText(r, event.rule_id)).join(', ')}`}
        </span>
      )}
    </li>
  );
}

interface EntriesProps {
  entries: EventEntry[];
}

export function RulesPanel({
  entries,
  openEventId,
}: EntriesProps & {
  /** 눌러서 연 규칙. */
  openEventId: string;
}) {
  const zoneName = useZoneName();
  const bundles = useReleaseBundles(entries);
  return (
    <DetailPanel title="규칙과 근거">
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <RuleRow
            key={entry.event.event_id}
            entry={entry}
            current={entry.event.event_id === openEventId}
            zoneName={zoneName}
            bundles={bundles}
          />
        ))}
      </ul>
    </DetailPanel>
  );
}

function EscalationHistoryList({ items }: { items: readonly EventEscalation[] }) {
  if (items.length === 0) return null;
  return (
    <ol aria-label="상향 이력" className="flex flex-col gap-1 pt-1 text-xs">
      {items.map((item, idx) => (
        <li
          key={item.escalation_id ?? `${item.requested_at}-${idx}`}
          className="flex flex-wrap items-center gap-2 text-muted-foreground"
        >
          <span className="font-mono text-faint">{formatTime(item.requested_at)}</span>
          <SeverityBadge severity={item.target_severity} />
          <span className="font-semibold text-foreground">{escalationStatusLabel(item)}</span>
          {item.actor_id && <span className="text-point-soft">{item.actor_id}</span>}
          {item.note && <span>{item.note}</span>}
        </li>
      ))}
    </ol>
  );
}

export function AiPanel({
  entries,
  onSeekTimestamp,
}: EntriesProps & {
  onSeekTimestamp?: (timestampMs: number) => void;
}) {
  const role = useCurrentRole();
  const historyByEvent = useEscalationHistory();
  const summaryByEvent = useSummaryState();
  // 이미 받아 둔 GPU 상태만 본다(상단바 점이 받는다). 관리자가 아니거나 세션이 없으면 지금 그대로
  const vlmLoading = vlmReadiness(useCachedGpuStatus()) === 'LOADING';
  const ai = entries.filter(({ event }) => {
    const history = mergedEscalations(event, historyByEvent[event.event_id]);
    const summary = latestSummary(event, summaryByEvent[event.event_id]);
    return Boolean(
      event.rationale ||
      event.proposed_severity ||
      history.length > 0 ||
      summary !== undefined ||
      canRequestSummary(event, role) ||
      awaitsRationale(event, vlmLoading),
    );
  });
  return (
    <DetailPanel title="AI 설명">
      {ai.length === 0 ? (
        <None />
      ) : (
        ai.map(({ event }) => {
          const history = mergedEscalations(event, historyByEvent[event.event_id]);
          return (
            <div key={event.event_id} className="flex flex-col gap-1.5 text-sm">
              {ai.length > 1 && (
                <span className="text-muted-foreground">{eventRuleName(event)}</span>
              )}
              {event.rationale ? (
                <p>{event.rationale}</p>
              ) : (
                awaitsRationale(event, vlmLoading) && (
                  <p
                    title="AI 모델(VLM) 가중치를 받는 중입니다. 준비 전에 난 경보에는 근거가 붙지 않을 수 있습니다."
                    className="text-muted-foreground"
                  >
                    AI 근거 준비 중
                  </p>
                )
              )}
              {event.proposed_severity && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    상향 의견 <SeverityBadge severity={event.proposed_severity} />
                  </span>
                  <EscalationControl event={event} />
                </div>
              )}
              <EscalationHistoryList items={history} />
              <IncidentSummaryControl event={event} onSeekTimestamp={onSeekTimestamp} />
            </div>
          );
        })
      )}
    </DetailPanel>
  );
}

/**
 * 이벤트 사진(CRITICAL 이벤트 프레임, S15P31A101-753)은 관리자에게만 보인다. 사진이 하나도 없으면(아직 올라오기 전·근거 작업이 없는 이벤트)
 * 칸 전체를 숨긴다: 사진이 있는 EventPhotos 만 data-photos 를 그리고 패널은 그것이 있을 때만 보인다.
 */
export function PhotosPanel({ entries }: EntriesProps) {
  const role = useCurrentRole();
  const photoEntries = role === 'ADMIN' ? entries.filter((e) => hasPhotos(e.event)) : [];
  if (photoEntries.length === 0) return null;
  return (
    <section
      aria-label="이벤트 사진"
      className="hidden flex-col gap-2 rounded-[12px] bg-card px-4 py-3 has-[[data-photos]]:flex"
    >
      <h3 className="text-[15px] leading-[22px] font-bold text-muted-foreground">이벤트 사진</h3>
      {photoEntries.map(({ event }) => (
        <EventPhotos key={event.event_id} event={event} title={eventRuleName(event)} />
      ))}
    </section>
  );
}

/** 이벤트 클립은 관리자에게만 보인다. */
export function ClipsPanel({ entries }: EntriesProps) {
  const role = useCurrentRole();
  const clipEntries = role === 'ADMIN' ? entries.filter((e) => hasClips(e.event)) : [];
  return (
    <DetailPanel title="이벤트 클립">
      {clipEntries.length === 0 ? (
        <None text="영상을 남기는 경보(위험·경고 등급)가 아닙니다" />
      ) : (
        clipEntries.map(({ event }) => (
          <EventClips key={event.event_id} event={event} title={eventRuleName(event)} />
        ))
      )}
    </DetailPanel>
  );
}

export function ProcessPanel({ entries }: EntriesProps) {
  const zoneName = useZoneName();
  const bundles = useReleaseBundles(entries);
  return (
    <DetailPanel title="처리">
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => {
          const status = entryStatus(entry);
          return (
            <li
              key={entry.event.event_id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span>{eventRuleName(entry.event)}</span>
                <span
                  className={
                    status.kind === 'alarm'
                      ? cn('font-bold', ALARM_TEXT[entry.event.severity])
                      : 'text-muted-foreground'
                  }
                >
                  {statusText(status, ppeReleaseOf(entry.event, bundles))}
                </span>
              </span>
              <AckButton entry={entry} label="경보 확인" zoneName={zoneName} />
            </li>
          );
        })}
      </ul>
    </DetailPanel>
  );
}

export function TimelinePanel({ incident }: { incident: Incident }) {
  const bundles = useReleaseBundles(incident.entries);
  const timeline = incidentTimeline(incident, bundles);
  return (
    <DetailPanel title="타임라인">
      {timeline.length === 0 ? (
        <None />
      ) : (
        <ol className="flex flex-col">
          {timeline.map((item, n) => (
            <li
              key={n}
              className="grid grid-cols-[72px_82px_minmax(0,1fr)] gap-2.5 py-1.5 text-[13px] [&+&]:shadow-[0_-1px_0_var(--border)]"
            >
              <span className="font-mono text-faint">{formatTime(item.at)}</span>
              <span className="text-point-soft">{item.who}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      )}
    </DetailPanel>
  );
}
