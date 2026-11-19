import { useThemeStore } from '@/features/layout/theme.store';
import { useCurrentScene } from '@/features/layout/useCurrentScene';
import { useWorkSurfaces } from '@/features/surfaces/useWorkSurfaces';
import {
  createLayout,
  requestLayoutDetail,
  TBM_LAYOUTS_KEY,
  tbmLayoutDetailKey,
  updateLayout,
} from '@/features/tbm/api';
import {
  ADDABLE_LAYOUT_KINDS,
  applyEditBoxToDraftItem,
  buildLayoutBoxEdit,
  buildLayoutBoxGhosts,
  buildLayoutWriteBody,
  buildPlannedLayoutInput,
  changeDraftItemKind,
  createDraftItem,
  degToYawRad,
  importOpeningFromZone,
  isAddableLayoutKind,
  LAYOUT_ITEM_KIND_LABELS,
  layoutDetailToDraftItems,
  validateLayoutDraft,
  yawRadToDeg,
  type AddableLayoutKind,
  type LayoutDraftItem,
  type LayoutItemKind,
} from '@/features/tbm/layoutEditorModel';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, H2, H3, NOTE, PILL, SECONDARY, SWITCH } from '@/features/tbm/styles';
import type { TbmTask } from '@/features/tbm/tbmDemo';
import { TbmPlan } from '@/features/tbm/TbmPlan';
import {
  layoutObbToItem,
  tbmLayoutSaveErrorText,
  type LayoutDetail,
  type LayoutSummary,
} from '@/features/tbm/types';
import {
  createExternalSource,
  Viewer3D,
  type Viewer3DHandle,
  type ViewerEditBox,
  type ViewerLayers,
  type ViewerTarget,
} from '@/features/viewer3d';
import { useZones } from '@/features/zones/useZones';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { Button } from '@simai/ui/components/button';
import { Input } from '@simai/ui/components/input';
import { Label } from '@simai/ui/components/label';
import { cn } from '@simai/ui/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EDITOR_LAYERS: ViewerLayers = {
  zones: 'visible',
  workSurfaces: 'visible',
  obstacles: 'visible',
};

const FIELD_LABEL = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground';
const NUM_INPUT = 'h-8 rounded-md border-border bg-surface-2 px-2 text-xs text-foreground';
const SELECT_CLS =
  'h-9 rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-foreground outline-none';

function useNarrowScreen(maxWidthPx = 767): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= maxWidthPx : false,
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= maxWidthPx);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxWidthPx]);
  return narrow;
}

export interface TbmLayoutEditorDialogProps {
  task: TbmTask;
  layouts: readonly LayoutSummary[];
  initialLayoutId: number | null;
  onSaved: (saved: LayoutDetail) => void;
  onClose: () => void;
}

