import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Viewport } from './components/Viewport';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useEditor } from './store/editor';

export function App() {
  // Dev-only: expose the editor store on window so smoke tests (and
  // ad-hoc dev poking) can read/write it. Vite strips this in
  // production via `import.meta.env.DEV` checks; the build output
  // excludes the entire useEffect.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;
      // Hardening: capture uncaught errors and unhandled rejections to
      // a global so a crashed dev page can be diagnosed by reading
      // `window.__lastError`. Better than a blank page.
      const errs: unknown[] = ((window as unknown as { __lastError?: unknown[] }).__lastError = []);
      const origHandler = window.onerror;
      window.onerror = (msg, src, line, col, err) => {
        errs.push({ where: 'window.onerror', msg, src, line, col, err });
        if (origHandler) return origHandler.call(window, msg, src, line, col, err);
        return false;
      };
      window.addEventListener('unhandledrejection', (e) => {
        errs.push({ where: 'unhandledrejection', reason: e.reason });
      });
    }
  }, []);
  return (
    // Top-level boundary: any render failure inside Toolbar/Sidebar/Viewport
    // surfaces here instead of blanking the whole page.
    <ErrorBoundary
      fallback={(err) => {
        // Dev-only: stash the error on window so the user can read it
        // from DevTools (no console scraping needed).
        (window as unknown as { __boundaryError?: unknown }).__boundaryError = err;
        return (
          <div className="app-crash">
            <h2>Editor crashed</h2>
            <p>{err.message}</p>
            {import.meta.env.DEV && (
              <>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                  {String(err.stack ?? err)}
                </pre>
                <p>
                  Run <code>console.log(window.__lastError)</code> or
                  copy the above into the chat for debugging.
                </p>
              </>
            )}
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        );
      }}
    >
      <div className="app">
        <Toolbar />
        <div className="main">
          <Sidebar />
          <Viewport />
        </div>
      </div>
    </ErrorBoundary>
  );
}