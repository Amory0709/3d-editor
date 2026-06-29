import { useEditor, type TransformMode, type EditorMode, type AxisLock } from '@/store/editor';
import { PRIMITIVE_TYPES, primitiveLabel, COLLIDER_TYPES, colliderLabel, DEFAULT_COLLIDER } from '@/lib/formats';
import { ColliderEditor } from './ColliderEditor';

const MODE_BLURB: Record<EditorMode, { title: string; lines: string[] }> = {
  mesh: {
    title: 'Mesh mode',
    lines: [
      'Upload a .glb / .gltf / .obj or add a primitive below.',
      'W/E/R mode · X/Y/Z lock axis · F refit · Esc deselect · ⌘Z undo.',
    ],
  },
  collision: {
    title: 'Collision mode',
    lines: [
      'Pick a mesh, then pick a collider type and resize its dimensions.',
      'Bodies update live in the physics world (phase 4b).',
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

const AXIS_LABEL: Record<Exclude<AxisLock, null>, string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
};

const AXES: Array<Exclude<AxisLock, null>> = ['x', 'y', 'z'];

/** Format a transform triple as "1.20, 0.00, -0.50" for compact display. */
function fmt3(v: readonly [number, number, number]): string {
  return v.map((n) => n.toFixed(2)).join(', ');
}

export function Sidebar() {
  const mode = useEditor((s) => s.mode);
  const assets = useEditor((s) => s.assets);
  const activeAssetId = useEditor((s) => s.activeAssetId);
  const setActiveAsset = useEditor((s) => s.setActiveAsset);
  const removeAsset = useEditor((s) => s.removeAsset);
  const addPrimitive = useEditor((s) => s.addPrimitive);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const axisLock = useEditor((s) => s.axisLock);
  const setAxisLock = useEditor((s) => s.setAxisLock);
  const resetAssetTransform = useEditor((s) => s.resetAssetTransform);
  const setAssetCollider = useEditor((s) => s.setAssetCollider);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.canUndo());
  const canRedo = useEditor((s) => s.canRedo());
  const blurb = MODE_BLURB[mode];
  const playMode = useEditor((s) => s.playMode);

  const activeAsset = activeAssetId
    ? assets.find((a) => a.id === activeAssetId) ?? null
    : null;

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

      <div className="history-row">
        <button
          className="history-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
        >
          ↶ Undo
        </button>
        <button
          className="history-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
        >
          ↷ Redo
        </button>
      </div>

      <h3 className="section-title">Primitives</h3>
      <div className="primitive-grid">
        {PRIMITIVE_TYPES.map((p) => (
          <button
            key={p}
            className="primitive-btn"
            onClick={() => addPrimitive(p)}
            title={`Add ${primitiveLabel(p)}`}
            // Phase 4d: primitives are read-only during play.
            disabled={playMode}
          >
            {primitiveLabel(p)}
          </button>
        ))}
      </div>

      {/*
        Phase 4a: Transform section is always visible (with a clear
        empty state) so ESC doesn't make the controls vanish mid-flow.
        Phase 4d: in play mode the controls are disabled (the body's
        transform is the source of truth).
      */}
      {(
        <>
          <h3 className="section-title">Transform</h3>
            {activeAsset ? (
              <>
                <div className="transform-row">
                  {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
                    <button
                      key={m}
                      className={`transform-btn${transformMode === m ? ' active' : ''}`}
                      onClick={() => setTransformMode(m)}
                      disabled={playMode}
                    >
                      {TRANSFORM_LABEL[m]}
                    </button>
                  ))}
                </div>
                <div className="axis-lock-row">
                  <span className="axis-lock-label">Lock axis</span>
                  {AXES.map((a) => (
                    <button
                      key={a}
                      className={`axis-btn${axisLock === a ? ' active' : ''}`}
                      onClick={() => setAxisLock(axisLock === a ? null : a)}
                      title={`Toggle ${a.toUpperCase()} axis lock`}
                      disabled={playMode}
                    >
                      {AXIS_LABEL[a]}
                    </button>
                  ))}
                </div>
                <div className="transform-vals">
                  <div className="transform-vals-row">
                    <span className="transform-vals-label">pos</span>
                    <span className="transform-vals-text">{fmt3(activeAsset.transform.position)}</span>
                  </div>
                  <div className="transform-vals-row">
                    <span className="transform-vals-label">rot</span>
                    <span className="transform-vals-text">
                      {fmt3([
                        activeAsset.transform.rotation[0],
                        activeAsset.transform.rotation[1],
                        activeAsset.transform.rotation[2],
                      ])}{' '}
                      <span className="transform-vals-order">
                        {activeAsset.transform.rotation[3]}
                      </span>
                    </span>
                  </div>
                  <div className="transform-vals-row">
                    <span className="transform-vals-label">scl</span>
                    <span className="transform-vals-text">{fmt3(activeAsset.transform.scale)}</span>
                  </div>
                </div>
                <button
                  className="reset-btn"
                  onClick={() => resetAssetTransform(activeAsset.id)}
                  title="Reset transform to identity"
                  disabled={playMode}
                >
                  ⟲ Reset transform
                </button>
              </>
            ) : (
              <p className="empty section-empty">
                Select an asset below — or add a primitive — to enable gizmo controls.
              </p>
            )}
        </>
      )}

      {mode === 'collision' && (
        <>
          <h3 className="section-title">Collider</h3>
          {activeAsset ? (
            <div className="collider-grid">
              <button
                className={`collider-btn${activeAsset.collider === null ? ' active' : ''}`}
                onClick={() => setAssetCollider(activeAsset.id, null)}
                // Phase 4d: changing collider type during play would
                // require rebuilding a dynamic body mid-simulation
                // (not supported by cannon-es). Disable the picker.
                disabled={playMode}
              >
                None
              </button>
              {COLLIDER_TYPES.map((c) => (
                <button
                  key={c}
                  className={`collider-btn${activeAsset.collider?.type === c ? ' active' : ''}`}
                  onClick={() => setAssetCollider(activeAsset.id, DEFAULT_COLLIDER[c])}
                  disabled={playMode}
                >
                  {colliderLabel(c)}
                </button>
              ))}
            </div>
          ) : (
            <p className="empty section-empty">
              Select an asset to assign a collider.
            </p>
          )}
          {/*
            Phase 4c-A: numeric collider editor. Replaces the read-only
            summary with inputs (blur-clamp + blur-commit). Reset to
            defaults is preserved.
            Phase 4d: in play mode, the editor is read-only — same
            reason as the type buttons above (can't mutate a body
            mid-simulation).
          */}
          {activeAsset?.collider && (
            <ColliderEditor
              assetId={activeAsset.id}
              spec={activeAsset.collider}
              readOnly={playMode}
            />
          )}
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
                  {a.collider ? ` · ${a.collider.type}` : ''}
                </div>
              </button>
              <button
                className="asset-remove"
                onClick={() => removeAsset(a.id)}
                title="Remove"
                // Phase 4d: removing during play would yank an asset
                // out from under its body mid-simulation. Stop first.
                disabled={playMode}
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