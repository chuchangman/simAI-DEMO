import { resolvePersonDisplay, type PersonDisplayMap } from '@/features/people/personDisplay';
import type { ViewerLabelCell } from '@/features/viewer3d';

/**
 * 단일 사람 표시 어댑터 결과와 PPE 글에서 3D 이름표 칸 배열(S15P31A101-658 A안)을 조립한다.
 * - 워치 연결: `[{ kind: 'watch', status: 'connected' }, { kind: 'text', text: 이름 }, ...PPE 칸]`
 * - 워치 끊김: `[{ kind: 'watch', status: 'disconnected' }, { kind: 'text', text: 이름 }, ...PPE 칸]`
 * - 워치 없음: `[{ kind: 'text', text: 이름 }, ...PPE 칸]`
 * World ID·기기 ID·'워치' 글자는 넣지 않는다.
 */
export function buildPersonLabelCells(
  displayMap: PersonDisplayMap,
  ppeLabels: Readonly<Record<string, string>> = {},
): Record<string, readonly ViewerLabelCell[]> {
  const allWorldIds = new Set<string>([...Object.keys(displayMap), ...Object.keys(ppeLabels)]);
  const out: Record<string, readonly ViewerLabelCell[]> = {};
  for (const worldId of allWorldIds) {
    const info = resolvePersonDisplay(worldId, displayMap);
    const cells: ViewerLabelCell[] = [];
    if (info.watch.status === 'connected' || info.watch.status === 'disconnected') {
      cells.push({ kind: 'watch', status: info.watch.status });
    }
    cells.push({ kind: 'text', text: info.displayName });
    const ppe = ppeLabels[worldId];
    if (ppe) {
      for (const segment of ppe.split(' · ')) {
        if (segment) cells.push({ kind: 'text', text: segment });
      }
    }
    out[worldId] = cells;
  }
  return out;
}
