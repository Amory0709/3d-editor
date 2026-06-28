# 3D Asset Editor

Browser-based editor for mesh and gaussian-splat 3D assets.

## Status

| Phase | Status | Scope |
|------:|:------:|-------|
| 1 | done | Vite + React + TS scaffold, zustand store, toolbar/sidebar/viewport layout |
| 2 | done | Mesh upload (`.glb`/`.gltf`/`.obj`), drag-drop, auto-fit camera, error boundary |
| 3 | done | Transform gizmos (W/E/R/F/Esc) + primitives (cube/sphere/cylinder); vertex edit + merge deferred |
| 3.1 | done | Editor usability: undo/redo (⌘Z / ⌘⇧Z / Ctrl+Y), numeric transform inspector, axis lock (X/Y/Z), reset-to-identity, larger gizmo |
| 4a | next | Visual collider markers (box/sphere/capsule/cylinder) bound to asset — sidebar shows Collider section in Collision mode |
| 4 | planned | Collision shapes |
| 5 | planned | Gaussian splat editor (`.splat`/`.ply`/`.spz`) |

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # production bundle (manualChunks: three / r3f / app)
npm run typecheck    # tsc -b --noEmit
npm run smoke -- path/to/file.glb   # GLB loader sanity check
```

## Supported inputs (phase 3.1)

| Format | Loader | Notes |
|--------|--------|-------|
| `.glb` | drei `useGLTF` | cached, primary path |
| `.gltf` | drei `useGLTF` | external buffers must be reachable |
| `.obj` | three `OBJLoader` | no MTL — falls back to a neutral PBR material |
| primitive `cube` / `sphere` / `cylinder` | procedural | from sidebar buttons |
| collider `box` / `sphere` / `capsule` / `cylinder` | visual marker | from sidebar in Collision mode; depth-test off so it shows through mesh |

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
- Vertex edit + merge (phase 3.2): transform layer in place, vertex picking + scene merge not done
- `<primitive object={scene}>` should be replaced with `drei <Gltf>` or per-mesh JSX before phase 4b physics
- `useGLTF` cache eviction when an asset is removed mid-load (current leak is bounded by the loader's promise, not by the GPU)
- Phase 4b: real physics integration (cannon / rapier / custom), auto-convex / auto-trimesh from mesh, custom collider dimensions (per-collider halfExtents / radius / height)
- Prettier config (only ESLint installed today)

## Repository hygiene

- `.agents/` and `skills-lock.json` belong to developer tooling and are `.gitignore`d; they stay on disk for the local agent but are not part of the project.
- `*.tsbuildinfo` is ignored — never commit TS incremental build cache.