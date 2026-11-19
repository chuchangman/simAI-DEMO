import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { describe, expect, it } from 'vitest';

describe('사람 이름표 뒤 글(personBadges, -342)', () => {
  it('내용이 같으면 Store 를 바꾸지 않고, 비우면 지운다', () => {
    const store = createViewerStore('LIVE');
    expect(store.getState().personBadges).toEqual({});
    store.getState().setPersonBadges({ 'w-17': '워치 watch-01' });
    const first = store.getState().personBadges;
    store.getState().setPersonBadges({ 'w-17': '워치 watch-01' });
    expect(store.getState().personBadges).toBe(first);
    store.getState().setPersonBadges({ 'w-17': '워치 끊김 watch-01' });
    expect(store.getState().personBadges['w-17']).toBe('워치 끊김 watch-01');
    store.getState().setPersonBadges(undefined);
    expect(store.getState().personBadges).toEqual({});
  });
});
