import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by NoteFlow ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback" role="alert">
          <div className="error-fallback-card">
            <div className="error-fallback-icon" aria-hidden="true">
              <AlertTriangle size={36} />
            </div>
            <h1 className="error-fallback-title">Something went wrong</h1>
            <p className="error-fallback-desc">
              NoteFlow encountered an unexpected error. Your saved notes are safe on disk.
            </p>
            {this.state.error?.message && (
              <pre className="error-fallback-details">{this.state.error.message}</pre>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleReload}
            >
              <RefreshCw size={16} aria-hidden="true" /> Reload NoteFlow
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
