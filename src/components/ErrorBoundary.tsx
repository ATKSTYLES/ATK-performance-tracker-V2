import React from 'react';
import { SecondaryButton } from './ui/Controls';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--canvas)]">
          <div className="max-w-lg w-full p-6 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              Workspace Error Encountered
            </h1>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed break-words font-mono-num">
              {this.state.message || 'An unexpected error occurred.'}
            </p>
            <SecondaryButton
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
              }}
            >
              Recover View
            </SecondaryButton>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
