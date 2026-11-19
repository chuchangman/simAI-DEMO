import {
  sameCalibratedCameraPoses,
  type CalibratedCameraPose,
} from '@/features/viewer3d/cameras/cameraMarkers';
import { MERGE_CARRY_GRACE_MS } from '@/features/viewer3d/data/identityCarry';
import {
  DEFAULT_LAYERS,
  resolveLayers,
  sameLayers,
  type ResolvedLayers,
} from '@/features/viewer3d/layers';
import type { ViewerTheme } from '@/features/viewer3d/palette';
import { isViewerMode, parseTarget, sameTarget, targetKey } from '@/features/viewer3d/target';
import type {
  CommandResult,
  PersonHelmetState,
  ViewerError,
  ViewerLabelCell,
  ViewerMode,
  ViewerPhase,
  ViewerSelectCancelReason,
  ViewerSelectOptions,
  ViewerSelectRequest,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d/types';
import type { FloorCoverage } from '@/lib/floorCoverage';
import { createStore, type StoreApi } from 'zustand/vanilla';

const NO_BADGES: Readonly<Record<string, string>> = Object.freeze({});
const NO_HELMETS: Readonly<Record<string, PersonHelmetState>> = Object.freeze({});
const NO_CAMERA_POSES: readonly CalibratedCameraPose[] = Object.freeze([]);

function sameBadges(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function sameLabelCell(a: ViewerLabelCell, b: ViewerLabelCell): boolean {
  if (a.kind === 'watch' && b.kind === 'watch') return a.status === b.status;
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text;
  return false;
}

function sameLabelCells(
  a: readonly ViewerLabelCell[] | undefined,
  b: readonly ViewerLabelCell[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameLabelCell(a[i]!, b[i]!)) return false;
  }
  return true;
}

function mergePersonLabels(
  prev: Readonly<Record<string, readonly ViewerLabelCell[]>> | null,
  next: Readonly<Record<string, readonly ViewerLabelCell[]>> | undefined,
): Readonly<Record<string, readonly ViewerLabelCell[]>> | null {
  if (next === undefined) return null;
  if (prev !== null) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    if (
      prevKeys.length === nextKeys.length &&
      nextKeys.every((k) => sameLabelCells(prev[k], next[k]))
    ) {
      return prev;
    }
    const merged: Record<string, readonly ViewerLabelCell[]> = {};
    for (const k of nextKeys) {
      merged[k] = prev[k] && sameLabelCells(prev[k], next[k]) ? prev[k]! : next[k]!;
    }
    return merged;
  }
  return { ...next };
}

export interface FocusRequest {
  target: ViewerTarget;
}

/** 카메라 시점 보기 요청(-590). 요청마다 새 객체라 같은 카메라를 다시 눌러도 다시 맞춘다. */
export interface CameraViewRequest {
  cameraId: string;
}

/** 카메라 시점에서 VDT 를 끈 이유(-590). LOW_FPS: 평균 프레임이 기준 아래로 떨어졌다. */
export type CameraVdtBlock = 'LOW_FPS';

/** 기다리는 선택의 최대 시간(ms). 이보다 길게 주면 이 값으로 자른다. */
export const MAX_SELECT_WAIT_MS = 30_000;

interface PendingSelect {
  target: ViewerTarget;
  focus: boolean;
}

/** 장면에서 빠진 선택·초점 사람. 그 ID 를 별칭으로 든 생존 트랙이 곧 오면 옮긴다(-661). */
interface CarryPending {
  id: string;
  selected: boolean;
  focused: boolean;
}

