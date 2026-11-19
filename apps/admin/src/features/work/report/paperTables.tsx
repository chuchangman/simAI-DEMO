import {
  circledNumber,
  dateTimeInputValue,
  formatDateTime,
  isTbmWritten,
  parseDateTimeInput,
  taskLabelOf,
} from '@/features/work/reportForm';
import {
  REPORT_FORM_LIMITS,
  type ReportCheckRow,
  type ReportForm,
  type ReportLeader,
  type ReportRiskRow,
  type WorkSignature,
  type WorkTask,
} from '@/features/work/types';
import { cn } from '@simai/ui/lib/utils';
import type { KeyboardEvent, ReactNode } from 'react';

// TBM(작업 전 안전대화) 보고서 종이의 표들. 글은 프로토타입(design/work-v3/stages/report.js)과 같다.
// 화면은 종이 토큰(.paper)으로 그리고, 출력할 때는 검은 선·흰 바탕으로 찍는다.
// 시스템이 채울 칸(초안 전)은 줄무늬(STRIPE)로 둔다. 사람이 쓰는 칸은 작업내용 하나뿐이다.
// 표에 onChange 를 주면 종이 위에서 바로 고친다: 고칠 수 있는 칸만 옅게 칠하고, 누르면 그 자리에서 쓴다(리더·참석자는 고치지 않는다).

/** 참석자 줄 수의 최소값(서명이 더 많으면 그만큼 늘린다). */
const MIN_ATTENDEES = 4;

const TABLE = 'mb-3 w-full table-fixed border-collapse';
const CELL =
  'border border-foreground/35 px-2 py-1.5 text-left align-top text-[13px] leading-normal wrap-anywhere whitespace-pre-wrap print:border-black';
const TH = cn(
  CELL,
  'h-8 bg-foreground/[0.07] font-semibold [print-color-adjust:exact] print:bg-neutral-100',
);
const HEAD = cn(TH, 'text-center align-middle');
const NO = cn(CELL, 'text-center align-middle');
const STRIPE =
  'bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--foreground)_10%,transparent)_6px_7px)] [print-color-adjust:exact]';
const MID = 'h-[52px]';
const TALL = 'h-[84px]';

/** 종이 위에서 고치는 칸: 칸 여백까지 덮어 칸 어디를 눌러도 쓰고, 쓰는 동안은 흰 바탕에 윤곽을 둔다. */
export const PAPER_FIELD =
  '-mx-2 -my-1.5 box-border block w-[calc(100%+1rem)] resize-none bg-primary/[0.07] px-2 py-1.5 text-left outline-none [field-sizing:content] transition-colors hover:bg-primary/[0.14] focus:bg-white focus:ring-2 focus:ring-ring focus:ring-inset';
/** 고치는 칸의 최소 높이(칸 높이와 같다). */
export const FIELD_HEIGHT = { line: 'min-h-8', mid: 'min-h-[52px]', tall: 'min-h-[84px]' } as const;
/** 종이 위에서 누르는 네모 칸. */
const CHOICE =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-primary/[0.07] px-1 transition-colors hover:bg-primary/[0.14] focus-visible:outline-2 focus-visible:outline-ring';

type Edit<T> = ((value: T) => void) | undefined;

/** 글 칸. onChange 가 있으면 그 자리에서 고치는 입력 칸이다(single 이면 Enter 로 줄을 바꾸지 않는다). */
function Text({
  value,
  label,
  max,
  height = 'line',
  single = false,
  onChange,
}: {
  value: string;
  label: string;
  max: number;
  height?: keyof typeof FIELD_HEIGHT;
  single?: boolean;
  onChange: Edit<string>;
}) {
  if (!onChange) return value;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (single && event.key === 'Enter') event.preventDefault();
  };
  return (
    <textarea
      aria-label={label}
      rows={1}
      maxLength={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn(PAPER_FIELD, FIELD_HEIGHT[height])}
    />
  );
}

/** 값 칸. 초안 전이면 줄무늬로 둔다. */
const valueCell = (drafted: boolean, ...classes: string[]) =>
  cn(CELL, 'h-8', drafted ? undefined : STRIPE, ...classes);

