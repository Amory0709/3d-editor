import { useEditor, type TransformMode, type EditorMode, type AxisLock } from '@/store/editor';
import { PRIMITIVE_TYPES, primitiveLabel, COLLIDER_TYPES, colliderLabel, DEFAULT_COLLIDER } from '@/lib/formats';
import { ColliderEditor } from './ColliderEditor';
import { fillHolesOnAsset, resetVertexEdits, makeFaceOnAsset, booleanOnAssets } from '@/lib/meshOps';

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
  edit: {
    title: 'Edit mode',
    lines: [
      'Vertex-level editing — click a vertex to grab, drag to move.',
      'Use the toolbar below: Reset / Fill holes / Make face / Combine.',
    ],
  },
  combine: {
    title: 'Combine mode',
    lines: [
      'Boolean CSG — union / subtract / intersect two selected assets.',
      'Select two assets, then pick an operation. The result lands on the first asset.',
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

  // Phase 4e: collision log read-out. The store keeps the newest
  // entries at the end of the array; we render the most recent
  // entries first so the user sees fresh events at the top.
  const collisionEvents = useEditor((s) => s.collisionEvents);
  const playClock = useEditor((s) => s.playClock);
  // Read these UNCONDITIONALLY at the top — they are referenced from
  // inside conditional JSX blocks (edit-mode toolbar / combine-mode
  // pickers). If we called useEditor((s) => s.X) inside those
  // conditional branches, React would see a different hook count per
  // render depending on `mode` / `activeAsset` and throw #310
  // (Rendered more hooks than during the previous render).
  const selectedVertexCount = useEditor((s) => s.selectedVertices.length);
  const combineTargetId = useEditor((s) => s.combineTargetId);
  // Cap the visible list at 10 — the store keeps up to 100 but the
  // sidebar only shows the most recent. Keeps the panel from
  // scrolling the user's view off when a busy play session fires
  // dozens of contacts.
  const visibleEvents = collisionEvents.slice(-10).reverse();
  /** Look up a human-readable name for an asset, falling back to
   *  "(deleted)" if the asset was removed after the event fired
   *  (e.g. user removed it after stopping play). */
  function nameForAsset(id: string): string {
    return assets.find((a) => a.id === id)?.name ?? '(deleted)';
  }
  /** Format an elapsed time as "X.Xs ago" / "Xms ago" / "X.Xm ago".
   *  PlayClock freezes on stop (we don't keep ticking in edit mode),
   *  so post-stop labels show "time since the event happened in
   *  the most recent play". */
  function formatElapsed(seconds: number): string {
    // Anything within 50ms of "just happened" rounds to "just now",
    // so an event that fires the same frame as the render reads as
    // "just now" instead of "0ms ago".
    if (seconds <= 0.05) return 'just now';
    if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms ago`;
    if (seconds < 60) return `${seconds.toFixed(1)}s ago`;
    return `${(seconds / 60).toFixed(1)}m ago`;
  }

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
          disabled={!canUndo || playMode}
          title="Undo (⌘Z)"
        >
          ↶ Undo
        </button>
        <button
          className="history-btn"
          onClick={redo}
          disabled={!canRedo || playMode}
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
        Edit mode: the translate/rotate/scale gizmo would fight the
        vertex-drag handles (same viewport, two competing cursors).
        The vertex model IS the transform in edit mode, so the whole
        Transform section is hidden here.
      */}
      {mode !== 'edit' && (
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

      {mode === 'edit' && (
        <>
          <h3 className="section-title">Edit</h3>
          {activeAsset ? (
            <div className="edit-grid">
              <button
                className="edit-btn"
                onClick={() => {
                  const preAssets = useEditor.getState().assets;
                  const filled = fillHolesOnAsset(activeAsset.id);
                  if (filled > 0) {
                    // Push a history snapshot so undo rewinds both
                    // the asset record (vertexOffsets) AND the
                    // geometrySnapshot (applied by GeometryUndoBridge).
                    useEditor.getState().commitMakeFace(
                      activeAsset.id,
                      preAssets,
                      [filled],
                    );
                  }
                }}
                title="Detect boundary loops and triangulate-fill each one with a centroid fan"
                disabled={playMode}
              >
                🔺 Fill holes
              </button>
              <button
                className="edit-btn"
                onClick={() => {
                  const sel = useEditor.getState().selectedVertices;
                  const preAssets = useEditor.getState().assets;
                  const newTris = makeFaceOnAsset(activeAsset.id, sel);
                  useEditor
                    .getState()
                    .commitMakeFace(activeAsset.id, preAssets, newTris);
                }}
                disabled={playMode || useEditor.getState().selectedVertices.length < 3}
                title="Fan-triangulate the selected vertices into a face (or press F)"
              >
                ◧ Make face ({selectedVertexCount})
              </button>
              <button
                className="edit-btn"
                onClick={() => resetVertexEdits(activeAsset.id)}
                title="Discard all per-vertex offsets"
                disabled={playMode}
              >
                ⟲ Reset edits
              </button>
              <p className="hint">
                Click a yellow dot to select a vertex. Drag or use arrow
                keys (Shift = 0.5) to move. Click multiple vertices then
                press <kbd>F</kbd> to make a face. <kbd>X</kbd>/<kbd>Y</kbd>/
                <kbd>Z</kbd> lock the drag axis.
              </p>
            </div>
          ) : (
            <p className="empty section-empty">
              Select an asset to enable edit tools.
            </p>
          )}
        </>
      )}

      {mode === 'combine' && (
        <>
          <h3 className="section-title">Combine</h3>
          {assets.length < 2 ? (
            <p className="empty section-empty">
              Add at least two assets to combine.
            </p>
          ) : (
            <>
              <p className="hint">
                Pick a primary asset (left), then a target (right), then
                choose an operation. Result lands on the primary asset.
              </p>
              <div className="combine-pickers">
                <label className="combine-row">
                  <span>Primary</span>
                  <select
                    value={activeAsset?.id ?? ''}
                    onChange={(e) => setActiveAsset(e.target.value || null)}
                    disabled={playMode}
                  >
                    <option value="">— pick —</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="combine-row">
                  <span>Target</span>
                  <select
                    value={combineTargetId ?? ''}
                    onChange={(e) =>
                      useEditor.getState().setCombineTarget(e.target.value || null)
                    }
                    disabled={playMode}
                  >
                    <option value="">— pick —</option>
                    {assets
                      .filter((a) => a.id !== activeAsset?.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="combine-ops">
                <button
                  className="edit-btn"
                  onClick={() => {
                    const a = activeAsset;
                    const b = useEditor.getState().combineTargetId;
                    if (!a || !b) return;
                    const preAssets = useEditor.getState().assets;
                    const n = booleanOnAssets(a.id, b, 'union');
                    if (n > 0) {
                      useEditor.getState().commitMakeFace(a.id, preAssets, [n]);
                    }
                  }}
                  disabled={playMode || !activeAsset || !combineTargetId}
                  title="Add target to primary"
                >
                  ∪ Union
                </button>
                <button
                  className="edit-btn"
                  onClick={() => {
                    const a = activeAsset;
                    const b = useEditor.getState().combineTargetId;
                    if (!a || !b) return;
                    const preAssets = useEditor.getState().assets;
                    const n = booleanOnAssets(a.id, b, 'subtract');
                    if (n > 0) {
                      useEditor.getState().commitMakeFace(a.id, preAssets, [n]);
                    }
                  }}
                  disabled={playMode || !activeAsset || !combineTargetId}
                  title="Cut target out of primary"
                >
                  − Subtract
                </button>
                <button
                  className="edit-btn"
                  onClick={() => {
                    const a = activeAsset;
                    const b = useEditor.getState().combineTargetId;
                    if (!a || !b) return;
                    const preAssets = useEditor.getState().assets;
                    const n = booleanOnAssets(a.id, b, 'intersect');
                    if (n > 0) {
                      useEditor.getState().commitMakeFace(a.id, preAssets, [n]);
                    }
                  }}
                  disabled={playMode || !activeAsset || !combineTargetId}
                  title="Keep only the overlap"
                >
                  ∩ Intersect
                </button>
              </div>
            </>
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

      {/*
        Phase 4e: collision log (read-only). Visible always — in
        edit mode it shows the last play's events with frozen
        "X.Xs ago" labels (playClock doesn't tick after stop); in
        play mode the labels count up live. Empty state stays for
        "no collisions yet" so the user knows the section is alive.
        Edit mode: collisions are an artifact of play-mode simulation,
        which is disabled in edit mode, so the whole log is hidden
        to keep the sidebar focused on vertex editing.
      */}
      {mode !== 'edit' && (
        <>
          <h3 className="section-title">Collisions ({collisionEvents.length})</h3>
          {visibleEvents.length === 0 ? (
            <p className="empty">
              {playMode
                ? 'No collisions yet — bodies are simulating.'
                : 'No collisions recorded. Press P (▶ Play) to start a simulation.'}
            </p>
          ) : (
            <ul className="collision-log">
              {visibleEvents.map((e) => (
                <li key={`${e.a}-${e.b}-${e.t}`} className="collision-log-row">
                  <span className="collision-log-pair">
                    {nameForAsset(e.a)} <span className="collision-log-x">⨯</span>{' '}
                    {nameForAsset(e.b)}
                  </span>
                  <span className="collision-log-time">
                    {formatElapsed(playClock - e.t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}