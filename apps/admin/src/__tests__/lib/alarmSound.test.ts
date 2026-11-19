import {
  createAlarmSound,
  installAudioUnlock,
  SOUND_PATTERN,
  SOUND_STORAGE_KEY,
} from '@/lib/alarmSound';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 소리 크기 곡선과 시작·멈춤만 기록하는 oscillator 대역. */
interface FakeOscillator {
  type: string;
  frequency: { value: number };
  startAt?: number;
  /** stop(at) 호출 기록. 예약 멈춤은 시각, 끊기(cut)는 undefined. */
  stops: (number | undefined)[];
  sets: [value: number, at: number][];
  ramps: [value: number, at: number][];
  connect(gain: { gain: unknown }): { connect(): void };
  start(at: number): void;
  stop(at?: number): void;
}

/** resume 이 막히면(blocked) suspended 로 남는 AudioContext 대역. */
class FakeAudioContext extends EventTarget {
  state: AudioContextState = 'suspended';
  currentTime = 10;
  destination = {};
  oscillators: FakeOscillator[] = [];
  resumes = 0;
  private gains: { sets: [number, number][]; ramps: [number, number][] }[] = [];

  constructor(public blocked = false) {
    super();
  }

  resume() {
    this.resumes += 1;
    if (!this.blocked) this.run();
    return Promise.resolve();
  }

  run() {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  }

  /** 절전 복귀·장치 변경처럼 브라우저가 소리를 멈춘다. */
  interrupt() {
    this.state = 'suspended';
    this.dispatchEvent(new Event('statechange'));
  }

  createGain() {
    const sets: [number, number][] = [];
    const ramps: [number, number][] = [];
    this.gains.push({ sets, ramps });
    return {
      gain: {
        value: 1,
        setValueAtTime: (value: number, at: number) => sets.push([value, at]),
        exponentialRampToValueAtTime: (value: number, at: number) => ramps.push([value, at]),
      },
      connect: () => undefined,
      sets,
      ramps,
    };
  }

  createOscillator(): FakeOscillator {
    const osc: FakeOscillator = {
      type: '',
      frequency: { value: 0 },
      stops: [],
      sets: [],
      ramps: [],
      connect(gain) {
        const { sets, ramps } = gain as unknown as {
          sets: [number, number][];
          ramps: [number, number][];
        };
        osc.sets = sets;
        osc.ramps = ramps;
        return { connect: () => undefined };
      },
      start(at) {
        osc.startAt = at;
      },
      stop(at) {
        osc.stops.push(at);
      },
    };
    this.oscillators.push(osc);
    return osc;
  }
}

/** localStorage 대역. throws 면 접근하는 순간 던진다(차단된 사이트 데이터). */
function fakeStorage(initial: Record<string, string> = {}, throws = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (throws) throw new DOMException('denied', 'SecurityError');
  };
  return {
    data,
    getItem: (key: string) => {
      guard();
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      guard();
      data.set(key, value);
    },
    removeItem: (key: string) => {
      guard();
      data.delete(key);
    },
  };
}

function setup({
  blocked = false,
  stored = {} as Record<string, string>,
  storageThrows = false,
} = {}) {
  const contexts: FakeAudioContext[] = [];
  const storage = fakeStorage(stored, storageThrows);
  const sound = createAlarmSound(
    () => {
      const ctx = new FakeAudioContext(blocked);
      contexts.push(ctx);
      return ctx as unknown as AudioContext;
    },
    () => storage,
  );
  return { sound, contexts, storage };
}

