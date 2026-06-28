import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Rendered when an error is caught. Receives the thrown Error. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
  /** Side-effect hook for logging / store updates. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React error boundary. Use anywhere a render failure should not
 * crash the whole app — wrap the <Canvas>, the whole <App>, or a panel.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error);
      }
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}