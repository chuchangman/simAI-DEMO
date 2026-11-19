import { adaptMessage, type RejectReason } from '@/features/viewer3d/data/contractAdapter';
import type { RiskEventView } from '@/features/viewer3d/data/spatialFrame';

// 녹화 재생 기록(JSONL)을 줄 단위로 검사해 시간순 재생 목록으로 만든다(S15P31A101-187).
// Tier 0 file 입력(-215)은 world_state.jsonl·risk_event.jsonl 을 한 줄에 메시지 하나씩 남긴다. 두 파일을 함께 받아 시간순으로 합친다.
// 줄마다 LIVE 와 같은 계약 검사(adaptMessage)를 거친다. 값은 바꾸지 않고 원문 줄을 그대로 두었다가 재생할 때 다시 읽는다.
// 못 쓰는 줄은 고치거나 추정하지 않고 빼며, 파일·줄 번호·이유를 남긴다.

export type ReplayIssueReason =
  | RejectReason
  /** 내용이 없는 파일. */
  | 'EMPTY_FILE'
  /** JSON 으로 읽지 못한 줄. */
  | 'NOT_JSON'
  /** viewer_health·avatar_frame. 재생 장면에 쓰지 않는다. */
  | 'NOT_REPLAYABLE'
  /** source 가 REPLAY 가 아닌 risk_event. LIVE 등 다른 출처 이벤트를 재생으로 섞지 않는다. */
  | 'NOT_REPLAY_SOURCE'
  /** 앞에서 받은 msg_id 를 다시 받았다. */
  | 'DUPLICATE_MSG_ID'
  /** 같은 t_latest_global 의 World, 또는 같은 event_sequence 의 이벤트 전이. 앞의 것만 쓴다. */
  | 'DUPLICATE_TIME'
  /** 앞 줄보다 오래된 World·이벤트 전이. 어느 쪽이 맞는지 알 수 없어 먼저 쓰인 순서를 믿고 뒤에 온 줄을 뺀다. */
  | 'OUT_OF_ORDER';

export interface ReplayIssue {
  file: string;
  /** 1 부터 센 줄 번호. 파일 전체 문제면 null. */
  line: number | null;
  reason: ReplayIssueReason;
  detail: string;
}

export interface ReplayEntry {
  kind: 'world' | 'event';
  /** 재생 시각축 위치(UTC ms). World 는 t_latest_global, 이벤트는 전이 시각. */
  t: number;
  msgId: string;
  /** 이벤트면 event_id. World 면 null. */
  eventId: string | null;
  /** 이벤트 전이 순번. 없거나 World 면 null. */
  eventSequence: number | null;
  /** 원문 줄. 보낼 때마다 다시 읽어 받는 쪽이 고쳐도 기록이 바뀌지 않게 한다. */
  text: string;
  file: string;
  line: number;
}

export interface ReplayLog {
  files: readonly string[];
  /** t 오름차순. 같은 t 가 없다. */
  worlds: readonly ReplayEntry[];
  /** t 오름차순. 같은 event_id 안에서는 늘 더 새 전이다. */
  events: readonly ReplayEntry[];
  /** 기록의 처음·끝 시각. 쓸 줄이 없으면 null. */
  start: number | null;
  end: number | null;
  issues: readonly ReplayIssue[];
  /** 읽은 줄 수(빈 줄 제외). */
  lines: number;
}

export interface ReplayFile {
  name: string;
  text: string;
}

// spatialData.store 의 이벤트 순서와 같은 시각을 쓴다(전이 시각 updated_at 이 먼저).
const eventTime = (e: RiskEventView) => e.updatedAt ?? e.resolvedAt ?? e.raisedAt ?? e.meta.sentAt;

const REJECT_LABEL: Record<RejectReason, string> = {
  NOT_OBJECT: '객체가 아니다',
  UNKNOWN_MSG_TYPE: '모르는 msg_type',
  SCHEMA: '계약 검사 실패',
  NON_FINITE: '유한하지 않은 좌표',
};

/** 시각·순번 검사. World 는 시각이 늘어야 하고, 이벤트는 같은 event_id 안에서 더 새 전이여야 한다(Store 와 같은 기준). */
function createOrderCheck() {
  let lastWorld: number | null = null;
  const lastEvent = new Map<string, Pick<ReplayEntry, 't' | 'eventSequence'>>();
  return (entry: ReplayEntry): ReplayIssueReason | null => {
    if (entry.kind === 'world') {
      if (lastWorld !== null && entry.t <= lastWorld) {
        return entry.t === lastWorld ? 'DUPLICATE_TIME' : 'OUT_OF_ORDER';
      }
      lastWorld = entry.t;
      return null;
    }
    const prev = lastEvent.get(entry.eventId!);
    if (prev) {
      if (prev.eventSequence !== null && entry.eventSequence !== null) {
        if (entry.eventSequence <= prev.eventSequence) {
          return entry.eventSequence === prev.eventSequence ? 'DUPLICATE_TIME' : 'OUT_OF_ORDER';
        }
      } else if (entry.t <= prev.t) {
        return entry.t === prev.t ? 'DUPLICATE_TIME' : 'OUT_OF_ORDER';
      }
    }
    lastEvent.set(entry.eventId!, entry);
    return null;
  };
}

