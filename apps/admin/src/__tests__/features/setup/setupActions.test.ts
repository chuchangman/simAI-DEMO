import {
  deriveSetupActions,
  toWorkAction,
  type SetupActionHandlers,
  type SetupActionState,
} from '@/features/setup/setupActions';
import { describe, expect, it, vi } from 'vitest';

const handlers = (): SetupActionHandlers => ({
  start: vi.fn(),
  confirm: vi.fn(),
  restart: vi.fn(),
  cancelSession: vi.fn(),
  recheckCameras: vi.fn(),
  finish: vi.fn(),
});

const stateOf = (overrides: Partial<SetupActionState> = {}): SetupActionState => ({
  stage: 0,
  embedded: false,
  startDisabled: false,
  mapComplete: false,
  sessionRunning: false,
  cancelPending: false,
  showHeightNotice: false,
  canFinish: false,
  finishPending: false,
  setupCompleted: false,
  ...overrides,
});

/** 왼쪽부터 `라벨` 또는 꺼진 단추는 `라벨(꺼짐)`. 주 단추는 `*` 를 붙인다. */
const summary = (state: SetupActionState) =>
  deriveSetupActions(state, handlers()).map(
    (button) => `${button.primary ? '*' : ''}${button.label}${button.disabled ? '(꺼짐)' : ''}`,
  );

describe('deriveSetupActions: 단계별 단추', () => {
  it('1단계 세팅 취소(나가기)는 처리기를 주면 다음 왼쪽 보조 단추로 놓이고 취소 요청 중에는 꺼진다(S15P31A101-689)', () => {
    const on = { ...handlers(), exitSetup: vi.fn() };
    const buttons = deriveSetupActions(stateOf({ stage: 0 }), on);
    expect(buttons.map((b) => b.label)).toEqual(['세팅 취소', '다음']);
    buttons[0]!.onClick();
    expect(on.exitSetup).toHaveBeenCalledTimes(1);
    expect(deriveSetupActions(stateOf({ stage: 0, cancelPending: true }), on)[0]!.disabled).toBe(
      true,
    );
    // 2단계에는 나가기가 아니라 현재 시도 중단만 있다
    expect(
      deriveSetupActions(stateOf({ stage: 1, sessionRunning: true }), on).map((b) => b.label),
    ).toEqual(['현재 시도 중단', '다음']);
  });

  it('1단계는 주 단추 하나(다음)이고 높이가 틀렸거나 요청 중이면 꺼진다', () => {
    expect(summary(stateOf({ stage: 0 }))).toEqual(['*다음']);
    expect(summary(stateOf({ stage: 0, startDisabled: true }))).toEqual(['*다음(꺼짐)']);
  });

  it('2단계는 3D 맵을 다 만들어야 다음이 켜지고, 진행 중 세션은 현재 시도 중단이 먼저 있다', () => {
    expect(summary(stateOf({ stage: 1 }))).toEqual(['*다음(꺼짐)']);
    expect(summary(stateOf({ stage: 1, mapComplete: true }))).toEqual(['*다음']);
    expect(summary(stateOf({ stage: 1, sessionRunning: true }))).toEqual([
      '현재 시도 중단',
      '*다음(꺼짐)',
    ]);
    expect(summary(stateOf({ stage: 1, sessionRunning: true, cancelPending: true }))).toEqual([
      '현재 시도 중단(꺼짐)',
      '*다음(꺼짐)',
    ]);
  });

  it('2단계 다음이 꺼진 이유는 단추 title 로 알리고, 켜지면 title 이 없다', () => {
    const blocked = deriveSetupActions(stateOf({ stage: 1 }), handlers());
    expect(blocked[0]).toMatchObject({
      disabled: true,
      title: '3D 맵을 다 만들면 넘어갈 수 있어요',
    });
    const ready = deriveSetupActions(stateOf({ stage: 1, mapComplete: true }), handlers());
    expect(ready[0]?.title).toBeUndefined();
  });

  it('높이 불일치 안내가 있으면 현재 시도 중단 뒤에 카메라 다시 맞추기가 놓이고 주 단추는 맨 오른쪽이다', () => {
    expect(
      summary(
        stateOf({ stage: 1, sessionRunning: true, showHeightNotice: true, mapComplete: true }),
      ),
    ).toEqual(['현재 시도 중단', '카메라 다시 맞추기', '*다음']);
  });

  it('세션 취소·카메라 다시 맞추기는 2단계에만 있다', () => {
    const extras = { sessionRunning: true, showHeightNotice: true };
    expect(summary(stateOf({ stage: 0, ...extras }))).toEqual(['*다음']);
    expect(summary(stateOf({ stage: 2, ...extras }))).toEqual(['다시 보정', '*작업 관리로(꺼짐)']);
  });
});

