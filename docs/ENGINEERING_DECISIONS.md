# Engineering decisions

A concise technical case study for the 3D Asset Editor. Every claim below points to public source code or a verification script. The repository is a personal prototype; its implementation does not imply production deployment or independently measured performance.

## 1. Treat a drag as a transaction, not 60 edits

**Problem.** Transform controls can update a mesh every frame while the pointer moves. If every update appends an undo snapshot, one visual drag creates dozens of history entries. That is correct from a state-mutation perspective and wrong from a user perspective.

**Decision.** During dragging, `setAssetTransformLive` updates the visual state without touching history. On release, `commitTransformDrag` compares against the pre-drag state and commits one snapshot only if something changed.

**Invariant.** A simulated 60-update drag yields one history entry; a click without movement yields zero; one undo restores the pre-drag position. The repo includes these checks in [verify-store.mts](../scripts/verify-store.mts).

**Trade-off.** The store keeps snapshot-based history rather than a general command/event log. This makes correctness easier to inspect for a prototype, but snapshots have memory cost as asset and geometry state grow.

Sources: [editor.ts](../src/store/editor.ts), [verify-store.mts](../scripts/verify-store.mts).

## 2. Explicit ownership at the simulation boundary

**Problem.** A renderer, a state store, and a physics engine cannot all independently own object transforms.

**Decision.**
- **Authoring / edit mode:** the store is authoritative; `syncBodies` updates static physics bodies to match editor transforms.
- **Play mode:** physics becomes authoritative; `PhysicsTicker` steps dynamic bodies and copies positions/rotations back to the store.
- Collider specifications and asset IDs determine whether a body can be reused or needs rebuilding.
- A fixed 1/60-second simulation step with bounded substeps is used to manage variable frame intervals.

**Invariant.** Removing an asset or its collider removes the corresponding body. Mode changes rebuild bodies as needed. Collision pairs are canonicalized and deduplicated before they enter the UI store.

**Trade-off.** A module-level singleton world is practical for one editor but complicates multiple canvases, hot reload, and isolated instances. Converting body rotations back to XYZ Euler angles can also lose the original rotation order.

Sources: [physics.ts](../src/lib/physics.ts), [PhysicsTicker.tsx](../src/components/PhysicsTicker.tsx), [verify-physics.mts](../scripts/verify-physics.mts).

## 3. Make mutable geometry compatible with undo/redo

**Problem.** Three.js `BufferGeometry` is mutable, while the editor store uses snapshots. Reverting only React/Zustand state does not restore a mesh's vertices or indices.

**Decision.** Store geometry position/index snapshots around destructive edits and increment `geometryMutationNonce` to detect a meaningful mutation. Keep per-vertex offsets in the asset record. Geometry operations go through a bridge to the live mesh.

**Why it matters.** It separates the UI's logical edit history from rendering buffers while preserving a path to restoration. The design also makes a geometry-undo regression testable.

**Trade-off.** Snapshotting large position/index arrays is expensive. The system is a proof of engineering correctness for modest assets, not a claim that full copies are appropriate at arbitrarily high mesh scale. A mature editor could evaluate delta storage, commands, persistent geometry structures, or buffer pooling.

Sources: [editor.ts](../src/store/editor.ts), [meshOps.ts](../src/lib/meshOps.ts), [verify-store.mts](../scripts/verify-store.mts).

## 4. Validate what the project really supports

**Implemented UI:** mesh import, primitives, transforms, vertex edits, paint overrides, collider editing, play/stop simulation, and collision event logging.

**Deliberately out of scope or not surfaced:** Gaussian splat editing; a visible Combine/CSG workflow; robust non-planar or multi-loop hole repair; exact collider fitting for all nonuniform scales.

**Executable checks:** `npm run verify` runs the script-based store, physics, collider-input, and toolbar verifications; `npm run typecheck`, `npm run lint`, and `npm run build` exist in [package.json](../package.json). Their existence does not establish green CI or comprehensive browser E2E coverage.

## How this translates outside graphics

The reusable engineering skills are **transaction semantics, state ownership across subsystems, deterministic invariants, explicit trade-offs, input/format boundaries, and product-driven interaction design**. The 3D interface makes those problems visible; the same reasoning applies to complex business applications, creative tools, and other stateful products.