const ORDER_LABEL: Partial<Record<ReplayIssueReason, string>> = {
  DUPLICATE_TIME: '같은 시각·순번을 앞에서 받았다',
  OUT_OF_ORDER: '앞 줄보다 오래된 기록',
};

/**
 * 재생 기록 파일들을 읽는다. 예외를 던지지 않는다.
 * - 파일마다 줄 순서대로 검사하고, 그다음 모든 파일을 시각순으로 합쳐 한 번 더 순서를 검사한다(파일 사이 충돌).
 * - 빈 줄은 건너뛴다(끝 줄바꿈). 파일 첫 BOM 은 뗀다.
 */
export function parseReplayLog(files: readonly ReplayFile[]): ReplayLog {
  const issues: ReplayIssue[] = [];
  const seen = new Set<string>();
  // 파일·줄 순서(order)를 함께 둬서 같은 시각이면 읽은 순서를 지킨다.
  const accepted: { entry: ReplayEntry; order: number }[] = [];
  const fileOrder = new Map<string, number>();
  let lines = 0;

  files.forEach((file, fileIndex) => {
    const rows = file.text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const check = createOrderCheck();
    let used = 0;
    rows.forEach((row, index) => {
      const text = row.trim();
      if (text === '') return;
      used++;
      lines++;
      const at = { file: file.name, line: index + 1 };
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        issues.push({ ...at, reason: 'NOT_JSON', detail: 'JSON 이 아니다' });
        return;
      }
      // 수신 시각은 재생할 때 정한다. 여기서는 검사만 하므로 0 을 넘긴다.
      const result = adaptMessage(raw, 0);
      if (result.kind === 'rejected') {
        const label = REJECT_LABEL[result.reason];
        issues.push({ ...at, reason: result.reason, detail: label + ': ' + result.detail });
        return;
      }
      if (result.kind === 'health' || result.kind === 'avatar') {
        const type = result.kind === 'health' ? 'viewer_health' : 'avatar_frame';
        issues.push({
          ...at,
          reason: 'NOT_REPLAYABLE',
          detail: type + ' 는 재생 장면에 쓰지 않는다',
        });
        return;
      }
      const entry: ReplayEntry =
        result.kind === 'world'
          ? {
              kind: 'world',
              t: result.frame.tLatestGlobal,
              msgId: result.frame.meta.msgId,
              eventId: null,
              eventSequence: null,
              text,
              ...at,
            }
          : {
              kind: 'event',
              t: eventTime(result.event),
              msgId: result.event.meta.msgId,
              eventId: result.event.eventId,
              eventSequence: result.event.eventSequence,
              text,
              ...at,
            };
      if (result.kind === 'event' && result.event.source !== 'REPLAY') {
        issues.push({
          ...at,
          reason: 'NOT_REPLAY_SOURCE',
          detail: 'source ' + result.event.source + ' 이벤트는 재생에 넣지 않는다',
        });
        return;
      }
      if (seen.has(entry.msgId)) {
        issues.push({ ...at, reason: 'DUPLICATE_MSG_ID', detail: 'msg_id ' + entry.msgId });
        return;
      }
      seen.add(entry.msgId);
      const problem = check(entry);
      if (problem) {
        issues.push({ ...at, reason: problem, detail: ORDER_LABEL[problem]! });
        return;
      }
      accepted.push({ entry, order: accepted.length });
    });
    if (used === 0) {
      issues.push({ file: file.name, line: null, reason: 'EMPTY_FILE', detail: '내용이 없다' });
    }
    fileOrder.set(file.name, fileOrder.get(file.name) ?? fileIndex);
  });

  // 파일 사이를 시각순으로 합친다. 같은 시각은 읽은 순서를 지킨다.
  accepted.sort((a, b) => a.entry.t - b.entry.t || a.order - b.order);
  const check = createOrderCheck();
  const worlds: ReplayEntry[] = [];
  const events: ReplayEntry[] = [];
  for (const { entry } of accepted) {
    const problem = check(entry);
    if (problem) {
      issues.push({
        file: entry.file,
        line: entry.line,
        reason: problem,
        detail: ORDER_LABEL[problem]! + '(다른 파일과 겹침)',
      });
      continue;
    }
    (entry.kind === 'world' ? worlds : events).push(entry);
  }
  // 문제는 파일·줄 순으로 보인다(파일 사이 검사에서 나온 것도 제자리에).
  issues.sort(
    (a, b) => fileOrder.get(a.file)! - fileOrder.get(b.file)! || (a.line ?? 0) - (b.line ?? 0),
  );
  const firsts = [worlds[0]?.t, events[0]?.t].filter((t) => t !== undefined);
  const lasts = [worlds.at(-1)?.t, events.at(-1)?.t].filter((t) => t !== undefined);
  return {
    files: files.map((f) => f.name),
    worlds,
    events,
    start: firsts.length ? Math.min(...firsts) : null,
    end: lasts.length ? Math.max(...lasts) : null,
    issues,
    lines,
  };
}

/** t 이하에서 가장 마지막 항목의 위치. 없으면 -1. entries 는 t 오름차순이다. */
export function lastIndexAtOrBefore(entries: readonly ReplayEntry[], t: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
