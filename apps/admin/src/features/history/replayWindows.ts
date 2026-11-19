import { mergeReplay } from '@/features/history/api';
import type { ReplayResponse, Span } from '@/features/history/types';

// 긴 작업의 기록은 여러 창으로 나눠 받는다. 앞 창부터 이어서 받은 구간이 생기면 그것만으로 먼저 화면을 띄우고,
// 나머지가 오는 대로 재생 기록을 늘린다. 이 파일은 그 판단만 한다(받기·그리기와 떨어진 순수 계산).

/** 창마다 받은 응답. 아직 못 받은 창은 undefined 다(받는 순서는 섞일 수 있다). */
export type WindowSlots = readonly (ReplayResponse | undefined)[];

/** 창 하나를 받은 것으로 적은 새 목록. 원본은 고치지 않는다. */
export function withWindow(
  slots: WindowSlots,
  index: number,
  response: ReplayResponse,
): WindowSlots {
  const next = [...slots];
  next[index] = response;
  return next;
}

/** 아직 아무것도 못 받은 total 칸짜리 목록. */
export const emptySlots = (total: number): WindowSlots =>
  Array.from({ length: total }, () => undefined);

/** 앞 창부터 끊김 없이 받은 창 수. 못 받은 창을 만나면 거기서 멈춘다(그 뒤 창을 받았어도 세지 않는다). */
export function loadedPrefix(slots: WindowSlots): number {
  const missing = slots.indexOf(undefined);
  return missing === -1 ? slots.length : missing;
}

/** 앞 prefix 개 창 안에 World 기록이 하나라도 있는지. 없으면 화면에 보일 사람이 없어 더 받아 본다. */
export const hasWorldStates = (slots: WindowSlots, prefix: number) =>
  slots.slice(0, prefix).some((response) => (response?.world_states.length ?? 0) > 0);

/**
 * 재생 기록을 (다시) 만들 때인지. 읽고 합치는 일을 창이 올 때마다 하면 총량이 창 수의 제곱으로 늘어서 묶는다.
 * - 아직 만든 적 없으면: 전부 받았거나, 앞 구간에 World 기록이 있을 때(첫 화면).
 * - 만든 적 있으면: 전부 받았거나, 받은 구간이 지난번 만들 때의 2배 이상이 됐을 때.
 */
export function shouldBuild(input: {
  prefix: number;
  total: number;
  builtPrefix: number;
  firstViewReady: boolean;
}): boolean {
  const { prefix, total, builtPrefix, firstViewReady } = input;
  if (prefix === 0 || prefix === builtPrefix) return false;
  if (prefix === total) return true;
  return builtPrefix === 0 ? firstViewReady : prefix >= builtPrefix * 2;
}

/** 앞 prefix 개 창을 하나로 합친 응답. from 은 작업 처음이고 to 는 받은 구간의 끝이다. */
export function mergePrefix(slots: WindowSlots, prefix: number): ReplayResponse {
  return mergeReplay(slots.slice(0, prefix) as ReplayResponse[]);
}

/**
 * 아직 받지 못한 뒷구간: 앞 prefix 개 창이 끝나는 시각부터 마지막 창의 끝까지. 전부 받았으면 null.
 * 서버 응답의 to 가 아니라 우리가 나눈 창(planWindows)의 경계로 센다.
 */
export function pendingSpan(plan: readonly Span[], prefix: number): Span | null {
  const last = plan[plan.length - 1];
  if (!last || prefix === 0 || prefix >= plan.length) return null;
  return { from: plan[prefix - 1]!.to, to: last.to };
}
