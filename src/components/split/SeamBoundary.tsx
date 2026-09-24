"use client";
/**
 * Error boundary for regions of the director's desk that host other modules' components
 * (knots, explainer, provenance): a failure there must not take down both tabs.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class SeamBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[weave/split] ${this.props.name} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-[12px] border border-dashed border-line-2 bg-panel-2 px-3 py-3 text-[12px] text-ink-2">
        <p className="font-medium text-ink">{this.props.name} hit a snag.</p>
        <p className="mt-0.5 text-muted">The tabs are fine — only this panel stopped.</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-2 rounded-[8px] border border-line px-2 py-1 text-[12px] font-medium text-ink hover:bg-panel"
        >
          Try again
        </button>
      </div>
    );
  }
}