function Cols({ widths }: { widths: readonly string[] }) {
  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={index} className={width} />
      ))}
    </colgroup>
  );
}

/** 네모 칸. 고른 쪽은 칠한다. */
function Box({ on }: { on: boolean }) {
  return (
    <span
      data-checked={on}
      className={cn(
        'inline-block size-3 border-[1.5px] border-foreground align-middle [print-color-adjust:exact] print:border-black',
        on && 'bg-foreground print:bg-black',
      )}
    />
  );
}

/** 네모 칸 하나. onChange 가 있으면 눌러 고른다. */
function Choice({
  on,
  label,
  onChange,
  children,
}: {
  on: boolean;
  label: string;
  onChange: (() => void) | undefined;
  children?: ReactNode;
}) {
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Box on={on} />
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onChange}
      className={CHOICE}
    >
      <Box on={on} />
      {children}
    </button>
  );
}

/** 예·아니오 두 칸. 아직 고르지 않았으면 둘 다 비어 있다. */
function YesNo({
  value,
  label,
  onChange,
}: {
  value: boolean | null;
  label: string;
  onChange?: Edit<boolean>;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-[18px]">
      <Choice
        on={value === true}
        label={`${label} 예`}
        onChange={onChange && (() => onChange(true))}
      >
        예
      </Choice>
      <Choice
        on={value === false}
        label={`${label} 아니오`}
        onChange={onChange && (() => onChange(false))}
      >
        아니오
      </Choice>
    </span>
  );
}