/** 깨워 둔 소리. */
async function unlocked(options?: Parameters<typeof setup>[0]) {
  const made = setup(options);
  await made.sound.unlock();
  return { ...made, ctx: made.contexts[0]! };
}

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAlarmSound: 깨우기와 차단', () => {
  it('prepare 는 입력 전에 AudioContext 를 멈춤 상태로 미리 만든다(그래야 차단됨을 안다)', () => {
    const { sound, contexts } = setup();
    sound.prepare();
    sound.prepare();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.state).toBe('suspended');
    expect(sound.ready).toBe(false);
  });

  it('깨우기 전에는 울려야 해도 소리를 내지 않는다', () => {
    const { sound, contexts } = setup();
    sound.prepare();
    sound.ring('CRITICAL');
    expect(contexts[0]!.oscillators).toHaveLength(0);
  });

  it('깨우면 ready 가 되고 구독자에게 알린다', async () => {
    const { sound } = setup();
    const listener = vi.fn();
    sound.subscribe(listener);
    await sound.unlock();
    expect(sound.ready).toBe(true);
    expect(sound.getSnapshot().ready).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('브라우저가 막고 있으면 깨워도 ready 가 아니고 소리를 내지 않는다', async () => {
    const { sound, ctx } = await unlocked({ blocked: true });
    sound.ring('CRITICAL');
    expect(sound.ready).toBe(false);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('막혀 있던 소리가 풀리면 다음 주기를 기다리지 않고 바로 울린다', async () => {
    const { sound, ctx } = await unlocked({ blocked: true });
    sound.ring('CRITICAL');
    vi.advanceTimersByTime(2500);
    expect(ctx.oscillators).toHaveLength(0);

    ctx.blocked = false;
    await sound.unlock();
    expect(sound.ready).toBe(true);
    expect(ctx.oscillators).toHaveLength(1);
  });

  it('깨운 뒤 멈췄으면 다음 주기에 입력 없이 다시 깨워 이어 울린다', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('CRITICAL');
    expect(ctx.oscillators).toHaveLength(1);

    ctx.interrupt();
    expect(sound.ready).toBe(false);
    vi.advanceTimersByTime(2500);
    expect(ctx.resumes).toBeGreaterThan(1);
    expect(sound.ready).toBe(true);
    expect(ctx.oscillators).toHaveLength(2);
  });

  it('AudioContext 를 만들 수 없어도 던지지 않고 ready 가 아니다', async () => {
    const sound = createAlarmSound(
      () => {
        throw new Error('unsupported');
      },
      () => fakeStorage(),
    );
    sound.prepare();
    await expect(sound.unlock()).resolves.toBeUndefined();
    sound.ring('CRITICAL');
    expect(sound.ready).toBe(false);
  });

  it('구독을 끊으면 더 알리지 않는다', async () => {
    const { sound } = setup();
    const listener = vi.fn();
    sound.subscribe(listener)();
    await sound.unlock();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createAlarmSound: 등급별 소리', () => {
  it('위험은 880Hz 사각파를 0.12초씩 3번, 한 oscillator 의 소리 크기 곡선으로 울린다', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('CRITICAL');

    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0]!;
    const { count, hz, lengthS, stepS, volume } = SOUND_PATTERN.CRITICAL;
    expect([count, hz, lengthS, stepS, volume]).toEqual([3, 880, 0.12, 0.2, 0.08]);
    expect(osc.type).toBe('square');
    expect(osc.frequency.value).toBe(880);
    expect(osc.startAt).toBeCloseTo(10.02, 6);
    expect(osc.stops).toHaveLength(1);
    expect(osc.stops[0]).toBeCloseTo(10.02 + 2 * 0.2 + 0.12, 6);
    // 울림마다 0.0001 에서 올라와 volume 을 지키다 내려간다(지수 램프).
    close(
      osc.sets.filter(([v]) => v === 0.0001).map(([, at]) => at),
      [10.02, 10.22, 10.42],
    );
    expect(osc.ramps.filter(([v]) => v === 0.08)).toHaveLength(3);
    expect(osc.ramps.filter(([v]) => v === 0.0001)).toHaveLength(3);
    close(
      osc.ramps.filter(([v]) => v === 0.0001).map(([, at]) => at),
      [10.14, 10.34, 10.54],
    );
  });

  it('경고는 587Hz 를 0.18초씩 2번 더 낮고 작게 울린다', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('HIGH');

    const osc = ctx.oscillators[0]!;
    expect(osc.type).toBe('square');
    expect(osc.frequency.value).toBe(587);
    expect(osc.stops[0]).toBeCloseTo(10.02 + 0.32 + 0.18, 6);
    expect(osc.ramps.filter(([v]) => v === 0.06)).toHaveLength(2);
    expect(SOUND_PATTERN.HIGH).toMatchObject({ count: 2, volume: 0.06, everyMs: 6000 });
  });

  it('위험은 2.5초마다, 경고는 6초마다 되풀이하고 이전 묶음은 끊는다', async () => {
    const critical = await unlocked();
    critical.sound.ring('CRITICAL');
    vi.advanceTimersByTime(2500 * 2);
    expect(critical.ctx.oscillators).toHaveLength(3);
    // 새 묶음이 시작되면 직전 묶음은 끊어 겹치지 않는다.
    expect(critical.ctx.oscillators[0]!.stops).toHaveLength(2);
    expect(critical.ctx.oscillators[0]!.stops[1]).toBeUndefined();
    vi.advanceTimersByTime(2499);
    expect(critical.ctx.oscillators).toHaveLength(3);

    const high = await unlocked();
    high.sound.ring('HIGH');
    vi.advanceTimersByTime(5999);
    expect(high.ctx.oscillators).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(high.ctx.oscillators).toHaveLength(2);
  });

  it('등급이 바뀌면 바로 그 소리로 갈아타고 이전 주기는 지운다(겹치지 않는다)', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('HIGH');
    expect(ctx.oscillators).toHaveLength(1);

    sound.ring('CRITICAL');
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[1]!.frequency.value).toBe(880);
    // 이전 묶음은 끊겼다.
    expect(ctx.oscillators[0]!.stops[1]).toBeUndefined();

    vi.advanceTimersByTime(6000);
    // 6초 동안 위험 주기(2.5초)만 두 번 더 울린다. 경고 주기가 살아 있으면 587Hz 가 섞인다.
    expect(ctx.oscillators.slice(2).map((o) => o.frequency.value)).toEqual([880, 880]);
  });

  it('같은 등급을 다시 알려도 다시 울리지 않고, 비우면 멈춘다', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('CRITICAL');
    sound.ring('CRITICAL');
    expect(ctx.oscillators).toHaveLength(1);

    sound.ring(null);
    expect(ctx.oscillators[0]!.stops[1]).toBeUndefined();
    vi.advanceTimersByTime(2500 * 4);
    expect(ctx.oscillators).toHaveLength(1);
  });
});

