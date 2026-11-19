// 관제 경보음(명세 FR-8 "소리는 확인까지 반복", FR-114 시험 경보). Web Audio 로 짧은 소리를 낸다.
// 확인 대기 경보 중 가장 높은 등급 하나만 확인까지 되풀이한다(겹치지 않게 늘 한 가지). 끄고 켜는 것은 상단 바 소리 버튼이 한다.
// 브라우저는 사용자가 누르기 전에는 소리를 막는다. AudioContext 는 미리 만들어 두고(멈춤으로 시작해 '차단됨'을 알 수 있다)
// 첫 입력에서 깨운다(installAudioUnlock).

/** 소리가 나는 등급. 주의·안내(CAUTION·INFO)는 소리가 없다. */
export type RingSeverity = 'CRITICAL' | 'HIGH';

interface SoundPattern {
  /** 음 높이(Hz) */
  hz: number;
  /** 한 묶음의 울림 수 */
  count: number;
  /** 울림 하나의 길이(s) */
  lengthS: number;
  /** 울림 시작 간격(s) */
  stepS: number;
  volume: number;
  /** 묶음 반복 주기(ms) */
  everyMs: number;
}

/** 위험: 높게 세 번 자주 · 경고: 낮게 두 번 드문드문(관제 데모 v41). */
export const SOUND_PATTERN: Record<RingSeverity, SoundPattern> = {
  CRITICAL: { hz: 880, count: 3, lengthS: 0.12, stepS: 0.2, volume: 0.08, everyMs: 2500 },
  HIGH: { hz: 587, count: 2, lengthS: 0.18, stepS: 0.32, volume: 0.06, everyMs: 6000 },
};

/** 소리를 끈 상태를 저장하는 localStorage 키. 끄면 SOUND_OFF_VALUE, 켜면 키를 지운다. */
export const SOUND_STORAGE_KEY = 'simai.sound';
const SOUND_OFF_VALUE = 'off';

/** 첫 울림을 이 시간 뒤로 잡아 시작 순간의 끊김을 피한다(s). */
const LEAD_S = 0.02;
/** 울림 앞뒤 소리 크기를 올리고 내리는 시간(s). 딱 끊기는 잡음을 막는다. */
const FADE_S = 0.02;
/** 지수 램프는 0 에 닿을 수 없어 이 값까지만 내린다. */
const SILENT = 0.0001;

export interface AlarmSoundState {
  /** 소리를 낼 수 있는지(깨운 뒤 running). false 면 브라우저가 막고 있다. */
  readonly ready: boolean;
  /** 사용자가 소리를 껐는지(시간 제한 없음). */
  readonly muted: boolean;
  /** 울려야 하는 등급(꺼짐·차단과 상관없이). 없으면 null. */
  readonly want: RingSeverity | null;
}

export interface AlarmSound {
  /** 소리를 낼 수 있는지(깨운 뒤 running). */
  readonly ready: boolean;
  /** AudioContext 를 입력 전에 미리 만든다(멈춤 상태). 실패해도 던지지 않는다. */
  prepare(): void;
  /** 사용자 입력 안에서 불러 소리를 깨운다. 실패해도 던지지 않는다. 결과는 ready 로 본다. */
  unlock(): Promise<void>;
  /** 누르는 순간(pointerdown·keydown)에 막혀 있었는지 적어 둔다. 그 입력이 막힘을 푼 것인지 toggle 이 알아야 한다. */
  notePress(): void;
  /** 울릴 등급을 정한다. 바뀌면 바로 그 소리로 갈아타고, null 이면 멈춘다. 같은 등급이면 아무것도 하지 않는다. */
  ring(
    severity: RingSeverity | null,
    options?: { once: boolean; key: string; keys?: readonly string[] },
  ): void;
  /** 소리를 끄거나 켠다. 저장소에 남긴다(저장할 수 없어도 이 화면에서는 반영한다). */
  setMuted(muted: boolean): void;
  /**
   * 소리 버튼을 눌렀을 때. 막힌 채로 누른 것은 막힘만 풀고(켜려고 누른 것을 끔으로 받지 않는다), 아니면 끄고 켠다.
   * 깨울 AudioContext 를 만들 수 없는 환경은 풀 막힘이 없으니 그냥 끄고 켠다.
   */
  toggle(): void;
  /** useSyncExternalStore 용: 바뀔 때만 새 객체. */
  getSnapshot(): AlarmSoundState;
  /** 상태가 바뀌면 알린다. */
  subscribe(listener: () => void): () => void;
}

type SoundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function readMuted(getStorage: () => SoundStorage): boolean {
  try {
    return getStorage().getItem(SOUND_STORAGE_KEY) === SOUND_OFF_VALUE;
  } catch {
    return false; // 저장소를 읽을 수 없는 환경(차단된 사이트 데이터 등)은 켠 채로 둔다.
  }
}

function writeMuted(getStorage: () => SoundStorage, muted: boolean) {
  try {
    const storage = getStorage();
    if (muted) storage.setItem(SOUND_STORAGE_KEY, SOUND_OFF_VALUE);
    else storage.removeItem(SOUND_STORAGE_KEY);
  } catch {
    // 저장할 수 없다. 이 화면에서만 반영된다.
  }
}

/** 한 묶음을 예약한다. 하나의 oscillator 를 소리 크기 곡선(올리고 내리기)으로 끊어 울리고, 그 oscillator 를 돌려준다. */
function scheduleBurst(ctx: AudioContext, pattern: SoundPattern): OscillatorNode {
  const t0 = ctx.currentTime + LEAD_S;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = pattern.hz;
  for (let k = 0; k < pattern.count; k++) {
    const at = t0 + k * pattern.stepS;
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.exponentialRampToValueAtTime(pattern.volume, at + FADE_S);
    gain.gain.setValueAtTime(pattern.volume, at + pattern.lengthS - 2 * FADE_S);
    gain.gain.exponentialRampToValueAtTime(SILENT, at + pattern.lengthS);
  }
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + (pattern.count - 1) * pattern.stepS + pattern.lengthS);
  return osc;
}

