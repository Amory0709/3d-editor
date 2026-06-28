import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Viewport } from './components/Viewport';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
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