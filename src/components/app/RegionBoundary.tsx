"use client";
/**
 * Error boundary around each board region (canvas, dock, panels, loom) so one failing part
 * never takes the whole tab — and its unsynced edits — down with it.
 */
import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface RegionBoundaryProps {
  /** Human name of the region, e.g. "Canvas". */
  name: string;
  children: ReactNode;
}

interface RegionBoundaryState {
  error: Error | null;
}

export class RegionBoundary extends Component<RegionBoundaryProps, RegionBoundaryState> {
  state: RegionBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RegionBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[weave] ${this.props.name} failed to render`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="sheet pointer-events-auto m-2 flex max-w-sm items-start gap-2.5 p-3 text-[12.5px]">
        <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{this.props.name} hit a snag</p>
          <p className="mt-0.5 break-words text-ink-2">
            Your edits are safe in this tab’s log. {error.message ? <span className="font-mono text-[11px] text-muted">({error.message})</span> : null}
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="mt-2 rounded-[8px] border border-line-2 px-2 py-1 text-[12px] font-medium text-ink hover:bg-panel-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
