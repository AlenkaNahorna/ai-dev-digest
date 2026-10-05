"use client";

import React from "react";

export interface ErrorBoundaryProps {
  /** Rendered instead of the children after a render error; `reset` tries the children again. */
  fallback: (reset: () => void, error: Error) => React.ReactNode;
  /** The boundary resets itself when any of these change (e.g. fresh data arrived). */
  resetKeys?: readonly unknown[];
  /** Called once per caught error (logging). */
  onError?: (error: Error) => void;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length !== b.length || a.some((item, i) => !Object.is(item, b[i]));

/**
 * Keeps a render error in one block from taking down the whole page. It only catches errors
 * thrown while rendering (not failed requests, which TanStack Query reports as `isError`).
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.error && changed(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback(this.reset, this.state.error) : this.props.children;
  }
}
