import { EditExitButton } from '@/features/monitor/EditExitButton';
import { updateZoneDraft, useZoneEditStore } from '@/store/zoneEdit.store';
import { startZoneEdit, stopZoneEdit, useZoneEditModeStore } from '@/store/zoneEditMode.store';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exitButton = () => screen.getByRole('button', { name: '편집 끝내기' });
const discardButton = () => screen.queryByRole('button', { name: '수정 버리고 끄기' });

/** 저장하지 않은 구역 초안 하나를 만든다. */
const addDraft = () =>
  act(() => updateZoneDraft('z-1', () => ({ patch: { name: '임시 초안' }, box: null })));

beforeEach(() => {
  startZoneEdit();
  render(<EditExitButton />);
});
afterEach(() => {
  cleanup();
  stopZoneEdit();
  useZoneEditStore.getState().clear();
});

describe('EditExitButton', () => {
  it('X 아이콘 버튼 하나로 이름은 편집 끝내기다', () => {
    expect(exitButton().querySelector('svg.lucide-x')).not.toBeNull();
    expect(exitButton().getAttribute('title')).toBeNull();
  });

  it('고치던 초안이 없으면 누르자마자 편집 모드를 끈다', () => {
    fireEvent.click(exitButton());
    expect(useZoneEditModeStore.getState().editing).toBe(false);
    expect(discardButton()).toBeNull();
  });

  it('저장하지 않은 초안이 있으면 끄기 전에 확인한다: 계속 편집이면 그대로, 버리고 끄면 초안을 지운다', async () => {
    addDraft();

    fireEvent.click(exitButton());
    expect(useZoneEditModeStore.getState().editing).toBe(true);
    expect(await screen.findByRole('button', { name: '수정 버리고 끄기' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '계속 편집' }));
    expect(useZoneEditModeStore.getState().editing).toBe(true);
    expect(Object.keys(useZoneEditStore.getState().drafts)).toEqual(['z-1']);

    fireEvent.click(exitButton());
    fireEvent.click(await screen.findByRole('button', { name: '수정 버리고 끄기' }));
    expect(useZoneEditModeStore.getState().editing).toBe(false);
    expect(useZoneEditStore.getState().drafts).toEqual({});
  });

  it('물어보는 중에 한 번 더 누르면 묻는 창이 닫히고 편집은 그대로다', async () => {
    addDraft();
    fireEvent.click(exitButton());
    await screen.findByRole('button', { name: '수정 버리고 끄기' });

    fireEvent.click(exitButton());
    await waitFor(() => expect(discardButton()).toBeNull());
    expect(useZoneEditModeStore.getState().editing).toBe(true);
  });
});
