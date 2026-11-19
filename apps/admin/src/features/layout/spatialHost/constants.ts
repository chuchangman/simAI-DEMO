import type { ViewerLayers } from '@/features/viewer3d';

/**
 * 화면에 들어와 3D 가 이 시간(ms) 안에 첫 화면을 그리지 못하면 2D 평면을 대신 보인다(명세 13.6). 그보다 빨리 준비되면
 * 탭에 들어올 때마다 2D 가 잠깐 비쳤다 사라지지 않게 2D 를 띄우지 않는다. 2D 를 보다가 3D 로 바꿀 때는 기다리지 않는다.
 */
export const PLAN_FALLBACK_MS = 2_000;

/** 3D 에 선택을 다시 적용할 때 장면에 대상이 올라오기를 기다리는 간격(ms). */
export const RESELECT_MS = 200;

/** 3D 에 선택을 다시 적용하는 횟수(약 3초). */
export const RESELECT_TRIES = 15;

/** 선택 키(`<종류>:<ID>`)로 이벤트 패널·2D·3D 가 함께 맞추는 대상 종류. */
export const SELECTABLE_TYPES = ['person', 'zone', 'object'] as const;

/**
 * 구역 편집(관제 편집 모드·이벤트 패널이 없는 틀·세팅의 구역 단계) 3D 레이어. 작업면을 골라 고친다(구역 없는 작업면을 지우려면
 * 골라야 한다). 장애물은 고치는 화면이 없어 어디서도 고르지 않는다. 구역은 적지 않아 늘 고를 수 있다.
 */
export const ZONE_EDIT_LAYERS: ViewerLayers = { workSurfaces: 'interactive', obstacles: 'visible' };

/** 관제 3D 레이어. 작업면은 보이기만 해 사람·구역 선택을 가로막지 않는다. */
export const MONITOR_LAYERS: ViewerLayers = { workSurfaces: 'visible', obstacles: 'visible' };
