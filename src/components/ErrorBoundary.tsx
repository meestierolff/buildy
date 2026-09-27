import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordProductEvent } from "@/lib/betaApi";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render-time errors anywhere below it so a single broken component
 * shows a recoverable fallback instead of unmounting the whole app (white screen).
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
    void recordProductEvent({
      eventName: "error_encountered",
      properties: { schemaVersion: 1, category: "unknown" },
    }).catch(() => undefined);
  }

  private handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="text-center">
          <p className="eyebrow mb-3">Er ging iets mis</p>
          <h1 className="mb-4 font-serif italic text-4xl md:text-5xl">Even niet gelukt.</h1>
          <p className="mb-8 text-sm text-muted-foreground">
            Er trad een onverwachte fout op. Probeer de pagina opnieuw te laden.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="text-[11px] font-bold uppercase tracking-widest underline underline-offset-4 hover:text-accent"
          >
            Pagina opnieuw laden
          </button>
        </div>
      </main>
    );
  }
}

export default ErrorBoundary;
