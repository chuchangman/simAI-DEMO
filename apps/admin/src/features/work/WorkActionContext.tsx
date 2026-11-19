import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

// 날짜 화면 아래 오른쪽 단추 줄(하단 메뉴와 같은 줄)의 약속. 단계 화면이 자기 단추를 등록하고, 레이어(WorkActionLayer)가 읽어 그린다.
// 단계 화면은 `useWorkAction` 만 쓰고 `useWorkActionState` 는 읽지 않는다(레이어만 읽는다. 그래야 단추가 바뀌어도 단계 화면이 다시 그려지지 않는다).

/** 보조 단추 하나(주 단추 왼쪽에 놓인다). */
export interface WorkActionSecondary {
  label: string;
  onClick: () => void;
  /** 'danger' 는 되돌리기 어려운 동작(삭제 등). 기본은 'default'. */
  kind?: 'default' | 'danger';
  /** true 면 눌리지 않는다(요청 중 등). */
  disabled?: boolean;
}

/** 오른쪽 아래 단추 줄의 모양. 주 단추는 보통 '다음'이고, 작업 종료 단계는 '작업 종료' → '보고서 제출'이다. */
export interface WorkActionConfig {
  /** 주 단추 글자: '다음' · '작업 종료' · '보고서 제출' 등. */
  label: string;
  /** false 면 눌리지 않는다. 이유를 알려 줄 때는 title 을 함께 준다. */
  enabled: boolean;
  onClick: () => void;
  /** 요청 중. 단추가 눌리지 않고 진행 표시를 한다. */
  pending?: boolean;
  /** 단추에 마우스를 올렸을 때 보이는 글(꺼진 이유 등: '작업 날짜에 시작할 수 있어요'). */
  title?: string;
  /** 꺼진 이유를 단추 옆에 늘 보이는 글로 둔다(마우스를 올려야 보이는 title 과 별개, -734: 「종료 미팅 작성 중」 등). 켜져 있으면 주지 않는다. */
  reason?: string;
  /** 주 단추 옆의 보조 단추들. */
  secondary?: readonly WorkActionSecondary[];
}

type Register = (config: WorkActionConfig | null) => void;

const ActionStateContext = createContext<WorkActionConfig | null>(null);
// 등록 함수는 한 번 만든 setState 라 값이 바뀌지 않는다. 단추가 바뀌어도 등록하는 단계 화면은 다시 그려지지 않는다.
const ActionRegisterContext = createContext<Register>(() => undefined);

/** 날짜 화면 하나를 감싼다. 안쪽의 단계 화면이 등록한 단추 줄을 레이어가 읽는다. */
export function WorkActionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<WorkActionConfig | null>(null);
  return (
    <ActionRegisterContext value={setConfig}>
      <ActionStateContext value={config}>{children}</ActionStateContext>
    </ActionRegisterContext>
  );
}

/** 지금 등록된 단추 줄(없으면 null). 레이어(WorkActionLayer)가 읽는다. 단계 화면은 읽지 않는다. */
export function useWorkActionState(): WorkActionConfig | null {
  return useContext(ActionStateContext);
}

/** 단추 줄의 겉모양(글자·켜짐·요청 중·이유·보조 단추). 같으면 사용자가 보는 단추가 같다(누르는 동작은 따로 본다). */
const shapeOf = (config: WorkActionConfig | null): string | null =>
  config &&
  JSON.stringify([
    config.label,
    config.enabled,
    config.pending ?? false,
    config.title ?? '',
    config.reason ?? '',
    (config.secondary ?? []).map((item) => [
      item.label,
      item.kind ?? 'default',
      item.disabled ?? false,
    ]),
  ]);

/** 누르면 그때의 최신 단추(latest)가 알게 하는 고정 껍데기. 겉모양이 같은 동안 이것을 계속 쓴다. */
function delegatingTo(
  latest: RefObject<WorkActionConfig | null>,
  config: WorkActionConfig,
): WorkActionConfig {
  return {
    ...config,
    onClick: () => latest.current?.onClick(),
    secondary: config.secondary?.map((item, index) => ({
      ...item,
      onClick: () => latest.current?.secondary?.[index]?.onClick(),
    })),
  };
}

/**
 * 단계 화면이 자기 단추 줄을 등록한다. 렌더마다 새로 불러도 된다: 겉모양(글자·켜짐·이유 등)이 같으면 다시 등록하지 않아 단추 줄이
 * 다시 그려지지 않고, 누르면 가장 최근에 넘긴 onClick 이 불린다. 단추를 안 보일 때는 null 을 넘기고, 화면이 사라지면(언마운트)
 * 자동으로 해제된다. 단추가 둘 이상의 단계에 걸쳐 이어질 때도 단계 화면이 바뀌는 순간 먼저 해제되고 새 화면이 등록한다.
 */
export function useWorkAction(config: WorkActionConfig | null): void {
  const register = useContext(ActionRegisterContext);
  const latest = useRef(config);
  useLayoutEffect(() => {
    latest.current = config;
  });
  const shape = shapeOf(config);
  useEffect(() => {
    const current = latest.current;
    register(current && delegatingTo(latest, current));
  }, [register, shape]);
  useEffect(() => () => register(null), [register]);
}
