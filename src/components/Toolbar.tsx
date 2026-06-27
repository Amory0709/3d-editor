import { useRef } from 'react';
import { useEditor, type EditorMode, detectFormat, classifyKind } from '@/store/editor';

const MODES: { id: EditorMode; label: string }[] = [
  { id: 'mesh', label: 'Mesh' },
  { id: 'collision', label: 'Collision' },
  { id: 'gaussian', label: 'Gaussian' },
];

const ACCEPT = '.glb,.gltf,.obj,.splat,.ply,.spz';

export function Toolbar() {
  const { mode, setMode, addAsset, setLoading, setError, loading } = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      for (const file of Array.from(files)) {
        const format = detectFormat(file.name);
        if (format === 'unknown') {
          setError(`Unsupported file type: ${file.name}`);
          continue;
        }
        const url = URL.createObjectURL(file);
        addAsset({
          id: crypto.randomUUID(),
          name: file.name,
          url,
          format,
          kind: classifyKind(format),
          size: file.size,
          loadedAt: Date.now(),
        });
      }
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

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
        onChange={(e) => handleFiles(e.target.files)}
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