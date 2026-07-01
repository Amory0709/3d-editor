import { useEffect, useRef } from 'react';
import { useEditor, type EditorMode } from '@/store/editor';
import { handleFiles } from '@/lib/upload';
import { ACCEPT_ATTR } from '@/lib/formats';

const MODES: { id: EditorMode; label: string }[] = [
  { id: 'mesh', label: 'Mesh' },
  { id: 'collision', label: 'Collision' },
  { id: 'gaussian', label: 'Gaussian' },
  { id: 'edit', label: 'Edit' },
  { id: 'combine', label: 'Combine' },
];

export function Toolbar() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const loading = useEditor((s) => s.loading);
  const playMode = useEditor((s) => s.playMode);
  const setPlayMode = useEditor((s) => s.setPlayMode);
  const inputRef = useRef<HTMLInputElement>(null);

  // Phase 4d: P toggles play/stop. The shortcut is bound at the
  // toolbar level (this component is always mounted when the editor
  // is open). We don't bind Esc to stop — that would conflict with
  // the existing Esc-to-deselect-asset behavior.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore if the user is typing in an input (e.g. collider
      // editor fields).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        useEditor.getState().setPlayMode(!useEditor.getState().playMode);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="toolbar">
      <div className="title">3D Asset Editor</div>
      <div className="mode-tabs" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            className={mode === m.id ? 'active' : ''}
            onClick={() => setMode(m.id)}
            aria-selected={mode === m.id}
            // Phase 4d: mode tabs are disabled in play mode. Switching
            // modes mid-play would conflate collision/mesh UI state
            // with the live simulation.
            disabled={playMode}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFiles(e.target.files);
          // reset so the same file can be re-selected
          e.target.value = '';
        }}
      />
      <button
        className="primary"
        disabled={loading || playMode}
        onClick={() => inputRef.current?.click()}
        title={playMode ? 'Stop play to upload' : 'Upload a mesh'}
      >
        {loading ? 'Loading…' : 'Upload asset'}
      </button>
      {/*
        Phase 4d: Play / Stop toggle. The button label and the
        accent color swap based on state. A clear visual cue matters
        because play is a mode that disables most other UI.
      */}
      <button
        className={`play-toggle${playMode ? ' playing' : ''}`}
        onClick={() => setPlayMode(!playMode)}
        title={playMode ? 'Stop (P)' : 'Play (P)'}
        aria-pressed={playMode}
      >
        {playMode ? '⏹ Stop' : '▶ Play'}
      </button>
    </div>
  );
}
