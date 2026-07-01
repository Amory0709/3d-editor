# 3D Asset Editor

Browser-based editor for mesh and gaussian-splat 3D assets.

## Status

| Phase | Status | Scope |
|------:|:------:|-------|
| 1 | done | Vite + React + TS scaffold, zustand store, toolbar/sidebar/viewport layout |
| 2 | done | Mesh upload (`.glb`/`.gltf`/`.obj`), drag-drop, auto-fit camera, error boundary |
| 3 | done | Transform gizmos (W/E/R/F/Esc) + primitives (cube/sphere/cylinder); vertex edit + merge deferred |
| 3.1 | done | Editor usability: undo/redo (⌘Z / ⌘⇧Z / Ctrl+Y), numeric transform inspector, axis lock (X/Y/Z), reset-to-identity, larger gizmo |
| 3.2 | done | Drag commit-on-release (1 history entry per gizmo drag, was ~60/frame) |
| 3.2a | done | Vertex-level editing: yellow dots overlay, click to select, drag or arrow keys to move (Shift = 0.5), per-vertex offsets stored on AssetRef, undo restores |
| 3.2b | done | Auto hole-fill: detect boundary loops → centroid-fan triangulation, weld-then-fill handles three's no-sharing box vertices |
| 3.2c | done | Manual make-face: click multiple vertices, press `F` (or use the sidebar button) to fan-triangulate them into a new face |
| 5 | done | Boolean CSG: union / subtract / intersect two assets (three-bvh-csg). New "Combine" mode. Per-vertex edits are NOT included in the brush; they live on the base shape, so CSG works on the original geometry |
| 4a | done | Visual collider markers (box/sphere/capsule/cylinder) + camera refit-on-add + sidebar empty state |
| 4b | done | cannon-es physics world mirrors the collider graph (one-way editor → physics sync, static bodies, capsule = compound, scale baked into shape) — see [Known limitations](#phase-4b--known-limitations) |
| 4c | done | Numeric collider editor: halfExtents / radius / height inputs with blur-clamp + blur-commit (one history entry per focus session) |
| 4d | done | Play mode: Toolbar Play/Stop button (P shortcut), bodies flip dynamic, world.step() drives them, body→asset transform sync on stop (one history entry per play session) |
| 4e | done | Collision events: world-level `beginContact` listener, sidebar log shows last 10 contacts with elapsed time, canonical (a < b) dedup, log persists across stop, clears on next play |
| 5 | planned | Gaussian splat editor (`.splat`/`.ply`/`.spz`) |

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # production bundle (manualChunks: three / r3f / app)
npm run typecheck    # tsc -b --noEmit
npm run verify       # store + physics invariants (pure-Node, no browser needed)
npm run smoke -- path/to/file.glb   # GLB loader sanity check
```

## Phase 4 — known limitations

The collider graph + editor are real and tested, but a few edges are
intentionally rough. They are tracked here so future phases don't
re-discover them.

### Editor UI (4c)

1. **No auto-fit to mesh.** Default colliders use fixed sizes
   (`box: ±0.5`, `sphere: r=0.6`, `capsule: r=0.4 h=1.2`,
   `cylinder: r=0.5 h=1.2`). A loaded `.glb` mesh with a 3 m bounding
   box gets a 1 m collider, which the user resizes with the numeric
   editor. Auto-fit to the mesh's bounding box is a follow-up.

### Physics (4b / 4d / 4e)

2. **Scale envelope, not exact match.** For capsule + sphere, the
   body is a conservative envelope (uses `max(sx, sz)` / `max(sx, sy, sz)`),
   so it can extend beyond the visual in the unscaled axes. Acceptable
   for collision queries; a future phase can swap in ellipsoids if
   exactness matters.
3. **Rotation is extracted to XYZ Euler on body→asset write.** The
   dynamic body's quaternion is converted to an XYZ Euler on every
   frame in play mode. This is lossy if the body started from a
   non-XYZ Euler (e.g. a phase-4b gizmo that authored YXZ). For
   play-mode simulation it doesn't matter (the body just falls and
   rotates), but a future phase that round-trips through play
   while preserving order will need to store the quaternion.
4. **No collider edits during play.** Changing type or dimensions
   mid-simulation would require rebuilding a dynamic body mid-step,
   which cannon-es doesn't support. Stop first, edit, re-play.
5. **beginContact, not `collide`.** The sidebar logs `'beginContact'`
   events (one entry per pair, fires once when bodies first touch).
   The per-body `'collide'` event fires every frame for every
   contact equation — too noisy for a read-only log. Contact info
   (normal, impulse, contact point) isn't surfaced in 4e; it's a
   future phase if/when we add trigger volumes or response UI.
6. **Module-level singleton world.** Convenient for a single editor,
   but it means HMR and multi-Canvas setups need care. `resetPhysicsWorld()`
   exists for tests. Moving the world into a React Context is on the
   5 backlog — not worth a refactor right now.

### View (4a / 4c)

5. **Non-active assets have invisible collider markers.** Only the
   selected asset renders the marker in the viewport, but every asset
   with a collider is reflected in the physics world. There is no
   "show all colliders" toggle yet.
6. **Euler order is tracked in the store but the gizmo doesn't expose
   it.** A future numeric transform inspector can set the order via
   the same input pattern the collider editor uses.

## Supported inputs (phase 3.1)

| Format | Loader | Notes |
|--------|--------|-------|
| `.glb` | drei `useGLTF` | cached, primary path |
| `.gltf` | drei `useGLTF` | external buffers must be reachable |
| `.obj` | three `OBJLoader` | no MTL — falls back to a neutral PBR material |
| primitive `cube` / `sphere` / `cylinder` | procedural | from sidebar buttons |
| collider `box` / `sphere` / `capsule` / `cylinder` | visual marker + cannon-es body | from sidebar in Collision mode; capsule body is a compound (Cylinder + 2 Sphere) |

`.ply`, `.splat`, `.spz` are rejected with an explicit "phase 5" message.

## Undo / redo scope (phase 3.1)

Snapshot-based history of the `assets` array (cap 100). Covers:
- addAsset (file upload)
- removeAsset
- addPrimitive
- setAssetTransform (gizmo drag)
- resetAssetTransform
- setAssetCollider

Does NOT cover: setActiveAsset, setMode, setTransformMode, setAxisLock, setLoading, setError (navigation / UI state).

Any new mutation clears the redo stack (standard editor behavior).

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| W / E / R | Translate / Rotate / Scale gizmo |
| X / Y / Z | Toggle axis lock (per mode) |
| F | Refit camera to current scene |
| Esc | Deselect active asset |
| ⌘Z / Ctrl+Z | Undo |
| ⌘⇧Z / Ctrl+Y / Ctrl+⇧Z | Redo |
| P | Toggle play / stop (phase 4d) |

## Project layout

```
src/
  components/        # React UI (App, Toolbar, Sidebar, Viewport, MeshRenderer, ...)
  store/editor.ts    # Zustand state (assets, mode, transform, loading, error)
  lib/
    formats.ts       # single source of truth for supported formats + primitive types
    upload.ts        # file picker / drop ingestion
    dispose.ts       # Three.js GPU-buffer disposal
    keyboard.ts      # editor keyboard shortcuts
scripts/
  smoke-load-gltf.ts # GLB loader sanity check (needs a .glb you supply)
```

## Verified

- `npm run build` → app shell **8 KB gz / r3f 95 KB gz / three 202 KB gz**
- `npm run typecheck` → 0 errors, strict TS
- `npm run smoke -- ./fixture.glb` → prints mesh / triangle counts from `three.GLTFLoader`, cross-checked against `@gltf-transform/core`

## Follow-ups (deferred)

- Vitest unit tests (vitest installed; no spec files yet — store + history helpers are pure and easy targets)
- Phase 3.1 follow-up #1: camera fit on remove-all (currently first-fit doesn't reset on full clear)
- Phase 3.1 follow-up #2: OBJ upload doesn't auto-fit (intentional camera-stability, but confusing UX)
- Phase 3.1 follow-up #3: ESC clears asset but sidebar Transform section disappears mid-mode
- Vertex edit + merge (phase 3.2): transform layer in place, vertex picking + scene merge not done — **shipped 3.2a/b/c** (vertex edit + hole-fill + make-face), Phase 5 (boolean CSG)
- `<primitive object={scene}>` should be replaced with `drei <Gltf>` or per-mesh JSX before phase 4b physics
- `useGLTF` cache eviction when an asset is removed mid-load (current leak is bounded by the loader's promise, not by the GPU)
- Phase 4b: real physics integration (cannon / rapier / custom), auto-convex / auto-trimesh from mesh, custom collider dimensions (per-collider halfExtents / radius / height) — **shipped 4b** covers the engine + dimensions; numeric UI for custom dimensions + play mode + collision events are 4c
- Prettier config (only ESLint installed today)

## Repository hygiene

- `.agents/` and `skills-lock.json` belong to developer tooling and are `.gitignore`d; they stay on disk for the local agent but are not part of the project.
- `*.tsbuildinfo` is ignored — never commit TS incremental build cache.