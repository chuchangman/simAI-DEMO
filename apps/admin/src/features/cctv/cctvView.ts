import type { PauseReason, PreviewLink, ViewMode } from '@/features/cctv/cctv.store';
import {
  startPreviewSession,
  type PreviewDeps,
  type PreviewSession,
  type PreviewSink,
} from '@/features/cctv/previewSession';

// CCTV 화면 연결 고르기와 원격 시청 딴짓 방지(S15P31A101-400, 설계 docs/design/cctv-remote-view.md).
// - 먼저 같은 노트북의 로컬 미리보기(127.0.0.1)를 짧게(LOCAL_PROBE_MS) 시도한다. 열리면 그대로 로컬을 쓴다(끊겨도 로컬로 다시 붙는다).
// - 안 열리면 EC2 원격 시청으로 붙는다(연결마다 새 입장권). 형식·디코딩은 로컬과 같다(previewSession).
// - 원격만: 탭이 숨으면 닫고 보이면 다시 붙는다. 입력이 IDLE_MS(10분) 없으면, 한 번 시청이 WATCH_MS(30분)를 넘으면 멈추고
//   "다시 보기"(resume)를 기다린다. 서버가 viewer_limit·monthly_quota 로 닫아도 다시 붙지 않는다(previewSession).
// 타이머·소켓은 주입받아 시험한다.

export const LOCAL_PROBE_MS = 1_500;
export const IDLE_MS = 10 * 60_000;
export const WATCH_MS = 30 * 60_000;

export interface ViewSink extends PreviewSink {
  setMode: (mode: ViewMode) => void;
  setPause: (pause: PauseReason | null) => void;
}

export interface ViewOptions {
  localUrl: string;
  /** 원격 시청 주소(입장권 포함)를 새로 받는다. */
  remoteUrl: () => Promise<string>;
  probeMs?: number;
  idleMs?: number;
  watchMs?: number;
}

export interface CctvView {
  /** 마우스·키보드·터치 입력. 원격 시청의 입력 없음 시간을 처음부터 센다. */
  activity: () => void;
  /** 탭이 숨었는지(document.visibilityState === 'hidden'). */
  visibility: (hidden: boolean) => void;
  /** "다시 보기": 멈춘 원격 시청을 새 입장권으로 다시 붙는다. */
  resume: () => void;
  stop: () => void;
}

export function startCctvView(options: ViewOptions, deps: PreviewDeps, sink: ViewSink): CctvView {
  const probeMs = options.probeMs ?? LOCAL_PROBE_MS;
  const idleMs = options.idleMs ?? IDLE_MS;
  const watchMs = options.watchMs ?? WATCH_MS;
  let mode: ViewMode = 'probing';
  /** 로컬 미리보기 연결(시도 중이거나 로컬로 정함). */
  let local: PreviewSession | null = null;
  /** 로컬이 시작 도중(동기)에 실패해 원격으로 갔다. 시작이 끝나면 로컬을 멈춘다. */
  let localFailedEarly = false;
  /** 원격 시청 연결. */
  let session: PreviewSession | null = null;
  let probeTimer: unknown = null;
  let idleTimer: unknown = null;
  let watchTimer: unknown = null;
  let lastActivity = deps.now();
  let paused: PauseReason | null = null;
  let stopped = false;

  const clear = (id: unknown) => {
    if (id !== null) deps.clearTimer(id);
  };

  const clearGuards = () => {
    clear(idleTimer);
    clear(watchTimer);
    idleTimer = watchTimer = null;
  };

  const pause = (reason: PauseReason) => {
    session?.stop();
    session = null;
    clearGuards();
    paused = reason;
    sink.setPause(reason);
    sink.setLink('stopped');
  };

  // 입력이 있을 때마다 타이머를 다시 걸지 않는다. 울리면 마지막 입력부터 남은 시간만큼 다시 건다
  const armIdle = () => {
    clear(idleTimer);
    const left = Math.max(0, lastActivity + idleMs - deps.now());
    idleTimer = deps.setTimer(() => {
      idleTimer = null;
      if (deps.now() - lastActivity >= idleMs) pause('idle');
      else armIdle();
    }, left);
  };

  const startRemote = () => {
    paused = null;
    sink.setPause(null);
    lastActivity = deps.now();
    session = startPreviewSession(options.remoteUrl, deps, sink);
    armIdle();
    clear(watchTimer);
    watchTimer = deps.setTimer(() => {
      watchTimer = null;
      pause('watch_limit');
    }, watchMs);
  };

  const toRemote = () => {
    if (stopped || mode !== 'probing') return;
    clear(probeTimer);
    probeTimer = null;
    if (local) local.stop();
    else localFailedEarly = true;
    local = null;
    mode = 'remote';
    sink.setMode('remote');
    startRemote();
  };

  // 로컬 시도 동안은 연결 중으로만 보이고, 열리면 로컬로 정한다. 붙지 못하면 바로 원격으로 간다
  const localSink: PreviewSink = {
    ...sink,
    setLink: (link: PreviewLink) => {
      if (mode !== 'probing') {
        sink.setLink(link);
        return;
      }
      if (link === 'open') {
        clear(probeTimer);
        probeTimer = null;
        mode = 'local';
        sink.setMode('local');
        sink.setLink('open');
      } else if (link === 'unavailable') {
        toRemote();
      } else {
        sink.setLink(link);
      }
    },
  };

  sink.setMode('probing');
  const started = startPreviewSession(options.localUrl, deps, localSink);
  if (localFailedEarly) started.stop();
  else local = started;
  if (mode === 'probing') probeTimer = deps.setTimer(toRemote, probeMs);

  return {
    activity: () => {
      lastActivity = deps.now();
    },
    visibility: (hidden) => {
      if (stopped || mode !== 'remote') return;
      if (hidden && session) pause('hidden');
      else if (!hidden && paused === 'hidden') startRemote();
    },
    resume: () => {
      if (stopped || mode !== 'remote') return;
      session?.stop();
      clearGuards();
      startRemote();
    },
    stop: () => {
      stopped = true;
      clear(probeTimer);
      clearGuards();
      local?.stop();
      session?.stop();
      local = session = null;
    },
  };
}