describe('createAlarmSound: 끄기와 저장', () => {
  it('끄면 울리던 소리가 멈추고 켜면 바로 이어진다', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('CRITICAL');
    sound.setMuted(true);
    vi.advanceTimersByTime(2500 * 3);
    expect(ctx.oscillators).toHaveLength(1);
    expect(sound.getSnapshot()).toMatchObject({ muted: true, want: 'CRITICAL' });

    sound.setMuted(false);
    expect(ctx.oscillators).toHaveLength(2);
  });

  it('끄면 simai.sound 에 "off" 를 남기고, 켜면 키를 지운다', () => {
    const { sound, storage } = setup();
    sound.setMuted(true);
    expect(SOUND_STORAGE_KEY).toBe('simai.sound');
    expect(storage.data.get('simai.sound')).toBe('off');
    sound.setMuted(false);
    expect(storage.data.has('simai.sound')).toBe(false);
  });

  it('저장된 꺼짐은 다시 열어도 유지되고, 다른 값은 켜짐으로 본다', () => {
    expect(setup({ stored: { 'simai.sound': 'off' } }).sound.getSnapshot().muted).toBe(true);
    expect(setup({ stored: { 'simai.sound': 'on' } }).sound.getSnapshot().muted).toBe(false);
    expect(setup().sound.getSnapshot().muted).toBe(false);
  });

  it('저장소가 던져도(차단된 환경) 읽기·쓰기가 실패하지 않고 이 화면에서는 끄고 켜진다', () => {
    const { sound } = setup({ storageThrows: true });
    expect(sound.getSnapshot().muted).toBe(false);
    expect(() => sound.setMuted(true)).not.toThrow();
    expect(sound.getSnapshot().muted).toBe(true);
    expect(() => sound.setMuted(false)).not.toThrow();
    expect(sound.getSnapshot().muted).toBe(false);
  });

  it('localStorage 접근 자체가 던져도 만들어진다', () => {
    const sound = createAlarmSound(undefined, () => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(sound.getSnapshot().muted).toBe(false);
    expect(() => sound.setMuted(true)).not.toThrow();
  });
});