export interface ViewerState {
  phase: ViewerPhase;
  error: ViewerError | null;
  mode: ViewerMode;
  selected: ViewerTarget | null;
  /** 요청마다 새 객체라 같은 대상을 다시 요청해도 카메라가 다시 맞춘다. */
  focus: FocusRequest | null;
  /** 3D 더블클릭(활성화) 요청. 요청마다 새 객체로 알린다. */
  activated: FocusRequest | null;
  /** 장면에 올라온 선택 가능 대상의 키별 등록 수. 같은 키가 잠시 겹쳐도 하나가 빠질 때 지우지 않는다. */
  targets: ReadonlyMap<string, number>;
  /** 장면 색표(화면 테마와 같다). */
  theme: ViewerTheme;
  /** 처음 시점으로 돌아가기 요청 수. 늘 때마다 카메라를 처음 자리로 옮긴다. */
  viewResets: number;
  /** 위에서 내려다보는 시점('위에서 보기') 여부. */
  topView: boolean;
  /** 카메라 시점 보기 요청(-590). CameraRig 가 받아 그 카메라 자리로 옮긴다. */
  cameraViewRequest: CameraViewRequest | null;
  /** 카메라 시점에서 나가기(클릭 전 시점으로 돌아가기) 요청 수(-590). */
  cameraViewExits: number;
  /** 옮기는 중이거나 맞아 있는 카메라(-590). 그 카메라 마커는 시야를 가리지 않게 숨긴다. CameraRig 만 쓴다. */
  cameraViewId: string | null;
  /** 시점이 맞아 있는 카메라(-590). 이 동안만 VDT 를 켠다. CameraRig 만 쓴다. */
  alignedCamera: string | null;
  /** 이번 카메라 시점에서 VDT 를 끈 이유(-590). 새 카메라 시점 요청이 오면 지운다. */
  cameraVdtBlocked: CameraVdtBlock | null;
  /** 레이어별 표시·피킹(-234). 기본값은 모두 interactive(기존 동작). */
  layers: ResolvedLayers;
  /** 사람 이름표 칸 목록(World ID → 칸 배열, -658 A안). null 이면 레거시 personBadges 경로를 쓴다. */
  personLabels: Readonly<Record<string, readonly ViewerLabelCell[]>> | null;
  /** 레거시 사람 이름표 뒤에 붙일 글(World ID → 글, -342). */
  personBadges: Readonly<Record<string, string>>;
  /** 사람 강조 큰 이름표 글(World ID → 글, -509). */
  personHighlights: Readonly<Record<string, string>>;
  /** 사람별 안전모 상태(World ID → 상태, -531). */
  personHelmets: Readonly<Record<string, PersonHelmetState>>;
  /** 사람별 조끼 상태(World ID → 상태, -552). */
  personVests: Readonly<Record<string, PersonHelmetState>>;
  /** 보정된 카메라 마커 자세·시야각 목록(-522). */
  cameraPoses: readonly CalibratedCameraPose[];
  /** 바닥 감시 범위 겹침(-606). 호스트가 지금 보정에 맞는 것만 넘긴다. 없으면 그리지 않는다. */
  floorCoverage: FloorCoverage | null;
  /** 기다리는 선택 요청(-234). 하나뿐이다. */
  pendingSelect: PendingSelect | null;
  /** 기다리는 선택의 마지막 진행. 바뀔 때마다 새 객체라 구독자가 알린다. */
  selectRequest: ViewerSelectRequest | null;

  registerTarget(target: ViewerTarget): void;
  unregisterTarget(target: ViewerTarget): void;
  select(input: unknown): CommandResult;
  /** select 에 기다리기·초점을 더한 명령(-234). options 가 없으면 select 와 같다. */
  requestSelect(input: unknown, options?: ViewerSelectOptions): CommandResult;
  activate(input: unknown): CommandResult;
  clearSelection(): CommandResult;
  focusOn(input: unknown): CommandResult;
  setMode(input: unknown): CommandResult;
  setLayers(input: unknown): void;
  /** 내용이 같으면 바꾸지 않는다. undefined 면 레거시 이름표 모드로 돌아간다. */
  setPersonLabels(input: Readonly<Record<string, readonly ViewerLabelCell[]>> | undefined): void;
  /** 내용이 같으면 바꾸지 않는다. 비우면 모두 지운다. */
  setPersonBadges(input: Readonly<Record<string, string>> | undefined): void;
  setPersonHighlights(input: Readonly<Record<string, string>> | undefined): void;
  setPersonHelmets(input: Readonly<Record<string, PersonHelmetState>> | undefined): void;
  setPersonVests(input: Readonly<Record<string, PersonHelmetState>> | undefined): void;
  setCameraPoses(input: readonly CalibratedCameraPose[] | undefined): void;
  /** 같은 객체면 바꾸지 않는다. 없으면 겹침을 지운다. */
  setFloorCoverage(input: FloorCoverage | null | undefined): void;
  /**
   * 병합으로 흡수된 사람 ID → 지금 그 사람의 World ID(-661, identityCarry.aliasOwners). 데이터 Store 의 World 를 받는
   * 곳(ViewerShell) 하나가 넘긴다. 선택·초점 대상이 빠질 때 이 표로 생존 트랙을 찾는다. 상태가 아니라 다시 그리지 않는다.
   */
  setPersonAliases(owners: ReadonlyMap<string, string>): void;
  markReady(): void;
  markError(error: ViewerError): void;
  /** 뷰어가 내려갈 때 기다리던 선택을 UNMOUNTED 로 끝내고 타이머를 푼다. */
  dispose(): void;
  setTheme(theme: ViewerTheme): void;
  resetView(): CommandResult;
  setTopView(enabled: boolean): CommandResult;
  /** 카메라 시점 보기(-590). 준비 전이면 NOT_READY, 마커에 없는 카메라면 NOT_FOUND. */
  viewFromCamera(cameraId: unknown): CommandResult;
  /** 카메라 시점에서 나간다(-590). 카메라 시점이 아니어도 ok 이고 아무것도 하지 않는다. */
  exitCameraView(): CommandResult;
  setCameraViewId(cameraId: string | null): void;
  setAlignedCamera(cameraId: string | null): void;
  blockCameraVdt(reason: CameraVdtBlock): void;
}

