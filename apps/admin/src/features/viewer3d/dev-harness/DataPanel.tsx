import {
  selectActiveEvents,
  selectEvents,
  selectStatus,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { trackPlacement, type TrackView } from '@/features/viewer3d/data/spatialFrame';
import { zoneContractText } from '@/features/viewer3d/dev-harness/geometryText';
import type { HarnessSource } from '@/features/viewer3d/dev-harness/harnessSource';
import {
  DATA_SOURCES,
  readReplayFiles,
  ZONE_APPLY_OPTIONS,
  type DataSourceKey,
} from '@/features/viewer3d/dev-harness/harnessSource';
import type { MockFailure, SpatialMockApi } from '@/features/viewer3d/dev-harness/mswHandlers';
import { SCENARIOS } from '@/features/viewer3d/dev-harness/scenarios';
import { zoneContainment } from '@/features/viewer3d/dev-harness/zoneContainment';
import { selectAvatarMeshStatus } from '@/features/viewer3d/people/avatarMesh';
import type { ReplayFile } from '@/features/viewer3d/replay/replayLog';
import { REPLAY_SPEEDS, type ReplaySpatialSource } from '@/features/viewer3d/replay/replaySource';
import {
  MODE_EVENT_SOURCE,
  riskPresentation,
  type RiskHighlight,
} from '@/features/viewer3d/risk/riskPresentation';
import type { ViewerMode } from '@/features/viewer3d/types';
import type { ZoneApplyState } from '@/features/viewer3d/zones/zonePresentation';
import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';

// Provider 데이터를 숫자·ID 로만 보여 주는 개발 진단. 3D 사람·구역·강조는 -44·-47·-185 가 만든다.

/** 개발 화면에서만 쓰는 오래됨 표시 기준. 운영 임계값이 아니다(명세 수치 없음). */
const DEV_STALE_MS = 1000;
const FAILURES: { key: MockFailure; label: string }[] = [
  { key: 'none', label: 'REST 정상' },
  { key: 'error', label: 'REST 503' },
  { key: 'slow', label: 'REST 1.5초 지연' },
  { key: 'nonjson', label: 'REST 비JSON(HTML)' },
];

// UUID 의 앞 두 묶음 뒤(시간·순번이 바뀌는 자리)를 보여 이벤트끼리 구분한다.
const short = (id: string) => id.slice(9, 18);
const fmt = (v: number) => v.toFixed(2);
const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)}ms`);
/** 시각(UTC ms)을 이 브라우저 시간대의 시:분:초.밀리초로. */
const clock = (v: number | null) =>
  v === null
    ? '—'
    : new Date(v).toTimeString().slice(0, 8) + '.' + String(v % 1000).padStart(3, '0');

const riskText = (map: ReadonlyMap<string, RiskHighlight>) =>
  [...map]
    .map(([id, r]) => `${id}:${r.level}×${r.eventIds.length}[${r.eventIds.map(short).join(',')}]`)
    .join(' ') || '—';

function where(track: TrackView) {
  const p = trackPlacement(track);
  if (p.basis === 'XY_ONLY') return `XY만 (${fmt(p.xy[0])}, ${fmt(p.xy[1])}) Z 미상`;
  const label = {
    GROUND_ANCHOR: '접지',
    PELVIS: '골반·접지 미확인',
    GROUND_ANCHOR_UNCERTAIN: '접지 불확실',
  }[p.basis];
  return `${label} (${p.world.map(fmt).join(', ')})`;
}

// 문제 줄은 앞의 몇 개만 보인다. 나머지는 개수로만 알린다.
const ISSUE_LIMIT = 20;

interface ReplayControlsProps {
  replay: ReplaySpatialSource;
  onFiles: (files: ReplayFile[]) => void;
  onExample: () => void;
}

/** 녹화 재생 조작(개발 화면 전용, -187). 시간 선택 UI 의 정본은 FE -164 다. */
function ReplayControls({ replay, onFiles, onExample }: ReplayControlsProps) {
  const status = useSyncExternalStore(replay.subscribeStatus, replay.getStatus);
  const { log } = replay;
  const [reading, setReading] = useState<string | null>(null);
  const empty = status.playhead === null;

  return (
    <div className="smk-data-replay" data-testid="replay-controls">
      <div className="smk-data-row">
        <input
          type="file"
          multiple
          accept=".jsonl,.json,.txt,application/json"
          aria-label="재생 기록 파일"
          onChange={(e) => {
            const list = e.target.files;
            if (!list || list.length === 0) return;
            setReading(null);
            readReplayFiles(list).then(onFiles, (error: unknown) =>
              setReading(error instanceof Error ? error.message : String(error)),
            );
          }}
        />
        <button type="button" className="smk-chip" onClick={onExample}>
          예시 기록
        </button>
      </div>
      <div className="smk-data-row">
        <button
          type="button"
          className="smk-chip"
          disabled={empty}
          onClick={() => (status.playing ? replay.pause() : replay.play())}
        >
          {status.playing ? '일시정지' : status.ended ? '처음부터 재생' : '재생'}
        </button>
        <button
          type="button"
          className="smk-chip"
          disabled={empty}
          onClick={() => replay.stepFrame(-1)}
        >
          이전 프레임
        </button>
        <button
          type="button"
          className="smk-chip"
          disabled={empty}
          onClick={() => replay.stepFrame(1)}
        >
          다음 프레임
        </button>
        <select
          aria-label="재생 배속"
          value={status.speed}
          onChange={(e) => replay.setSpeed(Number(e.target.value))}
        >
          {REPLAY_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              ×{speed}
            </option>
          ))}
        </select>
      </div>
      {!empty && (
        <input
          type="range"
          className="w-full"
          aria-label="재생 시각"
          min={status.start!}
          max={status.end!}
          step={1}
          value={status.playhead!}
          onChange={(e) => replay.seek(Number(e.target.value))}
        />
      )}
      <p className="smk-data-dim smk-mono" data-testid="replay-status">
        REPLAY {clock(status.playhead)} / {clock(status.end)}
        {status.playing ? ' · 재생 중' : status.ended ? ' · 끝' : ' · 멈춤'} · 보이는 World{' '}
        {clock(status.worldT)} · 기록 연령 {ms(status.recordAgeMs)}
        {status.gap ? ' · 기록 없음(보간 안 함)' : ''}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="replay-log">
        {log.files.join(', ') || '파일 없음'} · 줄 {log.lines} · World {log.worlds.length} · 이벤트{' '}
        {log.events.length} · 제외 {log.issues.length}
        {reading ? ` · 읽기 실패 ${reading}` : ''}
      </p>
      {log.issues.length > 0 && (
        <ul className="smk-data-list smk-mono" aria-label="제외한 줄" data-testid="replay-issues">
          {log.issues.slice(0, ISSUE_LIMIT).map((issue, i) => (
            <li key={i}>
              {issue.file}:{issue.line ?? '—'} {issue.reason} {issue.detail}
            </li>
          ))}
          {log.issues.length > ISSUE_LIMIT && (
            <li className="smk-data-dim">외 {log.issues.length - ISSUE_LIMIT}줄</li>
          )}
        </ul>
      )}
    </div>
  );
}

interface DataPanelProps {
  store: SpatialDataStore;
  sourceKey: DataSourceKey;
  harness: HarnessSource;
  mockApi: SpatialMockApi | null;
  onSourceChange: (key: DataSourceKey) => void;
  zoneApply: ZoneApplyState;
  onZoneApplyChange: (state: ZoneApplyState) => void;
  /** 뷰어 모드. 위험 강조는 모드의 출처 이벤트만 보인다. */
  mode: ViewerMode;
  onRestart: () => void;
  /** 고른 재생 기록 파일. */
  onReplayFiles: (files: ReplayFile[]) => void;
  /** 예시 기록으로 되돌린다. */
  onReplayExample: () => void;
}

export function DataPanel({
  store,
  sourceKey,
  harness,
  mockApi,
  onSourceChange,
  zoneApply,
  onZoneApplyChange,
  mode,
  onRestart,
  onReplayFiles,
  onReplayExample,
}: DataPanelProps) {
  const state = useStore(store);
  // 데이터가 끊겨도 경과 시간은 늘어나야 하므로 따로 시계를 돌린다.
  const [now, setNow] = useState(() => Date.now());
  // 재생 조작 뒤 버튼 표시를 바로 바꾸려고 다시 그린다. 일시정지 여부는 Source 에서 읽는다.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [failure, setFailure] = useState<MockFailure>(mockApi?.failure ?? 'none');
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // 진단 시계는 250ms 마다 돈다. 그사이 받은 메시지보다 시계가 뒤처지면 경과가 음수가 되므로 수신 시각에 맞춘다.
  const status = selectStatus(state, Math.max(now, state.world?.meta.receivedAt ?? 0));
  // 지금 모드의 출처 이벤트만 목록에 보인다(REPLAY 모드면 재생 이벤트). 다른 출처는 개수만.
  const source = MODE_EVENT_SOURCE[mode];
  const shown = selectEvents(state, source);
  const others = state.events.size - shown.length;
  const stale = status.receiveAgeMs !== null && status.receiveAgeMs > DEV_STALE_MS;
  const { mock, replay } = harness;
  const halted = mock?.halted ?? false;
  // 3D 강조와 같은 계산을 숫자로 보인다(개발 진단 전용).
  const risk = riskPresentation({
    events: state.events.values(),
    tracks: state.world?.tracks ?? [],
    worldSceneVersion: state.world?.sceneVersion ?? null,
    zoneIds: state.zones.zones.map((z) => z.zoneId),
    mode,
    connectionOpen: state.connection?.state === 'OPEN',
  });
  const active = selectActiveEvents(state, MODE_EVENT_SOURCE[mode]);
  // 이벤트 대상이 지금 구역 상자 안에 있는지(검증용, 3D 강조와 무관).
  const containment = zoneContainment(active, state.world?.tracks ?? [], state.zones.zones);
  const latest = [...state.events.values()]
    .filter((e) => e.source === MODE_EVENT_SOURCE[mode])
    .sort((a, b) => b.meta.receivedAt - a.meta.receivedAt)[0];
  const scenario = SCENARIOS.find(
    (s) => s.key === (sourceKey === 'external' ? 'normal' : sourceKey),
  );

  return (
    <div className="smk-data" data-testid="spatial-data">
      <div className="smk-data-row">
        <select
          aria-label="데이터 입력"
          value={sourceKey}
          onChange={(e) => onSourceChange(e.target.value as DataSourceKey)}
        >
          {DATA_SOURCES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {mockApi && (
          <select
            aria-label="REST 상태"
            value={failure}
            onChange={(e) => {
              const next = e.target.value as MockFailure;
              mockApi.setFailure(next);
              setFailure(next);
            }}
          >
            {FAILURES.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="smk-data-row">
        <select
          aria-label="구역 적용 상태 표시"
          value={zoneApply}
          onChange={(e) => onZoneApplyChange(e.target.value as ZoneApplyState)}
        >
          {ZONE_APPLY_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {mock && (
        <div className="smk-data-row">
          <button
            type="button"
            className="smk-chip"
            onClick={() => {
              if (mock.halted) mock.resume();
              else mock.pause();
              redraw();
            }}
          >
            {halted ? '재개' : '일시정지'}
          </button>
          <button
            type="button"
            className="smk-chip"
            disabled={!halted}
            onClick={() => {
              mock.step();
              redraw();
            }}
          >
            1틱
          </button>
          <button type="button" className="smk-chip" onClick={onRestart}>
            처음부터
          </button>
          <span className="smk-data-dim" data-testid="data-tick">
            tick {mock.tick}
          </span>
        </div>
      )}
      {replay && (
        <ReplayControls replay={replay} onFiles={onReplayFiles} onExample={onReplayExample} />
      )}
      <dl className="smk-data-grid smk-mono">
        <dt>연결</dt>
        <dd data-testid="data-connection">
          {state.connection ? state.connection.state : '—'}
          {state.connection?.reason ? ` · ${state.connection.reason}` : ''} · 재연결{' '}
          {state.reconnects}
        </dd>
        <dt>World</dt>
        <dd data-stale={stale ? '' : undefined}>
          {state.world
            ? `${state.world.sceneVersion} · 수신 경과 ${ms(status.receiveAgeMs)}`
            : '없음'}
          {stale ? ' · DEV 기준 1초 초과' : ''}
        </dd>
        <dt>Health</dt>
        <dd>
          {state.health
            ? `${state.health.systemHealth} · ${state.health.remoteState} · data_age ${ms(status.healthDataAgeMs)}`
            : '없음'}
        </dd>
        <dt>Scene</dt>
        <dd>
          보고{' '}
          {status.sceneMismatchReported === null
            ? '—'
            : status.sceneMismatchReported
              ? '불일치'
              : '일치'}{' '}
          · World 비교{' '}
          {status.sceneMismatchObserved === null
            ? '—'
            : status.sceneMismatchObserved
              ? '불일치'
              : '일치'}
        </dd>
        <dt>누계</dt>
        <dd data-testid="data-counts">
          W{state.counts.world} E{state.counts.event} H{state.counts.health} A{state.counts.avatar}{' '}
          중복
          {state.counts.duplicate} 역전
          {state.counts.outOfOrder} 거부{state.counts.rejected}
        </dd>
        {state.lastRejected && (
          <>
            <dt>거부</dt>
            <dd data-testid="data-rejected">
              {state.lastRejected.reason} {state.lastRejected.msgType ?? ''}{' '}
              {state.lastRejected.detail}
            </dd>
          </>
        )}
      </dl>
      <ul className="smk-data-list smk-mono" aria-label="Track">
        {(state.world?.tracks ?? []).map((track) => {
          // 아바타 포즈를 받은 사람만 메시 판정을 적는다(-65).
          const mesh = state.avatars.has(track.worldId)
            ? selectAvatarMeshStatus(state, track.worldId, now)
            : null;
          return (
            <li
              key={track.worldId}
              data-world-id={track.worldId}
              data-avatar-mesh={mesh ? (mesh.use ? 'ON' : mesh.fallback) : undefined}
            >
              <b>{track.worldId}</b> {track.observationState} {track.lifecycle} Z {track.zValidity}
              {track.aliases.length > 0 ? ` 별칭 ${track.aliases.join(',')}` : ''}
              {mesh ? ` · 메시 ${mesh.use ? 'ON' : mesh.fallback} HMR ${ms(mesh.hmrLagMs)}` : ''}
              {mesh?.detail ? ` (${mesh.detail})` : ''}
              <br />
              <span className="smk-data-dim">{where(track)}</span>
            </li>
          );
        })}
      </ul>
      <ul className="smk-data-list smk-mono" aria-label={`${source} 이벤트`}>
        {shown.map((event) => (
          <li key={event.eventId} data-event-id={event.eventId}>
            {short(event.eventId)} #{event.eventSequence ?? '—'} {event.lifecycle} {event.severity}{' '}
            {event.zoneId ?? '—'} [{event.worldIds.join(',')}]
          </li>
        ))}
        {shown.length === 0 && <li className="smk-data-dim">{source} 이벤트 없음</li>}
        {others > 0 && <li className="smk-data-dim">다른 출처 {others}건은 따로 보관</li>}
      </ul>
      <p className="smk-data-dim smk-mono" data-testid="data-zones">
        구역 {state.zones.status} · {state.zones.zones.map((z) => z.zoneId).join(', ') || '—'}
        {state.zones.invalid.map((z) => ` · 거부 ${z.zoneId ?? 'ID 없음'}(${z.reason})`).join('')}
        {state.zones.reason ? ` · ${state.zones.reason}` : ''} ·{' '}
        {zoneContractText(state.zones.contract)}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="data-risk">
        위험 강조({risk.source}) 사람 {riskText(risk.people)} · 구역 {riskText(risk.zones)}
        {risk.unlinked.map((u) => ` · 미연결 ${u.target}(${u.reason})`).join('')}
        {risk.skipped.map((s) => ` · 제외 ${short(s.eventId)}(${s.reason})`).join('')}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="data-containment">
        구역 포함(검증용·판정 아님){' '}
        {containment
          .map(
            (c) =>
              `${short(c.eventId)}:${c.zoneId} 안[${c.inside.join(',')}] 밖[${c.outside.join(',')}]` +
              (c.unknown.length ? ` 미상[${c.unknown.join(',')}]` : ''),
          )
          .join(' · ') || '—'}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="data-timing">
        {latest
          ? `최근 이벤트 ${short(latest.eventId)} #${latest.eventSequence ?? '—'} ${latest.lifecycle} ${latest.severity} · 갱신 ${clock(latest.updatedAt)} · 송신 ${clock(latest.meta.sentAt)} · 수신 ${clock(latest.meta.receivedAt)}`
          : '최근 이벤트 없음'}
        {state.world
          ? ` · World msg ${short(state.world.meta.msgId)} t ${clock(state.world.tLatestGlobal)} 수신 ${clock(state.world.meta.receivedAt)} (frame id 계약 없음)`
          : ''}
      </p>
      <p className="smk-data-dim smk-mono" data-testid="data-harness">
        {scenario
          ? `시나리오 ${scenario.label}: ${scenario.hint}`
          : replay
            ? '녹화 재생: 기록 시각의 World·REPLAY 이벤트만 보낸다(보간 없음)'
            : '입력 없음'}
        {mockApi ? ` · MSW 재활성 ${mockApi.reactivations}회` : ' · MSW 없음'}
        {mock?.capped ? ' · 시연 재생 상한 도달(처음부터로 다시 시작)' : ''}
      </p>
    </div>
  );
}
