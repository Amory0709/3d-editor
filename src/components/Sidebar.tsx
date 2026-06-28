import { useEditor, type TransformMode, type EditorMode } from '@/store/editor';
import { PRIMITIVE_TYPES, primitiveLabel } from '@/lib/formats';

const MODE_BLURB: Record<EditorMode, { title: string; lines: string[] }> = {
  mesh: {
    title: 'Mesh mode',
    lines: [
      'Upload a .glb / .gltf / .obj or add a primitive below.',
      'Phase 3: transform with W/E/R, F to refit, Esc to deselect.',
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

const TRANSFORM_LABEL: Record<TransformMode, string> = {
  translate: 'Translate (W)',
  rotate: 'Rotate (E)',
  scale: 'Scale (R)',
};

export function Sidebar() {
  const mode = useEditor((s) => s.mode);
  const assets = useEditor((s) => s.assets);
  const activeAssetId = useEditor((s) => s.activeAssetId);
  const setActiveAsset = useEditor((s) => s.setActiveAsset);
  const removeAsset = useEditor((s) => s.removeAsset);
  const addPrimitive = useEditor((s) => s.addPrimitive);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const blurb = MODE_BLURB[mode];

  return (
    <aside className="sidebar">
      <h3>{blurb.title}</h3>
      <p className="empty">
        {blurb.lines.map((l, i) => (
          <span key={i} className="blurb-line">
            {l}
          </span>
        ))}
      </p>

      <h3 className="section-title">Primitives</h3>
      <div className="primitive-grid">
        {PRIMITIVE_TYPES.map((p) => (
          <button
            key={p}
            className="primitive-btn"
            onClick={() => addPrimitive(p)}
            title={`Add ${primitiveLabel(p)}`}
          >
            {primitiveLabel(p)}
          </button>
        ))}
      </div>

      {activeAssetId && (
        <>
          <h3 className="section-title">Transform</h3>
          <div className="transform-row">
            {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
              <button
                key={m}
                className={`transform-btn${transformMode === m ? ' active' : ''}`}
                onClick={() => setTransformMode(m)}
              >
                {TRANSFORM_LABEL[m]}
              </button>
            ))}
          </div>
        </>
      )}

      <h3 className="section-title">Assets ({assets.length})</h3>
      {assets.length === 0 ? (
        <p className="empty">No assets loaded yet.</p>
      ) : (
        <div className="asset-list">
          {assets.map((a) => (
            <div
              key={a.id}
              className={`asset-row${a.id === activeAssetId ? ' active' : ''}`}
            >
              <button className="asset-select" onClick={() => setActiveAsset(a.id)}>
                <div className="asset-name">{a.name}</div>
                <div className="asset-meta">
                  {a.format !== 'unknown' ? `${a.format} · ` : ''}
                  {a.source === 'primitive' ? 'primitive' : `${(a.size / 1024).toFixed(1)} KB`}
                </div>
              </button>
              <button
                className="asset-remove"
                onClick={() => removeAsset(a.id)}
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