export function TbmLayoutEditorDialog({
  task,
  layouts,
  initialLayoutId,
  onSaved,
  onClose,
}: TbmLayoutEditorDialogProps) {
  const queryClient = useQueryClient();
  const theme = useThemeStore((s) => s.theme);
  const { scene } = useCurrentScene();
  const { zones, raw: zonesRaw } = useZones();
  const { surfaces, raw: surfacesRaw } = useWorkSurfaces();
  const isNarrow = useNarrowScreen();

  // 편집기 전용 SpatialSource: 배경 Scene 과 함께 위험 구역(zones)·등록 작업면(workSurfaces)을 그대로 그린다.
  const [editorSource] = useState(() => createExternalSource('tbm-layout-editor'));
  useEffect(() => {
    if (zonesRaw) {
      editorSource.pushZones({ ok: true, raw: zonesRaw });
    }
  }, [editorSource, zonesRaw]);
  useEffect(() => {
    if (surfacesRaw) {
      editorSource.pushWorkSurfaces({ ok: true, raw: surfacesRaw });
    }
  }, [editorSource, surfacesRaw]);

  const viewerRef = useRef<Viewer3DHandle>(null);
  const [topView, setTopView] = useState(false);

  // 선택된 레이아웃 ID (null 이면 '새 레이아웃 만들기')
  const [targetLayoutId, setTargetLayoutId] = useState<number | null>(initialLayoutId);

  const layoutDetailQuery = useQuery({
    queryKey: tbmLayoutDetailKey(targetLayoutId ?? 0),
    queryFn: ({ signal }) => requestLayoutDetail(api, targetLayoutId!, signal),
    enabled: targetLayoutId !== null,
    retry: false,
  });

  const loadedDetail = targetLayoutId !== null ? (layoutDetailQuery.data ?? null) : null;

  const [name, setName] = useState(() =>
    initialLayoutId === null ? `${task.name} 가상 레이아웃` : '',
  );
  const [revision, setRevision] = useState<number | null>(null);
  const [items, setItems] = useState<LayoutDraftItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [placementSurfaceId, setPlacementSurfaceId] = useState<string>('');
  const [importZoneId, setImportZoneId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState(false);

  // 서버에서 상세 레이아웃을 받으면(또는 새 레이아웃으로 바꾸면) 편집 초안을 초기화한다.
  const syncedKeyRef = useRef<string>('');
  useEffect(() => {
    if (targetLayoutId === null) {
      const key = 'new';
      if (syncedKeyRef.current !== key) {
        syncedKeyRef.current = key;
        setName(`${task.name} 가상 레이아웃`);
        setRevision(null);
        setItems([]);
        setSelectedItemId(null);
        setErrorText(null);
        setConflictError(false);
      }
      return;
    }
    if (!loadedDetail || loadedDetail.layout_id !== targetLayoutId) return;
    const key = `${loadedDetail.layout_id}:${loadedDetail.revision}`;
    if (syncedKeyRef.current === key) return;
    syncedKeyRef.current = key;
    const draftItems = layoutDetailToDraftItems(loadedDetail);
    setName(loadedDetail.name);
    setRevision(loadedDetail.revision);
    setItems(draftItems);
    setSelectedItemId(draftItems[0]?.item_id ?? null);
    setErrorText(null);
    setConflictError(false);
  }, [targetLayoutId, loadedDetail, task.name]);

  const selectedItem = useMemo(
    () => items.find((i) => i.item_id === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  const autoReference = Boolean(
    selectedItem?.item_id.startsWith('auto-') && selectedItem.sourceZoneId,
  );
  const missingReference = items.some((item) => {
    if (!item.item_id.startsWith('auto-') || !item.sourceZoneId) return false;
    if (zonesRaw && !zones.some((zone) => zone.zoneId === item.sourceZoneId)) return true;
    return Boolean(
      item.sourceObjectId &&
      surfacesRaw &&
      !surfaces.some(
        (surface) =>
          surface.objectId === item.sourceObjectId && surface.zoneId === item.sourceZoneId,
      ),
    );
  });

  const boxEdit = useMemo(
    () => (autoReference ? null : buildLayoutBoxEdit(selectedItem)),
    [selectedItem, autoReference],
  );
  const boxGhosts = useMemo(
    () => buildLayoutBoxGhosts(items, selectedItemId),
    [items, selectedItemId],
  );
  const plannedLayout = useMemo(
    () => buildPlannedLayoutInput(targetLayoutId, items),
    [targetLayoutId, items],
  );

  // 3D 손잡이(BoxEditGizmo)가 올린 새 상자를 선택된 물체에 반영한다.
  const handleBoxEditChange = useCallback(
    (box: ViewerEditBox) => {
      if (!selectedItemId) return;
      setItems((prev) =>
        prev.map((item) =>
          item.item_id === selectedItemId ? applyEditBoxToDraftItem(item, box) : item,
        ),
      );
    },
    [selectedItemId],
  );

  const handleViewerSelect = useCallback((target: ViewerTarget | null) => {
    if (target?.type === 'planned') {
      setSelectedItemId(target.id);
    }
  }, []);

  const updateSelectedItem = (updater: (item: LayoutDraftItem) => LayoutDraftItem) => {
    if (!selectedItemId) return;
    setErrorText(null);
    setItems((prev) =>
      prev.map((item) => (item.item_id === selectedItemId ? updater(item) : item)),
    );
  };

  const handleAddKind = (kind: AddableLayoutKind) => {
    setErrorText(null);
    const surface = placementSurfaceId
      ? (surfaces.find((s) => s.objectId === placementSurfaceId) ?? null)
      : null;
    const created = createDraftItem(kind, items, { surface });
    setItems((prev) => [...prev, created]);
    setSelectedItemId(created.item_id);
  };

  const handleImportFromZone = (zoneId: string) => {
    if (!zoneId) return;
    const zone = zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;
    setErrorText(null);
    const imported = importOpeningFromZone(zone, items);
    setItems((prev) => [...prev, imported]);
    setSelectedItemId(imported.item_id);
    setImportZoneId('');
  };

  const handleDeleteSelected = () => {
    if (!selectedItemId) return;
    setErrorText(null);
    setItems((prev) => {
      const next = prev.filter((i) => i.item_id !== selectedItemId);
      setSelectedItemId(next[0]?.item_id ?? null);
      return next;
    });
  };

  const handleReloadAfterConflict = async () => {
    if (targetLayoutId === null) return;
    setErrorText(null);
    setConflictError(false);
    try {
      const fresh = await requestLayoutDetail(api, targetLayoutId);
      queryClient.setQueryData(tbmLayoutDetailKey(targetLayoutId), fresh);
      syncedKeyRef.current = `${fresh.layout_id}:${fresh.revision}`;
      const draftItems = layoutDetailToDraftItems(fresh);
      setName(fresh.name);
      setRevision(fresh.revision);
      setItems(draftItems);
      setSelectedItemId(draftItems[0]?.item_id ?? null);
    } catch (err) {
      setErrorText(tbmLayoutSaveErrorText(err));
    }
  };

  const validationProblem = useMemo(() => validateLayoutDraft(name, items), [name, items]);

  const handleSave = async () => {
    setErrorText(null);
    setConflictError(false);
    const problem = validateLayoutDraft(name, items);
    if (problem) {
      setErrorText(problem);
      return;
    }
    const body = buildLayoutWriteBody(name, items, targetLayoutId !== null ? revision : undefined);
    if (!body) return;

    setSaving(true);
    try {
      const saved =
        targetLayoutId === null
          ? await createLayout(api, body)
          : await updateLayout(api, targetLayoutId, body);
      queryClient.setQueryData(tbmLayoutDetailKey(saved.layout_id), saved);
      await queryClient.invalidateQueries({ queryKey: TBM_LAYOUTS_KEY });
      onSaved(saved);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 409 || err.code === 'LAYOUT_REVISION_CONFLICT')
      ) {
        setConflictError(true);
      }
      setErrorText(tbmLayoutSaveErrorText(err));
    } finally {
      setSaving(false);
    }
  };

  // 읽기 전용 미리보기용 임시 TbmTask (휴대폰 좁은 화면용)
  const previewTask = useMemo<TbmTask>(
    () => ({
      ...task,
      items: items.flatMap((i) => {
        if (i.bottomZ === null || i.height === null || i.height <= 0) return [];
        return [
          layoutObbToItem({
            item_id: i.item_id,
            kind: i.kind,
            center: [i.centerXy[0], i.centerXy[1], i.bottomZ + i.height / 2],
            size: [i.sizeXy[0], i.sizeXy[1], i.height],
            yaw_rad: i.yaw_rad,
            label: i.label || i.item_id,
          }),
        ];
      }),
    }),
    [task, items],
  );

  return (
    <ModalDialog
      label="3D 가상 레이아웃 편집"
      onClose={onClose}
      className="h-[90vh] w-[min(1260px,calc(100vw-32px))] overflow-hidden open:flex open:flex-col"
    >
      <header className="flex flex-none flex-wrap items-center gap-2.5 border-b border-border px-5 py-3">
        <h2 className={H2}>{task.id} 3D 가상 레이아웃 편집</h2>
        {revision !== null && (
          <span className={PILL} data-testid="layout-revision-badge">
            rev.{revision}
          </span>
        )}
        <span className="ml-auto" />
        {!isNarrow && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={topView}
              onClick={() => {
                const next = !topView;
                setTopView(next);
                viewerRef.current?.setTopView?.(next);
              }}
              className={cn(SWITCH, topView && 'bg-primary text-primary-foreground')}
            >
              {topView ? '입체 시점으로 보기' : '위에서 보기'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setTopView(false);
                viewerRef.current?.resetView?.();
              }}
              className={SWITCH}
            >
              시점 초기화
            </Button>
          </>
        )}
        <Button type="button" variant="secondary" onClick={onClose} className={SECONDARY}>
          닫기
        </Button>
        {!isNarrow && (
          <Button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className={cn(ACTION, 'font-bold')}
          >
            {saving ? '저장 중…' : '레이아웃 저장 · 작업 연결'}
          </Button>
        )}
      </header>

      {errorText && (
        <div
          role="alert"
          data-testid="layout-editor-error"
          className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-border bg-destructive/15 px-5 py-2 text-[13px] text-destructive"
        >
          <span>{errorText}</span>
          {conflictError && targetLayoutId !== null && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void handleReloadAfterConflict()}
              className="h-7 px-2.5 text-xs font-semibold"
            >
              다시 불러오기
            </Button>
          )}
        </div>
      )}
      {missingReference && (
        <div
          role="alert"
          className="border-b border-border bg-destructive/15 px-5 py-2 text-destructive"
        >
          원본 구역이나 연결된 작업면을 확인할 수 없습니다. 원본을 확인한 뒤 다시 반영해 주세요.
        </div>
      )}

      {isNarrow ? (
        <div
          data-testid="layout-mobile-readonly"
          className="flex min-h-0 flex-1 flex-col gap-3 p-5"
        >
          <div
            role="status"
            className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted-foreground ring-1 ring-border ring-inset"
          >
            PC 에서 편집 — 좁은 화면에서는 읽기 전용 미리보기만 제공합니다.
          </div>
          <div className="relative min-h-0 flex-1 rounded-xl bg-background p-3.5 ring-1 ring-faint ring-inset">
            <TbmPlan task={previewTask} others={[]} spots={[]} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 왼쪽 3D 뷰어(관제 화면과 같은 Scene + 위험 구역 + 등록 작업면 + PLANNED 가상 객체 + 3D 상자 손잡이) */}
          <div
            data-testid="layout-editor-viewport"
            className="relative min-h-0 min-w-0 flex-1 bg-background"
          >
            <Viewer3D
              ref={viewerRef}
              theme={theme}
              initialMode="PLANNED"
              source={editorSource}
              scene={scene}
              layers={EDITOR_LAYERS}
              plannedLayout={plannedLayout}
              boxEdit={boxEdit}
              boxGhosts={boxGhosts}
              onBoxEditChange={handleBoxEditChange}
              onSelectionChange={handleViewerSelect}
              topView={topView}
              className="size-full"
            />
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-card/90 px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-border backdrop-blur-sm">
              선택한 물체를 3D 상자 손잡이(가운데 구: 이동 · 화살표: 면 크기/높이)로 조절하거나
              오른쪽 패널에서 숫자로 다듬으세요.
            </div>
          </div>

          {/* 오른쪽 편집 패널 */}
          <aside
            aria-label="가상 레이아웃 편집 패널"
            className="flex w-[380px] flex-none flex-col gap-3.5 overflow-y-auto border-l border-border bg-card p-4"
          >
            {/* 1. 레이아웃 선택 및 이름 */}
            <section className="flex flex-col gap-2">
              <Label className={FIELD_LABEL}>
                편집할 레이아웃
                <select
                  aria-label="편집할 레이아웃"
                  value={targetLayoutId === null ? 'new' : String(targetLayoutId)}
                  onChange={(e) => {
                    const val = e.target.value;
                    syncedKeyRef.current = '';
                    setTargetLayoutId(val === 'new' ? null : Number(val));
                  }}
                  className={SELECT_CLS}
                >
                  <option value="new">+ 새 가상 레이아웃 만들기</option>
                  {layouts.map((l) => (
                    <option key={l.layout_id} value={String(l.layout_id)}>
                      #{l.layout_id} {l.name} (rev.{l.revision})
                    </option>
                  ))}
                </select>
              </Label>

              <Label className={FIELD_LABEL}>
                레이아웃 이름
                <Input
                  aria-label="레이아웃 이름"
                  value={name}
                  onChange={(e) => {
                    setErrorText(null);
                    setName(e.target.value);
                  }}
                  placeholder="예: 개구부 옆 비계 배치"
                  className="h-9 bg-surface-2 text-xs"
                />
              </Label>
            </section>

            {/* 2. 물체 추가 및 구역에서 가져오기 */}
            <section className="flex flex-col gap-2 border-t border-border pt-3">
              <h3 className={H3}>물체 추가</h3>
              <Label className={FIELD_LABEL}>
                놓을 기준면
                <select
                  aria-label="놓을 기준면"
                  value={placementSurfaceId}
                  onChange={(e) => setPlacementSurfaceId(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="">바닥 (Z = 0m)</option>
                  {surfaces.map((s) => (
                    <option key={s.objectId} value={s.objectId}>
                      작업면 {s.name ?? s.objectId} (윗면 {s.geometry.topHeightM}m)
                    </option>
                  ))}
                </select>
              </Label>

              <div className="grid grid-cols-2 gap-1.5">
                {ADDABLE_LAYOUT_KINDS.map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleAddKind(kind)}
                    className="h-8 text-xs font-semibold"
                  >
                    + {LAYOUT_ITEM_KIND_LABELS[kind]}
                  </Button>
                ))}
              </div>

              <Label className={FIELD_LABEL}>
                구역에서 가져오기 (개구부)
                <select
                  aria-label="구역에서 가져오기"
                  value={importZoneId}
                  onChange={(e) => handleImportFromZone(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="">등록된 위험 구역 선택…</option>
                  {zones.map((z) => (
                    <option key={z.zoneId} value={z.zoneId}>
                      {z.zoneId} · {z.name}
                      {z.zRange ? ` (Z ${z.zRange[0]}~${z.zRange[1]}m)` : ' (높이 미지정)'}
                    </option>
                  ))}
                </select>
              </Label>
            </section>

            {/* 3. 배치된 물체 목록 */}
            <section className="flex flex-col gap-1.5 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <h3 className={H3}>배치 물체 ({items.length})</h3>
              </div>
              {items.length === 0 ? (
                <p className={NOTE}>추가된 가상 물체가 없습니다.</p>
              ) : (
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                  {items.map((item) => {
                    const active = item.item_id === selectedItemId;
                    const zIncomplete = item.bottomZ === null || item.height === null;
                    return (
                      <button
                        key={item.item_id}
                        type="button"
                        onClick={() => setSelectedItemId(item.item_id)}
                        className={cn(
                          'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs ring-1 ring-inset',
                          active
                            ? 'bg-primary/15 font-semibold text-foreground ring-primary'
                            : 'bg-surface-2 text-muted-foreground ring-border',
                        )}
                      >
                        <span className="truncate">
                          [{LAYOUT_ITEM_KIND_LABELS[item.kind]}] {item.label || item.item_id}
                        </span>
                        <span className="ml-2 flex-none font-mono text-[11px]">
                          {zIncomplete
                            ? '높이 입력 필요'
                            : `${item.sizeXy[0]}×${item.sizeXy[1]}×${item.height}m`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 4. 선택 물체 수치 편집 */}
            {selectedItem && autoReference && (
              <p role="status" className={NOTE}>
                이 항목은 구역에서 자동 반영됩니다. 형상을 바꾸려면 원본 구역을 편집하세요.
              </p>
            )}
            {selectedItem && !autoReference && (
              <section
                aria-label="선택 물체 속성"
                className="flex flex-col gap-2.5 border-t border-border pt-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className={H3}>선택 물체 ({selectedItem.item_id})</h3>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteSelected}
                    className="h-7 px-2.5 text-xs"
                  >
                    물체 삭제
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Label className={FIELD_LABEL}>
                    종류
                    <select
                      aria-label="물체 종류"
                      value={selectedItem.kind}
                      disabled={!isAddableLayoutKind(selectedItem.kind)}
                      onChange={(e) =>
                        updateSelectedItem((prev) =>
                          changeDraftItemKind(prev, e.target.value as LayoutItemKind),
                        )
                      }
                      className={SELECT_CLS}
                    >
                      {(isAddableLayoutKind(selectedItem.kind)
                        ? ADDABLE_LAYOUT_KINDS
                        : [selectedItem.kind]
                      ).map((kind) => (
                        <option key={kind} value={kind}>
                          {LAYOUT_ITEM_KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </Label>

                  <Label className={FIELD_LABEL}>
                    이름 (label)
                    <Input
                      aria-label="물체 이름"
                      value={selectedItem.label}
                      onChange={(e) =>
                        updateSelectedItem((prev) => ({ ...prev, label: e.target.value }))
                      }
                      className={NUM_INPUT}
                    />
                  </Label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Label className={FIELD_LABEL}>
                    중심 X (m)
                    <Input
                      aria-label="중심 X"
                      type="number"
                      step="0.1"
                      value={selectedItem.centerXy[0]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          updateSelectedItem((prev) => ({
                            ...prev,
                            centerXy: [v, prev.centerXy[1]],
                          }));
                        }
                      }}
                      className={NUM_INPUT}
                    />
                  </Label>
                  <Label className={FIELD_LABEL}>
                    중심 Y (m)
                    <Input
                      aria-label="중심 Y"
                      type="number"
                      step="0.1"
                      value={selectedItem.centerXy[1]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          updateSelectedItem((prev) => ({
                            ...prev,
                            centerXy: [prev.centerXy[0], v],
                          }));
                        }
                      }}
                      className={NUM_INPUT}
                    />
                  </Label>
                  <Label className={FIELD_LABEL}>
                    바닥 높이 Z (m)
                    <Input
                      aria-label="바닥 높이 Z"
                      type="number"
                      step="0.1"
                      placeholder="필수 입력"
                      value={selectedItem.bottomZ === null ? '' : selectedItem.bottomZ}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') {
                          updateSelectedItem((prev) => ({ ...prev, bottomZ: null }));
                          return;
                        }
                        const v = Number(raw);
                        if (Number.isFinite(v)) {
                          updateSelectedItem((prev) => ({ ...prev, bottomZ: v }));
                        }
                      }}
                      className={NUM_INPUT}
                    />
                  </Label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Label className={FIELD_LABEL}>
                    폭 X (m)
                    <Input
                      aria-label="폭 X"
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={selectedItem.sizeXy[0]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v > 0) {
                          updateSelectedItem((prev) => ({
                            ...prev,
                            sizeXy: [v, prev.sizeXy[1]],
                          }));
                        }
                      }}
                      className={NUM_INPUT}
                    />
                  </Label>
                  <Label className={FIELD_LABEL}>
                    깊이 Y (m)
                    <Input
                      aria-label="깊이 Y"
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={selectedItem.sizeXy[1]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v > 0) {
                          updateSelectedItem((prev) => ({
                            ...prev,
                            sizeXy: [prev.sizeXy[0], v],
                          }));
                        }
                      }}
                      className={NUM_INPUT}
                    />
                  </Label>
                  <Label className={FIELD_LABEL}>
                    높이 Z (m)
                    <Input
                      aria-label="높이 Z"
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="필수 입력"
                      value={selectedItem.height === null ? '' : selectedItem.height}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') {
                          updateSelectedItem((prev) => ({ ...prev, height: null }));
                          return;
                        }
                        const v = Number(raw);
                        if (Number.isFinite(v)) {
                          updateSelectedItem((prev) => ({ ...prev, height: v }));
                        }
                      }}
                      className={NUM_INPUT}
                    />
                  </Label>
                </div>

                <Label className={FIELD_LABEL}>
                  회전 각도 (°)
                  <Input
                    aria-label="회전 각도"
                    type="number"
                    step="5"
                    min="-180"
                    max="180"
                    value={yawRadToDeg(selectedItem.yaw_rad)}
                    onChange={(e) => {
                      const deg = Number(e.target.value);
                      if (Number.isFinite(deg)) {
                        updateSelectedItem((prev) => ({
                          ...prev,
                          yaw_rad: degToYawRad(deg),
                        }));
                      }
                    }}
                    className={NUM_INPUT}
                  />
                </Label>
              </section>
            )}

            {validationProblem && items.length > 0 && (
              <p className="text-xs text-destructive" data-testid="layout-validation-hint">
                {validationProblem}
              </p>
            )}
          </aside>
        </div>
      )}
    </ModalDialog>
  );
}
