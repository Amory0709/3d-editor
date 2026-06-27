import { useEditor } from '@/store/editor';

const MODE_BLURB: Record<string, { title: string; lines: string[] }> = {
  mesh: {
    title: 'Mesh mode',
    lines: [
      'Upload a .glb / .gltf / .obj to begin.',
      'Phase 3 will add transform, vertex edit, primitives, merge.',
    ],
  },
  collision: {
    title: 'Collision mode',
    lines: [
      'Upload or pick a mesh first.',
      'Phase 4 will add box / sphere / capsule / cylinder / convex / trimesh colliders.',
    ],
  },
  gaussian: {
    title: 'Gaussian mode',
    lines: [
      'Upload a .splat / .ply / .spz to begin.',
      'Phase 5 will add box-select delete, brush edit, transform, recolor.',
    ],
  },
};

export function Sidebar() {
  const { mode, assets, activeAssetId, setActiveAsset, removeAsset } = useEditor();
  const blurb = MODE_BLURB[mode]!;

  return (
    <aside className="sidebar">
      <h3>{blurb.title}</h3>
      <p className="empty">
        {blurb.lines.map((l, i) => (
          <span key={i} style={{ display: 'block' }}>
            {l}
          </span>
        ))}
      </p>

      <h3 style={{ marginTop: 24 }}>Assets ({assets.length})</h3>
      {assets.length === 0 ? (
        <p className="empty">No assets loaded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {assets.map((a) => (
            <div
              key={a.id}
              style={{
                background: a.id === activeAssetId ? 'var(--panel-2)' : 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <button
                onClick={() => setActiveAsset(a.id)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {a.format} · {(a.size / 1024).toFixed(1)} KB
                </div>
              </button>
              <button
                onClick={() => removeAsset(a.id)}
                style={{ padding: '4px 8px', fontSize: 11 }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}