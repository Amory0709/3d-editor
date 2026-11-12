# 3D Asset Editor

**A browser-based 3D authoring prototype built to explore reliable interaction, editable geometry, and real-time simulation.**

React · TypeScript · Three.js · React Three Fiber · Zustand · cannon-es

This project is not only a 3D viewer. It explores the engineering decisions behind a usable editing tool: how to make each user action reversible, keep simulation state consistent with editor state, and make geometry operations behave predictably.

## What you can do

- **Import and inspect** GLB, GLTF, and OBJ meshes, or add cube, sphere, and cylinder primitives.
- **Edit objects** with translation, rotation, scale, axis locks, a numeric transform inspector, and camera framing.
- **Edit geometry** at vertex level; fill simple boundary holes or construct faces from selected vertices.
- **Paint individual mesh parts** with reversible color overrides without replacing the imported materials.
- **Define colliders** (box, sphere, capsule, cylinder), tune dimensions, and preview a physics simulation.
- **Recover actions** with undo/redo for supported editor mutations, including a full gizmo drag as one action.

> **Scope:** This is an experimental, single-user editor—not a production-ready 3D DCC suite. Gaussian-splat formats (`.ply`, `.splat`, `.spz`) are not supported. Boolean CSG logic exists in the codebase, but the Combine workflow is not exposed in the current UI.

## Engineering decisions

| Problem | Design choice | Why it matters |
| --- | --- | --- |
| A drag emits many transform updates | Update live state while dragging; commit one history snapshot on release | **One undo** reverses the whole drag instead of one frame; a no-op drag creates no entry |
| Editing and simulation have different sources of truth | **Edit:** asset state drives static physics bodies. **Play:** dynamic bodies drive asset transforms | Prevents the editor and physics engine from fighting over object positions |
| Geometry edits mutate Three.js buffers | Keep geometry snapshots and a mutation nonce alongside editor state | Enables undo/redo to restore geometry changes, not only UI metadata |
| Changing collider dimensions can invalidate an existing body | Reconcile bodies against asset IDs, shape keys, and simulation mode | Avoids stale physics shapes and cleans up removed assets |
| Many collision events can overwhelm the UI | Collect and deduplicate canonical asset pairs; cap the stored log | Keeps diagnostic state bounded and predictable |

These are implementation details, not benchmark claims. See [Engineering decisions](docs/ENGINEERING_DECISIONS.md) for source links, invariants, trade-offs, and known limitations.

## Architecture at a glance

```text
User input (toolbar, inspector, viewport)
        │
        ▼
Zustand editor store ───────► Undo / redo snapshots
        │
        ├────────► React Three Fiber / Three.js scene
        │                     └── Geometry mutations + buffer bridge
        │
        └────────► PhysicsTicker / cannon-es
                               ├── Edit: editor → static bodies
                               └── Play: dynamic bodies → editor
```

The main boundaries are [editor state](src/store/editor.ts), [format handling](src/lib/formats.ts), [geometry operations](src/lib/meshOps.ts), [physics reconciliation](src/lib/physics.ts), and the [frame tick](src/components/PhysicsTicker.tsx).

## Run locally

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite. To run available project checks:

```bash
npm run typecheck
npm run build
npm run lint
npm run verify
```

`npm run verify` executes Node-based invariants for store/history, physics, collider inputs, and toolbar behavior. `npm run smoke -- path/to/asset.glb` checks a supplied GLB file with the loader. These scripts are present in [package.json](package.json); **no claim is made here that the checks ran in CI**.

## Try these workflows

1. Add a cube, move it with a gizmo, then use Undo once. The entire drag should revert.
2. Switch to Collision, assign a box collider, enter Play, and observe how simulation owns the object's transform until Stop.
3. Import a multi-part GLB, switch to Paint, change a part's color, and undo the override.
4. Switch to Vertices on a supported mesh, edit vertices, and exercise undo/redo.

## Current boundaries

- GLTF files that reference external buffers must have those buffers reachable; standalone GLB is the simplest import path.
- Hole filling uses centroid-fan triangulation for simple boundary loops; it is not a general remeshing solution.
- Capsule and sphere collision bodies may conservatively enclose non-uniformly scaled geometry.
- Physics uses a single module-level world suitable for this one-editor prototype; multi-editor embedding needs isolation.
- Some previously developed features remain behind the UI or are deferred. See [development history](docs/DEVELOPMENT_HISTORY.md).

**Design goal:** make technically complex interactions understandable, reversible, and testable—not merely visually impressive.