export type ViewerStore = StoreApi<ViewerState>;

const OK: CommandResult = { ok: true };

export function toStatus(state: ViewerState): ViewerStatus {
  return { phase: state.phase, mode: state.mode, error: state.error };
}

/** 뷰어 인스턴스마다 하나 만든다. 30 FPS World 상태는 여기에 두지 않는다. */
export function createViewerStore(initialMode: ViewerMode = 'LIVE'): ViewerStore {
  return createStore<ViewerState>()((set, get) => {
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const stopTimer = () => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = null;
    };
    /** 기다리던 선택을 끝낸다. 상태 하나로 알린다. */
    const settle = (
      status: 'APPLIED' | 'EXPIRED' | 'CANCELLED',
      reason?: ViewerSelectCancelReason,
      patch: Partial<ViewerState> = {},
    ) => {
      const pending = get().pendingSelect;
      if (!pending) return;
      stopTimer();
      set({
        ...patch,
        pendingSelect: null,
        selectRequest: {
          target: pending.target,
          status,
          focus: pending.focus,
          ...(reason ? { reason } : {}),
        },
      });
    };
    /** 기다리던 대상이 지금 고를 수 있으면 고른다. */
    const applyNow = () => {
      const pending = get().pendingSelect;
      if (!pending || get().phase !== 'ready') return;
      if (!get().targets.has(targetKey(pending.target))) return;
      settle('APPLIED', undefined, {
        selected: pending.target,
        ...(pending.focus ? { focus: { target: pending.target } } : {}),
      });
    };
    // 등록 직후가 아니라 이번 반영이 끝난 뒤에 고른다. 새로 보인 레이어는 React StrictMode 에서 등록→해제→등록을
    // 한 번에 거치는데, 그 사이에 고르면 해제가 선택을 풀어 버린다. 끝난 뒤에도 등록돼 있을 때만 고른다.
    let applyQueued = false;
    const tryApply = () => {
      if (applyQueued || !get().pendingSelect) return;
      applyQueued = true;
      queueMicrotask(() => {
        applyQueued = false;
        applyNow();
      });
    };

    // ID 병합 승계(-661). 선택·초점 사람이 빠질 때 그 ID 가 생존 트랙의 별칭이면 그 사람으로 옮긴다.
    let aliasOwner: ReadonlyMap<string, string> = new Map();
    let carry: CarryPending | null = null;
    let carryTimer: ReturnType<typeof setTimeout> | null = null;
    const dropCarry = () => {
      if (carryTimer !== null) clearTimeout(carryTimer);
      carryTimer = null;
      carry = null;
    };
    /** 흡수된 ID 의 생존 트랙이 장면에 있으면 그 대상. */
    const survivorOf = (id: string): ViewerTarget | null => {
      const owner = aliasOwner.get(id);
      if (owner === undefined) return null;
      const target: ViewerTarget = { type: 'person', id: owner };
      return get().targets.has(targetKey(target)) ? target : null;
    };
    /** 기다리던 승계를 이룬다. 그사이 다른 대상을 골랐으면 덮지 않는다. */
    const tryCarry = () => {
      if (!carry) return;
      const target = survivorOf(carry.id);
      if (!target) return;
      const patch: Partial<ViewerState> = {};
      if (carry.selected && get().selected === null) patch.selected = target;
      if (carry.focused && get().focus === null) patch.focus = { target };
      dropCarry();
      if (patch.selected || patch.focus) set(patch);
    };

    // 명령 대상이 지금 장면에 있는지 확인한다.
    const resolve = (input: unknown): { target: ViewerTarget } | CommandResult => {
      const target = parseTarget(input);
      if (!target) return { ok: false, reason: 'INVALID_TARGET' };
      if (get().phase !== 'ready') return { ok: false, reason: 'NOT_READY' };
      if (!get().targets.has(targetKey(target))) return { ok: false, reason: 'NOT_FOUND' };
      return { target };
    };

    return {
      phase: 'initializing',
      error: null,
      mode: isViewerMode(initialMode) ? initialMode : 'LIVE',
      selected: null,
      focus: null,
      activated: null,
      targets: new Map(),
      layers: DEFAULT_LAYERS,
      personLabels: null,
      personBadges: NO_BADGES,
      personHighlights: NO_BADGES,
      personHelmets: NO_HELMETS,
      personVests: NO_HELMETS,
      cameraPoses: NO_CAMERA_POSES,
      floorCoverage: null,
      pendingSelect: null,
      selectRequest: null,
      theme: 'dark',
      viewResets: 0,
      topView: false,
      cameraViewRequest: null,
      cameraViewExits: 0,
      cameraViewId: null,
      alignedCamera: null,
      cameraVdtBlocked: null,

      registerTarget: (target) => {
        const key = targetKey(target);
        const targets = new Map(get().targets);
        targets.set(key, (targets.get(key) ?? 0) + 1);
        set({ targets });
        tryApply();
        tryCarry();
      },

      unregisterTarget: (target) => {
        const key = targetKey(target);
        const count = get().targets.get(key);
        if (count === undefined) return;
        const targets = new Map(get().targets);
        if (count > 1) {
          targets.set(key, count - 1);
          set({ targets });
          return;
        }
        targets.delete(key);
        // 장면에서 사라진 대상을 선택·초점으로 남겨 두지 않는다. 병합으로 흡수된 사람이면 생존 트랙으로 옮긴다(-661).
        const { selected, focus } = get();
        const wasSelected = sameTarget(selected, target);
        const wasFocused = focus !== null && sameTarget(focus.target, target);
        if (target.type !== 'person' || (!wasSelected && !wasFocused)) {
          set({
            targets,
            selected: wasSelected ? null : selected,
            focus: wasFocused ? null : focus,
          });
          return;
        }
        dropCarry();
        const survivor = survivorOf(target.id);
        if (survivor) {
          set({
            targets,
            selected: wasSelected ? survivor : selected,
            focus: wasFocused ? { target: survivor } : focus,
          });
          return;
        }
        // 별칭이 아직 안 왔다(같은 프레임의 처리 순서, 직후 프레임). 비워 두고 잠깐 기다린다.
        set({ targets, selected: wasSelected ? null : selected, focus: wasFocused ? null : focus });
        carry = { id: target.id, selected: wasSelected, focused: wasFocused };
        carryTimer = setTimeout(dropCarry, MERGE_CARRY_GRACE_MS);
      },

      select: (input) => {
        const resolved = resolve(input);
        if (!('target' in resolved)) return resolved;
        dropCarry();
        // 3D 클릭·다른 선택이 기다리던 요청보다 나중이다. 같은 대상이면 그 요청이 이뤄진 것이다.
        if (get().pendingSelect) {
          if (sameTarget(get().pendingSelect!.target, resolved.target)) settle('APPLIED');
          else settle('CANCELLED', 'SELECTION_CHANGED');
        }
        if (!sameTarget(get().selected, resolved.target)) set({ selected: resolved.target });
        return OK;
      },

      requestSelect: (input, options) => {
        const waitMs = Math.min(Math.max(Number(options?.waitMs) || 0, 0), MAX_SELECT_WAIT_MS);
        const focus = options?.focus === true;
        const target = parseTarget(input);
        if (!target) return { ok: false, reason: 'INVALID_TARGET' };
        dropCarry();
        // 새 요청이 오면 기다리던 요청은 바뀐 것이다.
        settle('CANCELLED', 'REPLACED');
        const resolved = resolve(target);
        if ('target' in resolved) {
          const result = get().select(target);
          if (result.ok && focus) set({ focus: { target } });
          return result;
        }
        // 기다릴 수 있는 이유는 아직 준비 중이거나 아직 장면에 없을 때뿐이다(오류 상태는 기다리지 않는다).
        const reason = resolved.ok ? null : resolved.reason;
        const waitable =
          waitMs > 0 &&
          get().phase !== 'error' &&
          (reason === 'NOT_READY' || reason === 'NOT_FOUND');
        if (!waitable) return resolved;
        set({
          pendingSelect: { target, focus },
          selectRequest: { target, status: 'PENDING', focus },
        });
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          settle('EXPIRED');
        }, waitMs);
        return { ok: true, pending: true };
      },

      activate: (input) => {
        const resolved = resolve(input);
        if (!('target' in resolved)) return resolved;
        dropCarry();
        set({
          selected: resolved.target,
          activated: { target: resolved.target },
        });
        return OK;
      },

      clearSelection: () => {
        dropCarry();
        settle('CANCELLED', 'SELECTION_CHANGED');
        if (get().selected !== null) set({ selected: null });
        return OK;
      },

      focusOn: (input) => {
        const resolved = resolve(input);
        if (!('target' in resolved)) return resolved;
        dropCarry();
        set({ focus: { target: resolved.target } });
        return OK;
      },

      setMode: (input) => {
        if (!isViewerMode(input)) return { ok: false, reason: 'INVALID_MODE' };
        if (get().mode !== input) set({ mode: input });
        return OK;
      },

      setLayers: (input) => {
        const layers = resolveLayers(input);
        if (!sameLayers(layers, get().layers)) set({ layers });
      },

      setPersonLabels: (input) => {
        const merged = mergePersonLabels(get().personLabels, input);
        if (merged !== get().personLabels) set({ personLabels: merged });
      },

      setPersonBadges: (input) => {
        const next = input ?? NO_BADGES;
        if (!sameBadges(next, get().personBadges)) set({ personBadges: next });
      },

      setPersonHighlights: (input) => {
        const next = input ?? NO_BADGES;
        if (!sameBadges(next, get().personHighlights)) set({ personHighlights: next });
      },

      setPersonHelmets: (input) => {
        const next = input ?? NO_HELMETS;
        if (!sameBadges(next, get().personHelmets)) set({ personHelmets: next });
      },

      setPersonVests: (input) => {
        const next = input ?? NO_HELMETS;
        if (!sameBadges(next, get().personVests)) set({ personVests: next });
      },

      setCameraPoses: (input) => {
        const next = input && input.length > 0 ? input : NO_CAMERA_POSES;
        if (!sameCalibratedCameraPoses(next, get().cameraPoses)) set({ cameraPoses: next });
      },

      setFloorCoverage: (input) => {
        const next = input ?? null;
        if (next !== get().floorCoverage) set({ floorCoverage: next });
      },

      setPersonAliases: (owners) => {
        aliasOwner = owners;
        tryCarry();
      },

      markReady: () => {
        if (get().phase !== 'ready') set({ phase: 'ready', error: null });
        tryApply();
      },

      markError: (error) => {
        settle('CANCELLED', 'NOT_READY');
        set({ phase: 'error', error });
      },

      dispose: () => {
        dropCarry();
        settle('CANCELLED', 'UNMOUNTED');
      },

      setTheme: (theme) => {
        if (get().theme !== theme) set({ theme });
      },

      resetView: () => {
        if (get().phase !== 'ready') return { ok: false, reason: 'NOT_READY' };
        set({ viewResets: get().viewResets + 1, topView: false });
        return OK;
      },

      setTopView: (enabled) => {
        const next = Boolean(enabled);
        if (get().topView !== next) set({ topView: next });
        return OK;
      },

      viewFromCamera: (cameraId) => {
        if (typeof cameraId !== 'string' || cameraId.length === 0) {
          return { ok: false, reason: 'INVALID_TARGET' };
        }
        if (get().phase !== 'ready') return { ok: false, reason: 'NOT_READY' };
        if (!get().cameraPoses.some((pose) => pose.cameraId === cameraId)) {
          return { ok: false, reason: 'NOT_FOUND' };
        }
        set({ cameraViewRequest: { cameraId }, cameraVdtBlocked: null });
        return OK;
      },

      exitCameraView: () => {
        set({ cameraViewExits: get().cameraViewExits + 1 });
        return OK;
      },

      setCameraViewId: (cameraId) => {
        if (get().cameraViewId !== cameraId) set({ cameraViewId: cameraId });
      },

      setAlignedCamera: (cameraId) => {
        if (get().alignedCamera !== cameraId) set({ alignedCamera: cameraId });
      },

      blockCameraVdt: (reason) => {
        if (get().cameraVdtBlocked !== reason) set({ cameraVdtBlocked: reason });
      },
    };
  });
}
