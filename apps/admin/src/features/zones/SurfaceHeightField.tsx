import {
  FIELD_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_NOTE_CLASS,
  NUMBER_INPUT_CLASS,
} from '@/features/zones/zonePanelStyle';
import { Input } from '@simai/ui/components/input';
import { useEffect, useRef, useState } from 'react';

/** 입력을 멈추면 이 시간(ms) 뒤, 또는 Enter·포커스를 잃을 때 반영한다. */
const COMMIT_DELAY_MS = 220;
/** 양의 소수만 받는다(부호·지수 없음). */
const HEIGHT_PATTERN = /^\d+(\.\d+)?$/;
/** 보이는 높이를 맞추는 배율(0.001 m)과 소수 자릿수. */
const HEIGHT_ROUND_SCALE = 1000;
const HEIGHT_DIGITS = 2;

/** 높이(m) 글자: 소수 둘째 자리까지. 작업면 카드가 같은 모양으로 보인다. */
export const formatMeters = (value: number) =>
  (Math.round(value * HEIGHT_ROUND_SCALE) / HEIGHT_ROUND_SCALE).toFixed(HEIGHT_DIGITS);

/**
 * 길이(m) 숫자 칸. 기본은 작업면 상판 높이 칸이고, label·ariaLabel 을 주면 구역 크기 칸(가로·세로·높이)으로도 쓴다.
 * 3D 손잡이로 값이 바뀌면 입력 중이 아닐 때 그 값을 보인다.
 */
export function SurfaceHeightField({
  value,
  bad,
  disabled,
  onCommit,
  label = '높이 (m)',
  ariaLabel = '높이(m)',
  badText = '높이는 0보다 커야 합니다.',
}: {
  value: number;
  bad: boolean;
  disabled: boolean;
  onCommit: (value: number) => void;
  label?: string;
  ariaLabel?: string;
  badText?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (text: string) => {
    clearTimeout(timer.current);
    if (HEIGHT_PATTERN.test(text.trim())) onCommit(Number(text));
  };

  return (
    <label className={FIELD_CLASS}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <Input
        aria-label={ariaLabel}
        inputMode="decimal"
        aria-invalid={bad || undefined}
        disabled={disabled}
        value={raw ?? formatMeters(value)}
        onFocus={() => setRaw(formatMeters(value))}
        onChange={(e) => {
          const text = e.target.value;
          setRaw(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(text), COMMIT_DELAY_MS);
        }}
        onBlur={() => {
          if (raw !== null) commit(raw);
          setRaw(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit(e.currentTarget.value);
        }}
        className={NUMBER_INPUT_CLASS}
      />
      {bad && (
        <span role="alert" className={FIELD_NOTE_CLASS}>
          {badText}
        </span>
      )}
    </label>
  );
}
