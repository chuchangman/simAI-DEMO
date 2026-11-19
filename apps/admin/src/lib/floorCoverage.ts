// 바닥 감시 범위(S15P31A101-606, 명세 4.4·5.2·13장). 3D 뷰어와 2D 평면이 같이 쓰는 순수 함수라 three.js 를 쓰지 않는다.
//
// 입력은 GET /api/scenes/current 응답의 선택 필드 floor_coverage 다(계약 site_setup#/$defs/floor_coverage 원문, 서버 SceneService).
// 바닥 칸마다 그 자리에 선 사람을 통째로 보는 카메라 수다: '.' 바닥 모름(그리지 않음), '0' 사각, '1' 1대만, '2' 2대 이상.
// 정적 3D 맵(휴대폰 보충 촬영으로 채운 곳 포함)이 보인다고 감시되는 바닥이 아님을 구분하는 Visual 층 표시다.
// 위험 판정·사람 위치에 쓰지 않는다. 가림을 계산하지 않아 실제보다 넓을 수 있다(상한).

/** 그리는 칸 종류. 색은 위험 등급(빨강·주황·노랑)과 겹치지 않게 골랐다(front/CONVENTION.md 「화면」). */
export const COVERAGE_CLASSES = [
  { code: '2', key: 'covered', label: '감시됨(2대 이상)', color: '#4fc98a', opacity: 0.28 },
  { code: '1', key: 'single', label: '1대만', color: '#6886d5', opacity: 0.38 },
  { code: '0', key: 'blind', label: '사각', color: '#b04fd6', opacity: 0.5 },
] as const;

export type CoverageClassKey = (typeof COVERAGE_CLASSES)[number]['key'];

export interface FloorCoverage {
  calibrationVersion: string;
  cellM: number;
  /** 칸 (행 0, 열 0) 의 최소 모서리 World XY(m). 행 0 이 가장 작은 Y, 열 0 이 가장 작은 X. */
  originXy: readonly [number, number];
  cols: number;
  rows: number;
  /** 행 우선 칸 값(길이 cols × rows). */
  cells: string;
}

/** 같은 종류가 이어진 한 행의 칸 묶음(World 축 정렬 사각형, m). */
export interface CoverageRun {
  kind: CoverageClassKey;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MAX_CELLS = 40_000;
const CELLS_RE = /^[.012]+$/;
const KIND_BY_CODE: Readonly<Record<string, CoverageClassKey>> = Object.fromEntries(
  COVERAGE_CLASSES.map((c) => [c.code, c.key]),
);

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2000;

/**
 * Scene 응답 본문에서 floor_coverage 를 읽는다. 없거나 형식이 틀리면 null(표시용이라 Scene 은 거부하지 않는다).
 * 길이(cols × rows)·문자·칸 크기를 계약과 같게 본다.
 */
export function readFloorCoverage(sceneRaw: unknown): FloorCoverage | null {
  const raw = field(sceneRaw, 'floor_coverage');
  if (typeof raw !== 'object' || raw === null) return null;
  const calibrationVersion = field(raw, 'calibration_version');
  const cellM = field(raw, 'cell_m');
  const origin = field(raw, 'origin_xy');
  const cols = field(raw, 'cols');
  const rows = field(raw, 'rows');
  const cells = field(raw, 'cells');
  if (typeof calibrationVersion !== 'string' || calibrationVersion === '') return null;
  if (!finite(cellM) || cellM <= 0 || cellM > 2) return null;
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(finite)) return null;
  if (!count(cols) || !count(rows) || typeof cells !== 'string') return null;
  if (cells.length !== cols * rows || cells.length > MAX_CELLS || !CELLS_RE.test(cells))
    return null;
  const [x0, y0] = origin as [number, number];
  return { calibrationVersion, cellM, originXy: [x0, y0], cols, rows, cells };
}

/** 서버 Scene–보정 정합 판정(scene_compatibility) 중 여기서 쓰는 칸. */
export interface CoverageCompatibility {
  sceneCalibration: string | null;
  /** 판정이 비교한 지금 보정(Tier 0)과 결과. viewer_health.scene.compatibility 를 그대로 옮긴다. */
  liveCalibration: string | null;
  verification: string;
}

/**
 * 지금 감시에 맞는 범위인지. 지금 보정(world_state.calibration_version)을 모르면 맞다고 하지 않는다(모르면 비운다).
 * - 칸을 센 보정 = 지금 보정이면 맞다.
 * - 아니면 칸을 센 보정이 Scene 보정이고, 서버가 그 Scene 과 지금 보정을 VERIFIED(같은 보정 또는 카메라 중심 10 cm·회전 2° 이하,
 *   SceneCompatibility)로 판정했을 때만 맞다. 관제 중 회전 자동 복구(rotfix, 명세 4.4)로 버전만 바뀐 경우다.
 */
export function isCoverageCurrent(
  coverage: FloorCoverage | null,
  liveCalibration: string | null | undefined,
  compatibility?: CoverageCompatibility | null,
): boolean {
  if (coverage === null || !liveCalibration) return false;
  if (coverage.calibrationVersion === liveCalibration) return true;
  return (
    !!compatibility &&
    compatibility.sceneCalibration === coverage.calibrationVersion &&
    compatibility.liveCalibration === liveCalibration &&
    compatibility.verification === 'VERIFIED'
  );
}

/** 행마다 같은 종류가 이어진 칸을 한 사각형으로 묶는다. 바닥 모름('.') 칸은 빠진다. */
export function coverageRuns(coverage: FloorCoverage): CoverageRun[] {
  const { cols, rows, cells, cellM } = coverage;
  const [x0, y0] = coverage.originXy;
  const out: CoverageRun[] = [];
  for (let r = 0; r < rows; r += 1) {
    let c = 0;
    while (c < cols) {
      const code = cells[r * cols + c] ?? '.';
      let end = c + 1;
      while (end < cols && cells[r * cols + end] === code) end += 1;
      const kind = KIND_BY_CODE[code];
      if (kind) {
        out.push({
          kind,
          minX: x0 + c * cellM,
          minY: y0 + r * cellM,
          maxX: x0 + end * cellM,
          maxY: y0 + (r + 1) * cellM,
        });
      }
      c = end;
    }
  }
  return out;
}

/** 종류별 칸 수(범례에 넓이를 보이는 데 쓴다). */
export function coverageCounts(coverage: FloorCoverage): Record<CoverageClassKey, number> {
  const out: Record<CoverageClassKey, number> = { covered: 0, single: 0, blind: 0 };
  for (const ch of coverage.cells) {
    const kind = KIND_BY_CODE[ch];
    if (kind) out[kind] += 1;
  }
  return out;
}

export const coverageClass = (kind: CoverageClassKey) =>
  COVERAGE_CLASSES.find((c) => c.key === kind) ?? COVERAGE_CLASSES[0];