describe('createAlarmSound: 소리 버튼 누름(toggle)', () => {
  it('막힌 채 누르면 막힘만 풀고 끄지 않는다', async () => {
    const { sound } = setup();
    sound.prepare();
    sound.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(sound.ready).toBe(true);
    expect(sound.getSnapshot().muted).toBe(false);
  });

  it('깨어 있으면 누를 때마다 끄고 켠다', async () => {
    const { sound, storage } = await unlocked();
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(true);
    expect(storage.data.get('simai.sound')).toBe('off');
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(false);
    expect(storage.data.has('simai.sound')).toBe(false);
  });

  it('누르는 순간 막혀 있었으면 그 입력이 막힘을 푼 뒤의 click 도 끄지 않는다', async () => {
    const { sound } = setup();
    sound.prepare();
    // pointerdown 에서 막혀 있었는데, click 이 오기 전에 풀렸다.
    sound.notePress();
    await sound.unlock();
    expect(sound.ready).toBe(true);
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(false);
    // 그다음 누름(막히지 않은 채로)은 끈다.
    sound.notePress();
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(true);
  });

  it('꺼져 있으면 막혀 있어도 누르면 켜진다', async () => {
    const { sound } = setup({ blocked: true, stored: { 'simai.sound': 'off' } });
    sound.prepare();
    expect(sound.getSnapshot()).toMatchObject({ muted: true, ready: false });
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(false);
  });

  it('깨울 AudioContext 를 만들 수 없는 환경은 풀 막힘이 없으니 누르면 그냥 끈다', () => {
    const sound = createAlarmSound(
      () => {
        throw new Error('unsupported');
      },
      () => fakeStorage(),
    );
    sound.prepare();
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(true);
  });
});