describe('deriveSetupActions: 구역 단계', () => {
  it('단독 화면은 구역 단계에서 맨 오른쪽에 작업 관리로가 항상 있고, 세팅을 완료할 수 있어야 켜진다', () => {
    expect(summary(stateOf({ stage: 2 }))).toEqual(['다시 보정', '*작업 관리로(꺼짐)']);
    expect(summary(stateOf({ stage: 2, canFinish: true }))).toEqual(['다시 보정', '*작업 관리로']);
  });

  it('세팅을 완료한 작업은 다시 보정이 없고 마지막 단추만 남는다(하루 1회)', () => {
    expect(summary(stateOf({ stage: 2, setupCompleted: true, canFinish: true }))).toEqual([
      '*작업 관리로',
    ]);
    expect(
      summary(stateOf({ stage: 2, embedded: true, setupCompleted: true, canFinish: true })),
    ).toEqual(['*다음']);
    // 완료 여부는 구역 단계 밖의 단추를 바꾸지 않는다
    expect(summary(stateOf({ stage: 1, mapComplete: true, setupCompleted: true }))).toEqual([
      '*다음',
    ]);
  });

  it('날짜 화면 안은 마지막 단추가 다음이고 세팅을 완료할 수 있어야 켜진다', () => {
    const before = deriveSetupActions(stateOf({ stage: 2, embedded: true }), handlers());
    expect(before.map((button) => button.label)).toEqual(['다시 보정', '다음']);
    expect(before[1]).toMatchObject({ primary: true, disabled: true });

    const after = deriveSetupActions(
      stateOf({ stage: 2, embedded: true, canFinish: true }),
      handlers(),
    );
    expect(after[1]).toMatchObject({ label: '다음', primary: true, disabled: false });
    expect(after[1]?.title).toBeUndefined();
  });

  it('세팅 완료를 요청하는 동안은 마지막 단추가 꺼진다', () => {
    for (const embedded of [false, true]) {
      const buttons = deriveSetupActions(
        stateOf({ stage: 2, embedded, canFinish: true, finishPending: true }),
        handlers(),
      );
      expect(buttons[1]).toMatchObject({ primary: true, disabled: true });
    }
  });

  it('embedded 여부는 구역 단계 밖의 단추를 바꾸지 않는다', () => {
    for (const stage of [0, 1] as const) {
      const state = { stage, mapComplete: true, sessionRunning: true, showHeightNotice: true };
      expect(summary(stateOf({ ...state, embedded: true }))).toEqual(summary(stateOf(state)));
    }
  });

  it('단추마다 알맞은 처리를 부른다', () => {
    const on = handlers();
    const run = (state: SetupActionState, label: string) =>
      deriveSetupActions(state, on)
        .find((button) => button.label === label)
        ?.onClick();

    run(stateOf({ stage: 0 }), '다음');
    expect(on.start).toHaveBeenCalledTimes(1);
    run(stateOf({ stage: 1 }), '다음');
    expect(on.confirm).toHaveBeenCalledTimes(1);
    run(stateOf({ stage: 1, sessionRunning: true }), '현재 시도 중단');
    expect(on.cancelSession).toHaveBeenCalledTimes(1);
    run(stateOf({ stage: 1, showHeightNotice: true }), '카메라 다시 맞추기');
    expect(on.recheckCameras).toHaveBeenCalledTimes(1);
    run(stateOf({ stage: 2 }), '다시 보정');
    expect(on.restart).toHaveBeenCalledTimes(1);
    run(stateOf({ stage: 2, embedded: true, canFinish: true }), '다음');
    run(stateOf({ stage: 2, canFinish: true }), '작업 관리로');
    expect(on.finish).toHaveBeenCalledTimes(2);
  });
});

