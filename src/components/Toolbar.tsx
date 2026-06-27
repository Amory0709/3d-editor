import { useRef } from 'react';
import { useEditor, type EditorMode } from '@/store/editor';
import { handleFiles } from '@/lib/upload';

const MODES: { id: EditorMode; label: string }[] = [
  { id: 'mesh', label: 'Mesh' },
  { id: 'collision', label: 'Collision' },
  { id: 'gaussian', label: 'Gaussian' },
];

const ACCEPT = '.glb,.gltf,.obj';

export function Toolbar() {
  const { mode, setMode, loading } = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);

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
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        className="primary"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? 'Loading…' : 'Upload asset'}
      </button>
    </div>
  );
}