describe('installAudioUnlock', () => {
  function install(options?: Parameters<typeof setup>[0]) {
    const made = setup(options);
    const unlock = vi.spyOn(made.sound, 'unlock');
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    installAudioUnlock(made.sound, target as unknown as Window);
    return { ...made, unlock, target, add };
  }

  it('설치하면 AudioContext 를 미리 만든다(첫 입력 전에 차단됨을 알 수 있다)', () => {
    const { contexts, sound } = install();
    expect(contexts).toHaveLength(1);
    expect(sound.ready).toBe(false);
  });

  it('pointerdown·keydown·pointerup 을 캡처 단계에서 듣는다', () => {
    const { add } = install();
    expect(add.mock.calls.map(([type]) => type).sort()).toEqual([
      'keydown',
      'pointerdown',
      'pointerup',
    ]);
    for (const [, , options] of add.mock.calls) expect(options).toEqual({ capture: true });
  });

  it('첫 입력에서 깨우고, 깨어 있는 동안은 다시 깨우지 않는다', async () => {
    const { sound, unlock, target } = install();
    target.dispatchEvent(new Event('pointerdown'));
    await unlock.mock.results[0]!.value;
    expect(sound.ready).toBe(true);
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerup'));
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('터치는 손을 뗄 때만 허용하므로 pointerup 에서도 깨운다', async () => {
    const { sound, unlock, target, contexts } = install({ blocked: true });
    target.dispatchEvent(new Event('pointerdown'));
    await unlock.mock.results[0]!.value;
    expect(sound.ready).toBe(false);

    contexts[0]!.blocked = false;
    target.dispatchEvent(new Event('pointerup'));
    await unlock.mock.results[1]!.value;
    expect(sound.ready).toBe(true);
  });

  it('키보드 입력으로도 깨운다', async () => {
    const { sound, unlock, target } = install();
    target.dispatchEvent(new Event('keydown'));
    await unlock.mock.results[0]!.value;
    expect(sound.ready).toBe(true);
  });

  it('나중에 소리가 멈추면 다음 입력에서 다시 깨운다(리스너는 떼지 않는다)', async () => {
    const { sound, unlock, target, contexts } = install();
    target.dispatchEvent(new Event('pointerdown'));
    await unlock.mock.results[0]!.value;
    contexts[0]!.interrupt();
    target.dispatchEvent(new Event('keydown'));
    await unlock.mock.results[1]!.value;
    expect(sound.ready).toBe(true);
  });

  it('깨우지 못하면 다음 입력에서 다시 시도한다', async () => {
    const { unlock, target } = install({ blocked: true });
    target.dispatchEvent(new Event('keydown'));
    await unlock.mock.results[0]!.value;
    target.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(2);
  });

  it('누르는 순간의 막힘을 적어 두어, 그 누름이 막힘을 푼 뒤의 소리 버튼 click 이 끄지 않는다', async () => {
    const { sound, unlock, target } = install();
    target.dispatchEvent(new Event('pointerdown'));
    await unlock.mock.results[0]!.value;
    expect(sound.ready).toBe(true);
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(false);

    // 이미 깨어 있는 상태의 다음 누름은 끈다.
    target.dispatchEvent(new Event('pointerdown'));
    sound.toggle();
    expect(sound.getSnapshot().muted).toBe(true);
  });
});

describe('1회 경보', () => {
  it('한 묶음만 울리며 갱신·mute·절전 복귀에 반복하지 않는다', async () => {
    const { sound, ctx } = await unlocked();
    sound.ring('HIGH', { once: true, key: 'r3:1' });
    expect(ctx.oscillators).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    sound.ring('HIGH', { once: true, key: 'r3:1' });
    sound.setMuted(true);
    sound.setMuted(false);
    ctx.interrupt();
    ctx.run();
    expect(ctx.oscillators).toHaveLength(1);
    sound.ring('HIGH', { once: true, key: 'r3:2' });
    expect(ctx.oscillators).toHaveLength(2);
  });

  it('잠겨서 못 울린 1회는 잠금 해제 뒤 한 번 울린다', async () => {
    const { sound, contexts } = setup({ blocked: true });
    sound.prepare();
    sound.ring('HIGH', { once: true, key: 'r3:1' });
    expect(contexts[0]!.oscillators).toHaveLength(0);
    contexts[0]!.blocked = false;
    await sound.unlock();
    expect(contexts[0]!.oscillators).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(contexts[0]!.oscillators).toHaveLength(1);
  });
});

it('다른 사람의 새 1회 경보는 울리고, 같이 알린 이전 경보가 남아도 반복하지 않는다', async () => {
  const { sound, ctx } = await unlocked();
  sound.ring('HIGH', { once: true, key: 'a', keys: ['a'] });
  sound.ring('HIGH', { once: true, key: 'a|b', keys: ['a', 'b'] });
  expect(ctx.oscillators).toHaveLength(2);
  sound.ring('HIGH', { once: true, key: 'b', keys: ['b'] });
  sound.ring('HIGH', { once: true, key: 'a', keys: ['a'] });
  expect(ctx.oscillators).toHaveLength(2);
});
