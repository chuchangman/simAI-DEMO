import { isComposing } from '@/lib/imeKey';
import { useEffect, useRef } from 'react';

/** 이 안에서 누른 Ctrl+Z 는 브라우저의 글자 되돌리기에 맡긴다. */
const NATIVE_UNDO_FIELDS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Ctrl(Mac 은 ⌘)+Z. 한글 자판에서도 되도록 글자(key)가 아니라 자판 위치(code)로 본다. */
const isUndoShortcut = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyZ';

const inNativeUndoField = (event: KeyboardEvent) =>
  event
    .composedPath()
    .some((target) => target instanceof Element && target.closest(NATIVE_UNDO_FIELDS) !== null);

/**
 * 구역 편집 화면에서 Ctrl+Z 를 누르면 undo 를 부른다(방금 고친 것 한 단계 되돌리기). 입력칸 안이거나 한글 조합 중이거나 이미
 * 다른 곳이 처리한 키이거나 enabled 가 아니면 건드리지 않는다. undo 가 되돌렸을 때만 브라우저 기본 동작을 막는다.
 * 버튼·링크에 포커스가 있어도 동작한다.
 */
export function useZoneUndoKey(enabled: boolean, undo: () => boolean) {
  const latest = useRef({ enabled, undo });
  useEffect(() => {
    latest.current = { enabled, undo };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isUndoShortcut(event) || isComposing(event)) return;
      if (inNativeUndoField(event)) return;
      if (latest.current.enabled && latest.current.undo()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