/** 일시 · 작업일 동일 여부 · 작업명 · 장소 · 작업내용 · 위험성평가 여부. */
export function InfoTable({
  form,
  catalog,
  drafted,
  editable,
  onChange,
  tasksField,
}: {
  form: ReportForm;
  catalog: readonly WorkTask[];
  drafted: boolean;
  /** 고칠 수 있는 종이면 작업내용이 비었을 때 '+ 작업내용 선택' 을 보인다(출력에는 안 나온다). */
  editable: boolean;
  /** 종이 위에서 고친다. */
  onChange?: (form: ReportForm) => void;
  /** 종이 위에서 고칠 때 작업내용 칸에 넣을 고르기. */
  tasksField?: ReactNode;
}) {
  const { info } = form;
  const edit =
    onChange &&
    ((partial: Partial<ReportForm['info']>) =>
      onChange({ ...form, info: { ...info, ...partial } }));
  return (
    <table className={TABLE}>
      <Cols widths={['w-[15%]', 'w-[35%]', 'w-[17%]', 'w-[33%]']} />
      <tbody>
        <tr>
          <th className={TH}>일시</th>
          {/* 일시는 TBM 을 쓴 시각이다. 서버가 빈 양식에 넣은 값은 작업이 생긴 시각이라, 고칠 수 있는 종이에서 아직 쓰지 않았으면 비워 둔다(읽기 전용 종이는 받은 값 그대로, -734) */}
          <td className={CELL}>
            {edit ? (
              <input
                type="datetime-local"
                aria-label="일시"
                value={dateTimeInputValue(info.date_time_ms)}
                onChange={(event) => edit({ date_time_ms: parseDateTimeInput(event.target.value) })}
                className={cn(PAPER_FIELD, FIELD_HEIGHT.line)}
              />
            ) : editable && !isTbmWritten(form) ? (
              ''
            ) : (
              formatDateTime(info.date_time_ms)
            )}
          </td>
          <th className={TH}>작업일 동일 여부</th>
          <td className={CELL}>
            <YesNo
              value={info.same_day}
              label="작업일 동일 여부"
              onChange={edit && ((same_day) => edit({ same_day }))}
            />
          </td>
        </tr>
        <tr>
          <th className={TH}>작업명</th>
          <td className={valueCell(drafted)}>
            <Text
              value={info.task_name}
              label="작업명"
              max={REPORT_FORM_LIMITS.short}
              single
              onChange={edit && ((task_name) => edit({ task_name }))}
            />
          </td>
          <th className={TH}>장소</th>
          <td className={valueCell(drafted)}>
            <Text
              value={info.place}
              label="장소"
              max={REPORT_FORM_LIMITS.place}
              single
              onChange={edit && ((place) => edit({ place }))}
            />
          </td>
        </tr>
        <tr>
          <th className={TH}>작업내용</th>
          <td colSpan={3} className={cn(CELL, TALL)}>
            {tasksField ??
              info.tasks.map((task, index) => (
                <p key={index}>{`• ${taskLabelOf(task, catalog)}`}</p>
              ))}
            {editable && !tasksField && info.tasks.length === 0 && (
              <span className="inline-flex h-[30px] items-center rounded-md border border-dashed border-primary px-3.5 font-semibold text-primary">
                + 작업내용 선택
              </span>
            )}
          </td>
        </tr>
        <tr>
          <th className={TH}>위험성평가 여부</th>
          <td colSpan={3} className={valueCell(drafted)}>
            <YesNo
              value={info.risk_assessed}
              label="위험성평가 여부"
              onChange={edit && ((risk_assessed) => edit({ risk_assessed }))}
            />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** 잠재위험과 대책 ①②③. */
export function RisksTable({
  form,
  drafted,
  onChange,
}: {
  form: ReportForm;
  drafted: boolean;
  onChange?: (form: ReportForm) => void;
}) {
  const edit =
    onChange &&
    ((index: number, partial: Partial<ReportRiskRow>) =>
      onChange({
        ...form,
        risks: form.risks.map((row, i) => (i === index ? { ...row, ...partial } : row)),
      }));
  return (
    <table className={TABLE}>
      <Cols widths={['w-[8%]', 'w-[46%]', 'w-[46%]']} />
      <thead>
        <tr>
          <th className={HEAD} />
          <th className={HEAD}>잠재위험</th>
          <th className={HEAD}>대책</th>
        </tr>
      </thead>
      <tbody>
        {form.risks.map((row, index) => (
          <tr key={index}>
            <th className={cn(NO, MID, 'bg-foreground/[0.07] font-semibold print:bg-neutral-100')}>
              {circledNumber(index)}
            </th>
            <td className={valueCell(drafted, MID)}>
              <Text
                value={row.risk}
                label={`잠재위험 ${circledNumber(index)}`}
                max={REPORT_FORM_LIMITS.text}
                height="mid"
                onChange={edit && ((risk) => edit(index, { risk }))}
              />
            </td>
            <td className={valueCell(drafted, MID)}>
              <Text
                value={row.measure}
                label={`대책 ${circledNumber(index)}`}
                max={REPORT_FORM_LIMITS.text}
                height="mid"
                onChange={edit && ((measure) => edit(index, { measure }))}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 중점위험 · 중점대책 · 리더(소속·직책·성명). 리더는 계정에서 오고 초안이 끝난 뒤에 보인다. */
export function FocusTable({
  form,
  leader,
  drafted,
  onChange,
}: {
  form: ReportForm;
  leader: ReportLeader | null;
  drafted: boolean;
  onChange?: (form: ReportForm) => void;
}) {
  const shown = drafted ? leader : null;
  const edit =
    onChange &&
    ((partial: Partial<ReportRiskRow>) =>
      onChange({ ...form, focus: { ...form.focus, ...partial } }));
  return (
    <table className={TABLE}>
      <Cols widths={['w-[14%]', 'w-[22%]', 'w-[10%]', 'w-[20%]', 'w-[10%]', 'w-[24%]']} />
      <tbody>
        <tr>
          <th className={TH}>중점위험</th>
          <td colSpan={5} className={valueCell(drafted, MID)}>
            <Text
              value={form.focus.risk}
              label="중점위험"
              max={REPORT_FORM_LIMITS.text}
              height="mid"
              onChange={edit && ((risk) => edit({ risk }))}
            />
          </td>
        </tr>
        <tr>
          <th className={TH}>중점대책</th>
          <td colSpan={5} className={valueCell(drafted, MID)}>
            <Text
              value={form.focus.measure}
              label="중점대책"
              max={REPORT_FORM_LIMITS.text}
              height="mid"
              onChange={edit && ((measure) => edit({ measure }))}
            />
          </td>
        </tr>
        <tr>
          <th className={TH}>리더 소속</th>
          <td className={valueCell(drafted)}>{shown?.org}</td>
          <th className={TH}>직책</th>
          <td className={valueCell(drafted)}>{shown?.title}</td>
          <th className={TH}>성명</th>
          <td className={valueCell(drafted)}>{shown?.name}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** 안전조치 확인 5줄(예·아니오·조치 내용). 줄 이름은 서버가 정한 문구다. */
export function ChecksTable({
  form,
  drafted,
  onChange,
}: {
  form: ReportForm;
  drafted: boolean;
  onChange?: (form: ReportForm) => void;
}) {
  const edit =
    onChange &&
    ((index: number, partial: Partial<ReportCheckRow>) =>
      onChange({
        ...form,
        checks: form.checks.map((row, i) => (i === index ? { ...row, ...partial } : row)),
      }));
  return (
    <table className={TABLE}>
      <Cols widths={['w-[46%]', 'w-[8%]', 'w-[8%]', 'w-[38%]']} />
      <thead>
        <tr>
          <th className={HEAD}>안전조치 확인</th>
          <th className={HEAD}>예</th>
          <th className={HEAD}>아니오</th>
          <th className={HEAD}>조치 내용</th>
        </tr>
      </thead>
      <tbody>
        {form.checks.map((row, index) => (
          <tr key={row.code}>
            <td className={cn(CELL, 'h-8')}>{row.label}</td>
            <td className={valueCell(drafted, 'text-center align-middle')}>
              <Choice
                on={row.yes === true}
                label={`${row.label} 예`}
                onChange={edit && (() => edit(index, { yes: true }))}
              />
            </td>
            <td className={valueCell(drafted, 'text-center align-middle')}>
              <Choice
                on={row.yes === false}
                label={`${row.label} 아니오`}
                onChange={edit && (() => edit(index, { yes: false }))}
              />
            </td>
            <td className={valueCell(drafted)}>
              {row.yes === false && (
                <Text
                  value={row.action}
                  label={`${row.label} 조치 내용`}
                  max={REPORT_FORM_LIMITS.text}
                  onChange={edit && ((action) => edit(index, { action }))}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 일일 안전점검 · 종료 미팅. */
export function ReviewTable({
  form,
  drafted,
  onChange,
}: {
  form: ReportForm;
  drafted: boolean;
  onChange?: (form: ReportForm) => void;
}) {
  const edit =
    onChange &&
    ((partial: Partial<ReportForm['review']>) =>
      onChange({ ...form, review: { ...form.review, ...partial } }));
  return (
    <table className={TABLE}>
      <Cols widths={['w-[16%]', 'w-[84%]']} />
      <tbody>
        <tr>
          <th className={TH}>일일 안전점검</th>
          <td className={valueCell(drafted, TALL)}>
            <Text
              value={form.review.daily}
              label="일일 안전점검"
              max={REPORT_FORM_LIMITS.review}
              height="tall"
              onChange={edit && ((daily) => edit({ daily }))}
            />
          </td>
        </tr>
        <tr>
          <th className={TH}>종료 미팅</th>
          <td className={valueCell(drafted, TALL)}>
            <Text
              value={form.review.ending}
              label="종료 미팅"
              max={REPORT_FORM_LIMITS.review}
              height="tall"
              onChange={edit && ((ending) => edit({ ending }))}
            />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** 참석자(번호·이름·서명 이미지). 서명 목록에서 오고, 4줄 아래로는 줄이지 않는다. */
export function AttendeesTable({ signatures }: { signatures: readonly WorkSignature[] }) {
  const rows = Math.max(MIN_ATTENDEES, signatures.length);
  return (
    <table className={TABLE}>
      <Cols widths={['w-[10%]', 'w-[40%]', 'w-[50%]']} />
      <thead>
        <tr>
          <th className={HEAD}>번호</th>
          <th className={HEAD}>참석자</th>
          <th className={HEAD}>서명</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, index) => {
          const signature = signatures[index];
          return (
            <tr key={index}>
              <td className={cn(NO, MID)}>{index + 1}</td>
              <td className={cn(CELL, MID)}>{signature?.signer_name}</td>
              <td className={cn(CELL, MID)}>
                {signature && (
                  <img
                    src={signature.image_url}
                    alt={`${signature.signer_name} 서명`}
                    className="block max-h-11 max-w-full object-contain"
                  />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
