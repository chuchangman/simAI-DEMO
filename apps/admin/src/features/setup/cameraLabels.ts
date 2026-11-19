import { cameraShortLabel } from '@/lib/cameraNames';
export { cameraLabel, cameraNumber, cameraShortLabel } from '@/lib/cameraNames';

/** 서버가 쓴 문장 속 ID도 화면에서 쓰는 번호로 바꾼다. 모르는 cam ID는 번호를 지어내지 않는다. */
export function cameraText(cameraIds: readonly string[], text: string): string {
  const ids = [...new Set(cameraIds)].sort((a, b) => b.length - a.length);
  const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(
    new RegExp(
      `(?<![A-Za-z0-9_])(?:${escaped.length ? escaped.join('|') + '|' : ''}cam_[A-D])(?![A-Za-z0-9_])`,
      'g',
    ),
    (id) => cameraShortLabel(cameraIds, id),
  );
}

/** '카메라 1–카메라 2'. */
export function pairLabel(cameraIds: readonly string[], a: string, b: string): string {
  return `${cameraShortLabel(cameraIds, a)}–${cameraShortLabel(cameraIds, b)}`;
}

/**
 * 보정이 쓰는 옆 카메라 쌍인지(목록 순서가 모서리를 도는 순서라 1–2, 2–3, 3–4, 4–1).
 * 마주 보는 쌍(1–3, 2–4)과 목록에 없는 id 는 아니다.
 */
export function isNeighborPair(cameraIds: readonly string[], a: string, b: string): boolean {
  const i = cameraIds.indexOf(a);
  const j = cameraIds.indexOf(b);
  if (i < 0 || j < 0 || i === j) return false;
  const gap = Math.abs(i - j);
  return gap === 1 || gap === cameraIds.length - 1;
}

/** 옆 카메라 쌍을 카메라 순서대로 모두 돌려준다(1–2, 1–4, 2–3, 3–4). 마주 보는 쌍은 화면에 두지 않는다. */
export function neighborPairs(cameraIds: readonly string[]): { a: string; b: string }[] {
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < cameraIds.length; i++) {
    for (let j = i + 1; j < cameraIds.length; j++) {
      const a = cameraIds[i]!;
      const b = cameraIds[j]!;
      if (isNeighborPair(cameraIds, a, b)) out.push({ a, b });
    }
  }
  return out;
}
