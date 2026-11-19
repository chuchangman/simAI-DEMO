import { Component, type ReactNode } from 'react';

interface ViewerErrorBoundaryProps {
  onError: (error: Error) => void;
  children: ReactNode;
}

interface ViewerErrorBoundaryState {
  failed: boolean;
}

/** 렌더러·장면 예외가 관제 화면 전체를 내리지 않게 뷰어 안에서 멈춘다. 대체 화면은 FE 가 상태를 보고 정한다. */
export class ViewerErrorBoundary extends Component<
  ViewerErrorBoundaryProps,
  ViewerErrorBoundaryState
> {
  state: ViewerErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ViewerErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