describe('toWorkAction: 아래 오른쪽 단추 줄 설정', () => {
  it('주 단추는 label·enabled·onClick·title 로, 나머지는 왼쪽 보조 단추로 옮긴다', () => {
    const on = handlers();
    const config = toWorkAction(
      deriveSetupActions(
        stateOf({ stage: 1, sessionRunning: true, showHeightNotice: true, mapComplete: true }),
        on,
      ),
    );
    expect(config).toMatchObject({ label: '다음', enabled: true });
    expect(config?.secondary?.map((item) => item.label)).toEqual([
      '현재 시도 중단',
      '카메라 다시 맞추기',
    ]);
    config?.onClick();
    config?.secondary?.[0]?.onClick();
    expect(on.confirm).toHaveBeenCalledTimes(1);
    expect(on.cancelSession).toHaveBeenCalledTimes(1);
  });

  it('보조 단추의 꺼짐(disabled)도 그대로 넘긴다', () => {
    const config = toWorkAction(
      deriveSetupActions(
        stateOf({
          stage: 1,
          sessionRunning: true,
          cancelPending: true,
          showHeightNotice: true,
          mapComplete: true,
        }),
        handlers(),
      ),
    );
    expect(config?.secondary?.map((item) => [item.label, item.disabled])).toEqual([
      ['현재 시도 중단', true],
      ['카메라 다시 맞추기', false],
    ]);
  });

  it('꺼진 주 단추는 enabled false 와 이유(title)를 그대로 넘긴다', () => {
    const blocked = toWorkAction(deriveSetupActions(stateOf({ stage: 1 }), handlers()));
    expect(blocked).toMatchObject({ label: '다음', enabled: false });
    expect(blocked?.title).toBeTruthy();

    const zoneStage = toWorkAction(
      deriveSetupActions(stateOf({ stage: 2, embedded: true }), handlers()),
    );
    expect(zoneStage).toMatchObject({ label: '다음', enabled: false });
    expect(zoneStage?.secondary?.map((item) => item.label)).toEqual(['다시 보정']);
  });

  it('주 단추가 없으면 null 이다', () => {
    const restartOnly = deriveSetupActions(stateOf({ stage: 2 }), handlers()).filter(
      (button) => !button.primary,
    );
    expect(restartOnly.map((button) => button.label)).toEqual(['다시 보정']);
    expect(toWorkAction(restartOnly)).toBeNull();
    expect(toWorkAction([])).toBeNull();
  });
});

describe('deriveSetupActions: 확인 필요 구역(S15P31A101-629)', () => {
  it('확인 필요 구역이 남으면 마지막 단추가 개수를 붙이고 꺼지며 이유를 title 로 알린다', () => {
    expect(summary(stateOf({ stage: 2, canFinish: true, unconfirmedZones: 3 }))).toEqual([
      '다시 보정',
      '*작업 관리로 · 확인 필요 3개(꺼짐)',
    ]);
    const embedded = deriveSetupActions(
      stateOf({ stage: 2, embedded: true, canFinish: true, unconfirmedZones: 1 }),
      handlers(),
    );
    expect(toWorkAction(embedded)).toMatchObject({
      label: '다음 · 확인 필요 1개',
      enabled: false,
      title: expect.stringContaining('확인') as unknown,
    });
    expect(summary(stateOf({ stage: 2, canFinish: true, unconfirmedZones: 0 }))).toEqual([
      '다시 보정',
      '*작업 관리로',
    ]);
  });
});
