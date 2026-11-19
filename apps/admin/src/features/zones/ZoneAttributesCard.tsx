import { SEVERITY_CHOICES, type Severity } from '@/features/zones/types';
import type { ZoneEditing } from '@/features/zones/useZoneEditing';
import { SEVERITY_LABEL } from '@/features/zones/zoneEditModel';
import { isSeverityChoice, NAME_INPUT_MAX } from '@/features/zones/zoneForm';
import {
  CARD_CLASS,
  FIELD_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_NOTE_CLASS,
  INPUT_CLASS,
  SELECT_CLASS,
} from '@/features/zones/zonePanelStyle';
import { Input } from '@simai/ui/components/input';

/** 이름·심각도(작업 중 레이아웃 구역은 이름만). 보내는 중이면 잠근다. */
export function ZoneAttributesCard({ edit }: { edit: ZoneEditing }) {
  const { form, errors } = edit;
  return (
    <fieldset disabled={edit.busy} className={CARD_CLASS}>
      <label className={FIELD_CLASS}>
        <span className={FIELD_LABEL_CLASS}>이름</span>
        <Input
          aria-label="이름"
          value={form.name}
          maxLength={NAME_INPUT_MAX}
          onChange={(event) => edit.setName(event.target.value)}
          className={INPUT_CLASS}
        />
        {errors.name && (
          <span role="alert" className={FIELD_NOTE_CLASS}>
            {errors.name}
          </span>
        )}
      </label>
      {!edit.layoutBound && <SeverityField edit={edit} />}
      {errors.judgeType && (
        <span role="alert" className={FIELD_NOTE_CLASS}>
          {errors.judgeType}
        </span>
      )}
    </fieldset>
  );
}

/** 심각도 칸. 작업 중 레이아웃 구역은 서버가 정해서 보이지 않는다. */
function SeverityField({ edit }: { edit: ZoneEditing }) {
  const { form, errors } = edit;
  return (
    <label className={FIELD_CLASS}>
      <span className={FIELD_LABEL_CLASS}>심각도</span>
      <select
        aria-label="심각도"
        value={form.severity}
        onChange={(event) => edit.setSeverity(event.target.value as Severity)}
        className={SELECT_CLASS}
      >
        {/* 이미 저장된 주의·안내는 고를 수 없지만, 지금 값이 보이게 비활성 선택지로 둔다. */}
        {!isSeverityChoice(form.severity) && (
          <option value={form.severity} disabled>
            {SEVERITY_LABEL[form.severity]}
          </option>
        )}
        {SEVERITY_CHOICES.map((severity) => (
          <option key={severity} value={severity}>
            {SEVERITY_LABEL[severity]}
          </option>
        ))}
      </select>
      {errors.severity && (
        <span role="alert" className={FIELD_NOTE_CLASS}>
          {errors.severity}
        </span>
      )}
    </label>
  );
}