export function createAlarmSound(
  createContext: () => AudioContext = () => new AudioContext(),
  getStorage: () => SoundStorage = () => localStorage,
): AlarmSound {
  let context: AudioContext | null = null;
  /** 한 번이라도 running 이었는지. 그 뒤 멈춘 것(절전 복귀·장치 변경)은 입력 없이도 다시 깨워진다. */
  let wasRunning = false;
  let pressBlocked = false;
  let muted = readMuted(getStorage);
  let want: RingSeverity | null = null;
  let onceKey: string | null = null;
  const playedKeys = new Set<string>();
  let onceKeys: readonly string[] | null = null;
  const onceConsumed = () => onceKeys !== null && onceKeys.every((key) => playedKeys.has(key));
  let playingKey: string | null = null;
  /** 지금 되풀이하고 있는 등급. */
  let playing: RingSeverity | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let oscillator: OscillatorNode | null = null;
  const listeners = new Set<() => void>();

  const isRunning = () => context?.state === 'running';
  let snapshot: AlarmSoundState = { ready: false, muted, want };

  const commit = () => {
    const next = { ready: isRunning(), muted, want };
    if (
      next.ready === snapshot.ready &&
      next.muted === snapshot.muted &&
      next.want === snapshot.want
    )
      return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const cut = () => {
    if (!oscillator) return;
    try {
      oscillator.stop();
    } catch {
      // 이미 멈춰 있다.
    }
    oscillator = null;
  };

  /** 지금 등급의 울림 한 묶음. 멈춘 소리는 다시 깨우기만 한다. */
  const burst = () => {
    const ctx = context;
    const pattern = playing ? SOUND_PATTERN[playing] : null;
    if (!ctx || !pattern || onceConsumed()) return;
    if (ctx.state !== 'running') {
      // 절전 복귀·오디오 장치 변경 등으로 멈췄다. 이미 사용자가 누른 페이지라 대개 입력 없이 다시 깨워진다.
      if (wasRunning && ctx.state !== 'closed') ctx.resume().catch(() => undefined);
      return;
    }
    cut();
    oscillator = scheduleBurst(ctx, pattern);
    onceKeys?.forEach((key) => playedKeys.add(key));
  };

  /** 울릴 등급·끔·막힘에 맞춰 반복을 시작·교체·멈춘다. 겹치지 않게 늘 한 가지만. */
  const sync = (restart = false) => {
    const next = muted ? null : want;
    if (next !== playing || playingKey !== onceKey || (restart && !onceConsumed())) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      cut();
      playing = next;
      playingKey = onceKey;
      if (next) {
        burst();
        if (onceKey === null) timer = setInterval(burst, SOUND_PATTERN[next].everyMs);
      }
    }
    commit();
  };

  const onStateChange = () => {
    const running = isRunning();
    if (running) wasRunning = true;
    // 막혔던 소리가 풀리면 다음 주기를 기다리지 않고 바로 울린다.
    sync(running);
  };

  const ensure = () => {
    if (!context) {
      const created = createContext();
      created.addEventListener('statechange', onStateChange);
      context = created;
    }
    return context;
  };

  const unlock = async () => {
    try {
      const ctx = ensure();
      if (ctx.state !== 'running' && ctx.state !== 'closed') await ctx.resume();
    } catch {
      // 만들지 못했거나(미지원) 깨우지 못했다. ready 가 false 로 남아 소리 버튼이 '차단됨'을 보인다.
    }
    commit();
  };

  const setMuted = (value: boolean) => {
    muted = value;
    writeMuted(getStorage, value);
    sync();
  };

  return {
    get ready() {
      return isRunning();
    },
    prepare() {
      try {
        ensure();
      } catch {
        // 소리를 낼 수 없는 환경(미지원).
      }
      commit();
    },
    unlock,
    notePress() {
      pressBlocked = !isRunning();
    },
    ring(severity, options) {
      onceKey = options?.once ? options.key : null;
      onceKeys = options?.once ? (options.keys?.length ? options.keys : [options.key]) : null;
      want = severity;
      sync();
    },
    setMuted,
    toggle() {
      const unlockOnly = !muted && (pressBlocked || (context !== null && !isRunning()));
      pressBlocked = false;
      void unlock();
      if (!unlockOnly) setMuted(!muted);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const alarmSound = createAlarmSound();

/**
 * 사용자 입력(로그인 버튼 포함)에서 소리를 깨운다. 리스너는 떼지 않는다.
 * 터치는 손을 뗄 때(pointerup)에야 소리를 허용하므로 pointerdown·keydown 과 함께 pointerup 에서도 깨운다.
 * 캡처 단계에서 받아, 눌린 버튼의 onClick 보다 먼저 막힘 여부를 적는다(notePress).
 * 나중에 소리가 멈춰도(절전 복귀 등) 다음 입력에서 다시 깨운다. 깨어 있으면 아무것도 하지 않는다.
 */
export function installAudioUnlock(
  sound: AlarmSound = alarmSound,
  target: Pick<Window, 'addEventListener'> = window,
) {
  sound.prepare();
  const unlock = () => {
    if (!sound.ready) void sound.unlock();
  };
  const press = () => {
    sound.notePress();
    unlock();
  };
  const capture = { capture: true };
  target.addEventListener('pointerdown', press, capture);
  target.addEventListener('keydown', press, capture);
  target.addEventListener('pointerup', unlock, capture);
}
