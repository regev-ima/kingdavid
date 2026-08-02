import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Always log, production included. Gating this on DEV meant a crash in
    // production left NOTHING behind — not in the console, not on screen — so
    // "משהו השתבש" was all anyone could report, and the cause had to be guessed
    // at from a screenshot. The console is where a user can actually read it.
    console.error('ErrorBoundary caught:', error, errorInfo?.componentStack || errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center" dir="rtl">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">משהו השתבש</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            אירעה שגיאה לא צפויה. נסה לרענן את הדף.
          </p>
          {/* The actual message, one click away. Without it a crash report is
              just a screenshot of this screen, which says nothing about what
              broke — and the fix ends up being guesswork. */}
          {this.state.error ? (
            <details className="mb-4 max-w-xl w-full text-right">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                פרטי השגיאה (להעתקה ולשליחה לתמיכה)
              </summary>
              <pre
                dir="ltr"
                className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-snug text-left whitespace-pre-wrap break-words"
              >
                {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
              </pre>
            </details>
          ) : null}
          <Button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            רענן דף
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
