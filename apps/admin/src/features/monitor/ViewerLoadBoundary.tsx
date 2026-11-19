import { Component, type ReactNode } from 'react';

/**
 * 3D 뷰어 코드(three.js 묶음)를 받지 못하는 등 뷰어 밖에서 난 오류를 받는다. 아무것도 그리지 않고 알리기만 한다.
 * 뷰어 안의 렌더 오류는 뷰어가 직접 받아 onStatusChange 로 알린다.
 */
export class ViewerLoadBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
