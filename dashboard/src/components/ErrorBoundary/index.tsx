import { Button, Result } from 'antd';
import React from 'react';

type ErrorBoundaryState = {
  readonly hasError: boolean;
};

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <Result
        status="error"
        title="页面加载失败"
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            刷新
          </Button>
        }
      />
    );
  }
}
