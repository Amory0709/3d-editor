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
    }
  }, []);
  return (
    // Top-level boundary: any render failure inside Toolbar/Sidebar/Viewport
    // surfaces here instead of blanking the whole page.
    <ErrorBoundary
      fallback={(err) => (
        <div className="app-crash">
          <h2>Editor crashed</h2>
          <p>{err.message}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
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