import { commitErrorText, CommitInFlightError } from '@/features/zones/commitErrors';
import type { Zone } from '@/features/zones/types';
import { useCommitNotice } from '@/features/zones/useCommitNotice';
import { publishErrorText, usePublishBundle } from '@/features/zones/useConfigApply';
import { useExclusiveRun } from '@/features/zones/useExclusiveRun';
import { useLayoutZoneCommit } from '@/features/zones/useLayoutZoneCommit';
import { useZoneCommitMutation, type CommitDone } from '@/features/zones/useZoneCommitMutation';
import { renameRequestOf } from '@/features/zones/zoneCommit';
import { takenZoneNames } from '@/features/zones/zoneEditModel';
import { nameError } from '@/features/zones/zoneForm';
import { dropZoneDraftName } from '@/store/zoneEdit.store';

/**
 * 구역 목록에서 이름만 바꿔 저장한다(구역 UPDATE 한 번 + 구성 묶음 발행, useZoneCommitMutation 이 보낸다). 한 번에 하나만
 * 보낸다. 이름을 저장하면 그 구역 초안의 이름 고침은 새 기준이 되어 버린다. 못 저장하면 서버에 아무것도 저장되지 않은 것이라
 * 입력을 그대로 둘 수 있게 알림만 남긴다. 저장은 됐는데 묶음을 보내지 못했으면 알림과 다시 보내기를 띄운다. zones 를 주면
 * 다른 활성 구역과 같은 이름으로 바꾸지 못하게 한다.
 */
export function useZoneRename(zones: readonly Zone[] = []) {
  const commit = useZoneCommitMutation();
  const commitLayout = useLayoutZoneCommit();
  const publish = usePublishBundle();
  const { busy, run } = useExclusiveRun();
  const { notice, publishFailed, show, publishAndShow, clearNotice } = useCommitNotice();

  /** 이름을 저장한다. 입력을 닫아도 되면(저장했거나 바뀐 것이 없으면) true, 못 저장했으면 false. */
  const rename = async (zone: Zone, name: string): Promise<boolean> => {
    if (name.trim() === zone.name.trim()) return true;
    const invalid = nameError(name, zone.name, takenZoneNames(zones, zone.zoneId));
    if (invalid) {
      show(invalid, false);
      return false;
    }
    if (zone.layoutId != null && zone.layoutItemId) {
      try {
        await run(() =>
          commitLayout(zone.layoutId!, (items) => {
            if (!items.some((item) => item.item_id === zone.layoutItemId))
              throw new Error('Layout item missing');
            return {
              items: items.map((item) =>
                item.item_id === zone.layoutItemId ? { ...item, label: name.trim() } : item,
              ),
            };
          }),
        );
        dropZoneDraftName(zone.zoneId);
        show(null, false);
        return true;
      } catch (error) {
        show(commitErrorText(error), false);
        return false;
      }
    }
    let done: CommitDone | undefined;
    try {
      done = await run(() =>
        commit.mutateAsync({ request: renameRequestOf(zone, name), zone, linked: null }),
      );
    } catch (error) {
      // 다른 곳의 저장이 아직 끝나지 않아 보내지 않았다. 입력은 열어 둔다.
      if (!(error instanceof CommitInFlightError)) show(commitErrorText(error), false);
      return false;
    }
    if (!done) return false;
    const { publishError } = done;
    show(publishError ? publishErrorText(publishError) : null, publishError !== null);
    dropZoneDraftName(zone.zoneId);
    return true;
  };

  // 저장은 했지만 묶음을 만들지 못한 구성을 다시 보낸다.
  const republish = () => run(() => publishAndShow(publish.mutateAsync));

  return {
    busy,
    notice,
    showRetry: !busy && publishFailed,
    clearNotice,
    rename,
    republish,
  };
}
