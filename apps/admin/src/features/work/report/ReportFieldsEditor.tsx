import { H3 } from '@/features/tbm/styles';
import { circledNumber, type ReportFieldEdits } from '@/features/work/reportForm';
import { REPORT_FORM_LIMITS, type ReportCheckRow, type ReportRiskRow } from '@/features/work/types';
import { Input } from '@simai/ui/components/input';
import { Textarea } from '@simai/ui/components/textarea';
import { useId, type ReactNode } from 'react';

// 초안 뒤 편집 창의 칸들: 정보 · 잠재위험과 대책 · 중점위험과 대책 · 안전조치 확인 · 일일 안전점검 · 종료 미팅.
// 리더(소속·직책·성명)는 계정에서 오는 값이라 고치지 않는다. 작업내용 고르기는 부르는 쪽이 `tasks` 로 끼운다.

const LABEL = 'flex min-w-0 flex-col gap-1.5 text-[13px] text-muted-foreground';
const AREA = 'min-h-[52px]';
const PAIR = 'grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={LABEL}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className={H3}>{title}</h3>
      {children}
    </section>
  );
}

/** 예·아니오 고르기. 한 번 고르면 다시 비울 수 없다(프로토타입과 같다). */
function YesNoRadios({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-4">
      {(
        [
          ['예', true],
          ['아니오', false],
        ] as const
      ).map(([text, choice]) => (
        <label
          key={text}
          className="inline-flex cursor-pointer items-center gap-1.5 text-foreground"
        >
          <input
            type="radio"
            name={name}
            checked={value === choice}
            onChange={() => onChange(choice)}
            className="size-4 accent-primary"
          />
          {text}
        </label>
      ))}
    </div>
  );
}

function RadioLine({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-[34px] flex-wrap items-center gap-3.5">
      <span className="min-w-28 text-[13px] text-muted-foreground">{label}</span>
      <YesNoRadios label={label} value={value} onChange={onChange} />
    </div>
  );
}

export function ReportFieldsEditor({
  fields,
  onChange,
  tasks,
}: {
  fields: ReportFieldEdits;
  onChange: (fields: ReportFieldEdits) => void;
  /** 정보 칸 안에 끼울 작업내용 고르기. */
  tasks: ReactNode;
}) {
  const patch = (partial: Partial<ReportFieldEdits>) => onChange({ ...fields, ...partial });
  const patchRisk = (index: number, partial: Partial<ReportRiskRow>) =>
    patch({ risks: fields.risks.map((row, i) => (i === index ? { ...row, ...partial } : row)) });
  const patchCheck = (index: number, partial: Partial<ReportCheckRow>) =>
    patch({ checks: fields.checks.map((row, i) => (i === index ? { ...row, ...partial } : row)) });
  const limits = REPORT_FORM_LIMITS;

  return (
    <div className="flex min-w-0 flex-col gap-[22px]">
      <Section title="정보">
        <div className={PAIR}>
          <Field label="일시">
            <Input
              type="datetime-local"
              value={fields.dateTime}
              onChange={(event) => patch({ dateTime: event.target.value })}
            />
          </Field>
          <Field label="장소">
            <Input
              type="text"
              maxLength={limits.place}
              value={fields.place}
              onChange={(event) => patch({ place: event.target.value })}
            />
          </Field>
        </div>
        <RadioLine
          label="작업일 동일 여부"
          value={fields.sameDay}
          onChange={(sameDay) => patch({ sameDay })}
        />
        <Field label="작업명">
          <Input
            type="text"
            maxLength={limits.short}
            value={fields.taskName}
            onChange={(event) => patch({ taskName: event.target.value })}
          />
        </Field>
        <div className={LABEL}>
          <span>작업내용</span>
          {tasks}
        </div>
        <RadioLine
          label="위험성평가 여부"
          value={fields.riskAssessed}
          onChange={(riskAssessed) => patch({ riskAssessed })}
        />
      </Section>

      <Section title="잠재위험과 대책">
        {fields.risks.map((row, index) => (
          <div key={index} className={PAIR}>
            <Field label={`잠재위험 ${circledNumber(index)}`}>
              <Textarea
                maxLength={limits.text}
                value={row.risk}
                onChange={(event) => patchRisk(index, { risk: event.target.value })}
                className={AREA}
              />
            </Field>
            <Field label={`대책 ${circledNumber(index)}`}>
              <Textarea
                maxLength={limits.text}
                value={row.measure}
                onChange={(event) => patchRisk(index, { measure: event.target.value })}
                className={AREA}
              />
            </Field>
          </div>
        ))}
      </Section>

      <Section title="중점위험과 대책">
        <Field label="중점위험">
          <Textarea
            maxLength={limits.text}
            value={fields.focus.risk}
            onChange={(event) => patch({ focus: { ...fields.focus, risk: event.target.value } })}
            className={AREA}
          />
        </Field>
        <Field label="중점대책">
          <Textarea
            maxLength={limits.text}
            value={fields.focus.measure}
            onChange={(event) => patch({ focus: { ...fields.focus, measure: event.target.value } })}
            className={AREA}
          />
        </Field>
      </Section>

      <Section title="안전조치 확인">
        {fields.checks.map((row, index) => (
          <div
            key={row.code}
            className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="font-semibold text-foreground">{row.label}</span>
              <YesNoRadios
                label={row.label}
                value={row.yes}
                onChange={(yes) => patchCheck(index, { yes })}
              />
            </div>
            {row.yes === false && (
              <Field label="조치 내용">
                <Input
                  type="text"
                  maxLength={limits.text}
                  value={row.action}
                  onChange={(event) => patchCheck(index, { action: event.target.value })}
                />
              </Field>
            )}
          </div>
        ))}
      </Section>

      <Section title="일일 안전점검 · 종료 미팅">
        <Field label="일일 안전점검">
          <Textarea
            maxLength={limits.review}
            value={fields.review.daily}
            onChange={(event) => patch({ review: { ...fields.review, daily: event.target.value } })}
            className="min-h-20"
          />
        </Field>
        <Field label="종료 미팅">
          <Textarea
            maxLength={limits.review}
            value={fields.review.ending}
            onChange={(event) =>
              patch({ review: { ...fields.review, ending: event.target.value } })
            }
            className="min-h-20"
          />
        </Field>
      </Section>
    </div>
  );
}
