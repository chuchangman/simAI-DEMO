import { startZoneEdit, stopZoneEdit, useZoneEditModeStore } from '@/store/zoneEditMode.store';
import { beforeEach, describe, expect, it } from 'vitest';

const editing = () => useZoneEditModeStore.getState().editing;

describe('zoneEditMode.store', () => {
  beforeEach(() => useZoneEditModeStore.setState(useZoneEditModeStore.getInitialState(), true));

  it('처음에는 편집 모드가 꺼져 있다', () => {
    expect(editing()).toBe(false);
  });

  it('켜고 끈다. 같은 값을 다시 눌러도 그대로다', () => {
    startZoneEdit();
    startZoneEdit();
    expect(editing()).toBe(true);

    stopZoneEdit();
    stopZoneEdit();
    expect(editing()).toBe(false);
  });
});
