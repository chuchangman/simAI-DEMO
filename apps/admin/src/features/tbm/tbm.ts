import { SEVERITY_RANK } from '@/features/events/events';
import type { Severity } from '@/features/events/types';
import { SITE_WIDE_TEXT } from '@/features/tbm/constants';
import type { LayoutItem, Rect, TaskEval, TbmTask } from '@/features/tbm/tbmDemo';
import { ruleName, SEVERITY_LABEL } from '@/lib/ruleNames';

// 레이아웃 · TBM 보고서의 계산. 시간대 겹침과 동시 작업 간섭, 작업 평가 글자를 화면 없이 한다.
// 회의록 칸은 tbmForm.ts, 작업 등록은 taskInput.ts 에 있다.

/** 'HH:MM' → 분. */
export function toMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 분 → 'HH:MM'. */
export const fromMin = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** 보낸 시각 표시('HH:MM'). */
export const clockText = (date: Date) => fromMin(date.getHours() * 60 + date.getMinutes());

type TimeSlot = Pick<TbmTask, 'from' | 'to'>;

/** 두 시간대가 겹친다. 한쪽이 끝나는 시각에 다른 쪽이 시작하면 겹치지 않는다. */
export const overlapsTime = (a: TimeSlot, b: TimeSlot) =>
  Math.max(toMin(a.from), toMin(b.from)) < Math.min(toMin(a.to), toMin(b.to));

/** 배치 항목의 높이(m). 동선이거나 높이를 모르면 0. */
export const itemHeight = (item: LayoutItem) => (item.kind !== 'path' ? (item.hgt ?? 0) : 0);

/** 배치 항목이 차지하는 직사각형들. 동선은 구간마다 폭만큼 넓힌 직사각형이다. */
export function itemRects(item: LayoutItem): Rect[] {
  if (item.kind !== 'path') return [{ x: item.x, y: item.y, w: item.w, h: item.h }];
  const hw = item.w / 2;
  return item.pts.slice(1).map(([bx, by], i) => {
    const [ax, ay] = item.pts[i]!;
    return {
      x: Math.min(ax, bx) - hw,
      y: Math.min(ay, by) - hw,
      w: Math.abs(bx - ax) + item.w,
      h: Math.abs(by - ay) + item.w,
    };
  });
}

/** 두 직사각형이 넓이를 갖고 겹친다(변만 닿으면 겹치지 않는다). */
export const rectHit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 두 직사각형이 겹친 부분. */
export function rectAnd(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}

/** 동시 작업 간섭 하나. 배치가 겹치면 그 자리(spot)를 같이 둔다. */
export interface Interference {
  a: string;
  b: string;
  from: string;
  to: string;
  sev: Severity;
  why: string;
  spot: Rect | null;
}

/** 동시 작업 간섭: 시간대가 겹치고, 배치가 겹치면 HIGH, 배치는 안 겹치지만 같은 구역이면 CAUTION 이다. */
export function tbmInterferences(tasks: readonly TbmTask[]): Interference[] {
  const out: Interference[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!;
      const b = tasks[j]!;
      const from = Math.max(toMin(a.from), toMin(b.from));
      const to = Math.min(toMin(a.to), toMin(b.to));
      if (from >= to) continue;
      const slot = { a: a.id, b: b.id, from: fromMin(from), to: fromMin(to) };
      const hit = firstHit(a, b);
      if (hit) out.push({ ...slot, sev: 'HIGH', ...hit });
      else if (a.zone && a.zone === b.zone)
        out.push({ ...slot, sev: 'CAUTION', why: `${taskPlace(a)}에서 동시 작업`, spot: null });
    }
  }
  return out;
}

function firstHit(a: TbmTask, b: TbmTask): { why: string; spot: Rect } | null {
  for (const ia of a.items) {
    for (const ib of b.items) {
      const spot = firstOverlap(itemRects(ia), itemRects(ib));
      if (spot) return { why: `${ia.label} ↔ ${ib.label} 겹침`, spot };
    }
  }
  return null;
}

/** 두 직사각형 묶음에서 먼저 겹치는 자리. 겹침이 없으면 null. */
function firstOverlap(as: readonly Rect[], bs: readonly Rect[]): Rect | null {
  for (const ra of as) {
    const rb = bs.find((r) => rectHit(ra, r));
    if (rb) return rectAnd(ra, rb);
  }
  return null;
}

/** 한 작업이 낀 간섭. */
export const interferencesOf = (all: readonly Interference[], taskId: string) =>
  all.filter((x) => x.a === taskId || x.b === taskId);

/** 작업 평가 중 가장 높은 등급. 평가가 없으면 null. */
export function taskPeak(task: Pick<TbmTask, 'evals'>): Severity | null {
  let peak: Severity | null = null;
  for (const e of task.evals) if (!peak || SEVERITY_RANK[e.sev] > SEVERITY_RANK[peak]) peak = e.sev;
  return peak;
}

/** 작업의 장소 글자(구역 작업은 구역 이름, 구역 없는 작업은 장소 또는 '현장 전체'). */
export const taskPlace = (task: Pick<TbmTask, 'area'>) => task.area ?? SITE_WIDE_TEXT;

export const SEVERITY_TEXT: Record<Severity, string> = {
  CRITICAL: `▲▲ ${SEVERITY_LABEL.CRITICAL}`,
  HIGH: `▲ ${SEVERITY_LABEL.HIGH}`,
  CAUTION: `! ${SEVERITY_LABEL.CAUTION}`,
  INFO: `i ${SEVERITY_LABEL.INFO}`,
};

export const evalText = (e: TaskEval) =>
  `${e.item} · ${ruleName(e.rule)} · ${SEVERITY_TEXT[e.sev]} · ${e.why}`;
