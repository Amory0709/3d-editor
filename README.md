# 3D Asset Editor

Browser-based editor for mesh and gaussian-splat 3D assets.

## Status

| Phase | Status | Scope |
|------:|:------:|-------|
| 1 | done | Vite + React + TS scaffold, zustand store, toolbar/sidebar/viewport layout |
| 2 | done | Mesh upload (`.glb`/`.gltf`/`.obj`), drag-drop, auto-fit camera, error boundary |
| 3 | next | Transform gizmos, vertex edit, primitives, merge |
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

## Supported inputs (phase 2)

| Format | Loader | Notes |
|--------|--------|-------|
| `.glb` | drei `useGLTF` | cached, primary path |
| `.gltf` | drei `useGLTF` | external buffers must be reachable |
| `.obj` | three `OBJLoader` | no MTL — falls back to a neutral PBR material |

`.ply`, `.splat`, `.spz` are rejected with an explicit "phase 5" message.

## Project layout

```
src/
  components/        # React UI (App, Toolbar, Sidebar, Viewport, MeshRenderer, ...)
  store/editor.ts    # Zustand state (assets, mode, loading, error)
  lib/
    formats.ts       # single source of truth for supported formats
    upload.ts        # file picker / drop ingestion
    dispose.ts       # Three.js GPU-buffer disposal
scripts/
  smoke-load-gltf.ts # GLB loader sanity check (needs a .glb you supply)
```

## Verified

- `npm run build` → app shell **8 KB gz / r3f 95 KB gz / three 202 KB gz**
- `npm run typecheck` → 0 errors, strict TS
- `npm run smoke -- ./fixture.glb` → prints mesh / triangle counts from `three.GLTFLoader`, cross-checked against `@gltf-transform/core`

## Follow-ups (deferred)

- ESLint + Prettier config (no lint today; format check by eye)
- Vitest unit tests (store / format helpers are pure — easy targets once a runner is wired in)
- `<primitive object={scene}>` should be replaced with `drei <Gltf>` or per-mesh JSX before phase 3 transform tools
- `<Bounds>` remount-on-asset-switch flashes the camera — phase 3 should preserve camera state across asset changes when transforms exist
- `useGLTF` cache eviction when an asset is removed mid-load (current leak is bounded by the loader's promise, not by the GPU)

## Repository hygiene

- `.agents/` and `skills-lock.json` belong to developer tooling and are `.gitignore`d; they stay on disk for the local agent but are not part of the project.
- `*.tsbuildinfo` is ignored — never commit TS incremental build cache.