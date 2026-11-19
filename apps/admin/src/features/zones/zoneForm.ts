import type { ViewerEditBox } from '@/features/viewer3d';
import {
  SEVERITY_CHOICES,
  type JudgeType,
  type Severity,
  type Zone,
  type ZoneBody,
} from '@/features/zones/types';
import { SEVERITY_LABEL } from '@/features/zones/zoneEditModel';
import { boxToPolygon } from '@/features/zones/zones';

/**
 * 구역 속성 입력값(명세 FR-15). 유효 시작·종료는 서버에 칸이 없어(valid_from·valid_to 는 버전 시각) 아직 받지 않는다.
 * 요구 조건(requirements)은 확장이라 입력하지 않는다.
 */
export interface ZoneForm {
  name: string;
  judgeType: JudgeType;
  /** 서버 zone_kind. 비울 수 없다. */
  zoneType: string;
  severity: Severity;
}

/** 구역 이름 최대 글자 수(화면 제한). */
export const NAME_MAX = 40;

/** 이름 입력 칸은 검사 한도보다 이만큼 더 받는다(넘으면 검사 문구가 알려 준다). */
const NAME_INPUT_SLACK = 10;
export const NAME_INPUT_MAX = NAME_MAX + NAME_INPUT_SLACK;

/** 계약 설명에 있는 유형 예. */
export const ZONE_TYPE_LABEL: Record<string, string> = {
  OPENING: '개구부',
  EQUIPMENT_PARKING: '장비 주차',
  LIFTING: '양중 하부',
};

export function formOf(zone: Zone): ZoneForm {
  return {
    name: zone.name,
    judgeType: zone.judgeType,
    zoneType: zone.zoneType,
    severity: zone.severity,
  };
}

/** 구역에 고를 수 있는 심각도인지. 이미 저장된 주의·안내 구역은 아니다. */
export const isSeverityChoice = (severity: Severity) =>
  SEVERITY_CHOICES.some((choice) => choice === severity);

const SEVERITY_CHOICE_ERROR = `${SEVERITY_CHOICES.map((choice) => SEVERITY_LABEL[choice]).join('·')} 중에서 고르세요.`;

export interface ZoneFormErrors {
  name?: string;
  judgeType?: string;
  zoneType?: string;
  severity?: string;
}

/** 다른 활성 구역과 이름이 같을 때 문구. */
export const DUPLICATE_NAME_ERROR = '같은 이름의 구역이 있습니다.';

/**
 * 이름 검사 문구. 저장해도 되면 undefined. savedName 은 받은 구역의 이름, taken 은 다른 활성 구역들의 이름(앞뒤 공백을 뗀
 * 것)이다. 길이·겹침은 서버에 없는 화면 제한이라 새로 고친 이름에만 둔다(받은 이름이 다른 칸 저장을 막지 않는다).
 */
export function nameError(
  name: string,
  savedName: string,
  taken?: ReadonlySet<string>,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return '이름을 입력하세요.';
  if (trimmed === savedName.trim()) return undefined;
  if (trimmed.length > NAME_MAX) return `이름은 ${NAME_MAX}자까지입니다.`;
  if (taken?.has(trimmed)) return DUPLICATE_NAME_ERROR;
  return undefined;
}

/** saved 는 받은 구역의 값, hasHeight 는 높이(z_min_m·z_max_m)가 있는지, taken 은 다른 활성 구역들의 이름이다. */
export function formErrors(
  form: ZoneForm,
  { saved, hasHeight, taken }: { saved: ZoneForm; hasHeight: boolean; taken?: ReadonlySet<string> },
): ZoneFormErrors {
  const errors: ZoneFormErrors = {};
  const name = nameError(form.name, saved.name, taken);
  if (name) errors.name = name;
  // 서버(INVALID_Z_RANGE)·계약: VOLUME_3D 는 높이가 있어야 한다.
  if (form.judgeType === 'VOLUME_3D' && !hasHeight)
    errors.judgeType = '높이가 없는 구역은 입체로 판정할 수 없습니다.';
  // 이미 저장된 주의·안내 구역은 위험이나 경고로 다시 골라야 저장할 수 있다.
  if (!isSeverityChoice(form.severity)) errors.severity = SEVERITY_CHOICE_ERROR;
  return errors;
}

/** 구역 몸체의 모양 칸: 바닥 다각형(World x·y)과 최저·최고 높이. */
export type ZoneShape = Pick<ZoneBody, 'polygon_xy' | 'z_min_m' | 'z_max_m'>;

/** 고친 상자의 바닥 직사각형과 높이. */
export const shapeOfBox = (box: ViewerEditBox): ZoneShape => ({
  polygon_xy: boxToPolygon(box),
  z_min_m: box.min[2],
  z_max_m: box.max[2],
});

/** 받은 구역의 다각형과 높이. 상자를 고치지 않았을 때 그대로 보낸다. */
const shapeOfZone = (zone: Zone): ZoneShape => ({
  polygon_xy: zone.polygon.map(([x, y]) => [x, y] as [number, number]),
  z_min_m: zone.zBounds[0],
  z_max_m: zone.zBounds[1],
});

/**
 * 새 버전 본문. 서버는 기록을 통째로 바꾸므로 화면에서 고치지 않는 칸(has_guardrail·requirements)도 받은 값을 그대로 보낸다.
 * 새 모양(shape)을 정했으면 그 다각형과 높이를, 아니면 받은 다각형·높이를 그대로 보낸다(속성만 고쳐도 직사각형이 아닌
 * 다각형을 상자로 덮지 않고, 한쪽만 있는 높이도 지우지 않는다). 이름을 고치지 않았으면 받은 이름을 그대로 보낸다.
 */
export function bodyOf(zone: Zone, form: ZoneForm, shape: ZoneShape | null): ZoneBody {
  return {
    name: form.name === zone.name ? zone.name : form.name.trim(),
    zone_kind: form.zoneType,
    eval_type: form.judgeType,
    ...(shape ?? shapeOfZone(zone)),
    severity: form.severity,
    has_guardrail: zone.hasGuardrail,
    requirements: zone.requirements && { ...zone.requirements },
  };
}

/** 새 구역 양식 검사. 이름·판정 유형은 저장과 같은 규칙이고, 유형은 골라야 한다. 상자는 숫자 칸이 미리 걸러 늘 높이가 있다. */
export function newZoneErrors(form: ZoneForm, taken?: ReadonlySet<string>): ZoneFormErrors {
  const errors = formErrors(form, { saved: { ...form, name: '' }, hasHeight: true, taken });
  if (form.zoneType === '') errors.zoneType = '유형을 고르세요.';
  return errors;
}

/** 새 구역(v1) 본문. */
export function newZoneBodyOf(form: ZoneForm, shape: ZoneShape): ZoneBody {
  return {
    name: form.name.trim(),
    zone_kind: form.zoneType,
    eval_type: form.judgeType,
    ...shape,
    severity: form.severity,
    has_guardrail: null,
    requirements: null,
  };
}
