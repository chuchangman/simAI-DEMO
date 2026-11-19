import { EXAMPLE_REPLAY_FILES } from '@/features/viewer3d/dev-harness/harnessSource';
import riskText from '@/features/viewer3d/replay/fixtures/risk_event.example.jsonl?raw';
import worldText from '@/features/viewer3d/replay/fixtures/world_state.example.jsonl?raw';
import { lastIndexAtOrBefore, parseReplayLog } from '@/features/viewer3d/replay/replayLog';
import { describe, expect, it } from 'vitest';

// 녹화 재생 기록(JSONL) 검사(-187). 예시 기록은 contracts/examples 의 world_state·risk_event 를 이어 쓴 것이다.
const HEALTH = import.meta.glob<{ default: unknown }>(
  '../../../../../../../contracts/examples/viewer_health.json',
  { eager: true },
);
const health = JSON.stringify(Object.values(HEALTH)[0]!.default);

const T0 = 1_760_342_400_100;
const worlds = worldText.trim().split('\n');
const events = riskText.trim().split('\n');
type Message = { msg_id: string; payload: Record<string, unknown> };
const edit = (line: string, change: (m: Message) => void) => {
  const message = JSON.parse(line) as Message;
  change(message);
  return JSON.stringify(message);
};
const newId = (line: string, suffix: string) =>
  edit(line, (m) => {
    m.msg_id = m.msg_id.slice(0, -suffix.length) + suffix;
  });
const reasons = (log: ReturnType<typeof parseReplayLog>) =>
  log.issues.map((i) => [i.file, i.line, i.reason]);

describe('재생 기록 읽기', () => {
  it('예시 기록은 모든 줄을 받고 두 파일을 시각순으로 합친다', () => {
    const log = parseReplayLog(EXAMPLE_REPLAY_FILES);
    expect(log.issues).toEqual([]);
    expect([log.lines, log.worlds.length, log.events.length]).toEqual([48, 45, 3]);
    expect([log.start, log.end]).toEqual([T0, T0 + 5900]);
    const times = log.worlds.map((w) => w.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // 1.5초 기록 없는 구간을 그대로 둔다(채우지 않는다).
    const after = times.indexOf(T0 + 2900);
    expect(times[after + 1]).toBe(T0 + 4500);
    expect(log.events.map((e) => [e.t - T0, e.eventSequence])).toEqual([
      [1000, 1],
      [2000, 2],
      [5000, 3],
    ]);
  });

  it('못 쓰는 줄은 고치지 않고 빼며 파일·줄 번호·이유를 남긴다', () => {
    const noTracks = edit(worlds[3]!, (m) => {
      delete m.payload.tracks;
    });
    const sameTime = newId(worlds[0]!, 'ffff');
    const live = edit(newId(events[0]!, 'eeee'), (m) => {
      m.payload.source = 'LIVE';
    });
    const text = [
      worlds[0],
      '{깨진 줄',
      noTracks,
      worlds[0],
      sameTime,
      worlds[2],
      worlds[1],
      '',
      health,
      live,
      '[1, 2]',
      '{"msg_type":"frame"}',
      worlds[4],
    ].join('\n');
    const log = parseReplayLog([{ name: 'a.jsonl', text }]);
    expect(reasons(log)).toEqual([
      ['a.jsonl', 2, 'NOT_JSON'],
      ['a.jsonl', 3, 'SCHEMA'],
      ['a.jsonl', 4, 'DUPLICATE_MSG_ID'],
      ['a.jsonl', 5, 'DUPLICATE_TIME'],
      ['a.jsonl', 7, 'OUT_OF_ORDER'],
      ['a.jsonl', 9, 'NOT_REPLAYABLE'],
      ['a.jsonl', 10, 'NOT_REPLAY_SOURCE'],
      ['a.jsonl', 11, 'NOT_OBJECT'],
      ['a.jsonl', 12, 'UNKNOWN_MSG_TYPE'],
    ]);
    expect(log.worlds.map((w) => [w.line, w.t - T0])).toEqual([
      [1, 0],
      [6, 200],
      [13, 400],
    ]);
    expect(log.events).toEqual([]);
    expect(log.lines).toBe(12);
  });

  it('유한하지 않은 좌표는 0 으로 채우지 않고 뺀다', () => {
    const huge = worlds[0]!.replace('"pelvis_xyz":[3.4,', '"pelvis_xyz":[1e999,');
    expect(huge).not.toBe(worlds[0]);
    const log = parseReplayLog([{ name: 'w', text: huge }]);
    expect(log.worlds).toEqual([]);
    expect(['SCHEMA', 'NON_FINITE']).toContain(log.issues[0]!.reason);
  });

  it('같은 이벤트의 전이는 순번이 늘어야 하고, 되돌아간 순번·같은 순번은 뺀다', () => {
    const text = [events[0], events[2], events[1], newId(events[2]!, 'dddd')].join('\n');
    const log = parseReplayLog([{ name: 'e', text }]);
    expect(reasons(log)).toEqual([
      ['e', 3, 'OUT_OF_ORDER'],
      ['e', 4, 'DUPLICATE_TIME'],
    ]);
    expect(log.events.map((e) => e.eventSequence)).toEqual([1, 3]);
  });

  it('빈 파일은 파일 단위로 알리고, CRLF·BOM·끝 빈 줄은 받는다', () => {
    const log = parseReplayLog([
      { name: 'empty', text: '\n  \n' },
      { name: 'crlf', text: '\uFEFF' + worlds.slice(0, 3).join('\r\n') + '\r\n' },
    ]);
    expect(reasons(log)).toEqual([['empty', null, 'EMPTY_FILE']]);
    expect(log.worlds).toHaveLength(3);
    expect(parseReplayLog([]).start).toBeNull();
  });

  it('파일 사이에서 같은 시각 World 가 겹치면 먼저 읽은 파일 것만 쓴다', () => {
    const other = newId(worlds[1]!, 'cccc');
    const log = parseReplayLog([
      { name: 'b', text: [worlds[0], worlds[1]].join('\n') },
      { name: 'c', text: [other, worlds[2]].join('\n') },
    ]);
    expect(reasons(log)).toEqual([['c', 1, 'DUPLICATE_TIME']]);
    expect(log.worlds.map((w) => [w.file, w.line])).toEqual([
      ['b', 1],
      ['b', 2],
      ['c', 2],
    ]);
  });

  it('시각 찾기는 그 시각 이하의 마지막 기록이다', () => {
    const { worlds: entries } = parseReplayLog(EXAMPLE_REPLAY_FILES);
    expect(lastIndexAtOrBefore(entries, T0 - 1)).toBe(-1);
    expect(entries[lastIndexAtOrBefore(entries, T0 + 150)]!.t).toBe(T0 + 100);
    expect(entries[lastIndexAtOrBefore(entries, T0 + 4000)]!.t).toBe(T0 + 2900);
    expect(lastIndexAtOrBefore(entries, T0 + 99_999)).toBe(entries.length - 1);
  });
});
