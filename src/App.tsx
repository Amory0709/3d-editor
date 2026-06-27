import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Viewport } from './components/Viewport';

export function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Sidebar />
        <Viewport />
      </div>
    </div>
  );
}