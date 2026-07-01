# Phase 3.2 / Phase 5 — Mesh Edit + Boolean: How to Verify

This doc covers the four new pieces shipped in the latest slice:

1. **3.2a** — Vertex-level editing (click a vertex, drag or arrow-key it)
2. **3.2b** — Auto hole-fill (one-click boundary loop → centroid fan)
3. **3.2c** — Manual make-face (`F` hotkey, Blender-style)
4. **Phase 5** — Boolean CSG (union / subtract / intersect)

---

## Quick Start (Browser)

1. **Start dev server** (already running in this session):
   ```bash
   npm run dev
   ```
   Open <http://127.0.0.1:5173/>.

2. **Load the test fixture**:
   - Drag `public/fixtures/holey-cube.glb` into the viewport, **or**
   - Add a primitive cube and confirm it has all 6 faces (this is the "no hole" baseline).

3. **Click the `holey-cube.glb`** in the asset list to select it. You'll see a 1×1×1 box with no top face — the 4 side walls + bottom are visible, and looking down through the open top you should see the bottom's inside surface.

---

## Test 1: Auto Hole-Fill (3.2b)

**Setup**: `holey-cube.glb` is loaded and selected.

1. Click the toolbar's **Edit** tab (or sidebar's mode picker → "Edit mode").
2. The active asset switches to vertex edit mode. You should see **yellow dots** at every vertex.
3. In the sidebar, scroll to the **Edit** section. Click **🔺 Fill holes**.

**Expected**:
- The box gets a new top face made of 4 triangles fanned around a centroid vertex at the box center.
- The yellow vertex dots now include the new centroid (one extra dot in the middle of the top).
- **Undo (⌘Z)** rewinds: the top disappears, the new centroid dot is gone, the asset's `geometrySnapshot` field is cleared in the store.

**Verify in DevTools**:
```js
window.__editor.getState().assets[0].geometrySnapshot  // null after undo
window.__editor.getState().history.past.length         // bumped by the commit
```

---

## Test 2: Vertex Drag (3.2a)

**Setup**: Same holey-cube in Edit mode, after Test 1 OR with no fill.

1. **Drag a vertex**:
   - Click a yellow dot on the top edge of the box. It turns red.
   - Hold and drag — the vertex moves.
   - Mouse-up: the new position is committed (one history entry).
   - **⌘Z** reverts.

2. **Arrow keys**:
   - Select a vertex (click).
   - Press <kbd>→</kbd> — moves +X by 0.05. Press with <kbd>Shift</kbd> — 0.5.
   - <kbd>Page Up</kbd> / <kbd>Page Down</kbd> move on Z.
   - <kbd>X</kbd> / <kbd>Y</kbd> / <kbd>Z</kbd> lock the drag axis (also affects the click-and-drag).

3. **Multiple selection**:
   - Click dot 1 — turns red.
   - Click dot 2 — both turn red.
   - Click dot 1 again — only dot 2 stays red.
   - Press arrow keys — both move together.

---

## Test 3: Manual Make-Face (`F`) (3.2c)

**Setup**: Hole-cube, Edit mode, after **Test 1 has run** (so the top has 4 edge vertices + 1 centroid).

1. The top has 4 visible edge vertices forming a square. Click all 4 in order around the loop:
   - Click the top-front-left dot.
   - Click top-front-right.
   - Click top-back-right.
   - Click top-back-left.
   - All 4 are red.
2. Sidebar shows **"◧ Make face (4)"** — the count is 4.
3. Press <kbd>F</kbd>.

**Expected**:
- A new quadrilateral appears (split into 2 triangles by Blender-style fan-from-vertex-0).
- The selection clears.
- One history entry pushed (⌘Z removes the face).

If you selected fewer than 3 vertices, the button is disabled and <kbd>F</kbd> is a no-op.

---

## Test 4: Boolean CSG (Phase 5)

**Setup**: Need 2 assets, ideally overlapping. The cleanest repro is:
- Add a **Cube** primitive at origin.
- Add a **Sphere** primitive, drag it to overlap the cube (select → W → drag the gizmo).
- Both should be visible, intersecting.

1. Toolbar → **Combine** mode.
2. Sidebar shows two pickers: **Primary** and **Target**.
3. Set Primary = Cube, Target = Sphere.
4. Click **∪ Union** — the union replaces the cube's geometry with the boolean result. The sphere is untouched.
5. **− Subtract** — the sphere is cut out of the cube (cube becomes a cube with a spherical bite).
6. **∩ Intersect** — only the overlap region remains (lens-shaped).
7. Each op is one history entry; ⌘Z rewinds.

**Caveat**: boolean works on the **base geometry** of each asset, not on per-vertex edits. If you've dragged vertices (3.2a), the boolean uses the original (un-dragged) positions. To bake your edits, hit **⟲ Reset edits** first.

---

## Test 5: Undo / Redo Wiring (Geometry)

To confirm the **geometrySnapshot** + **GeometryUndoBridge** plumbing is correct:

```js
// In the browser DevTools console:
const s = window.__editor.getState();

// Make a snapshot.
s.setGeometrySnapshot(s.assets[0].id, {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
});
s.commitMakeFace(s.assets[0].id, s.assets, [1]);

// Now the asset has a snapshot, and history has 1+ entries.
s.history.past.length;
// Undo restores the snapshot.
s.undo();
s.assets[0].geometrySnapshot;  // null again
s.geometryUndoNonce;            // bumped
s.geometryUndoTargets;          // includes the asset id
```

The `GeometryUndoBridge` component (mounted in the Scene) watches `geometryUndoNonce` and writes `geometrySnapshot.positions` / `geometrySnapshot.indices` back into the live `BufferGeometry`.

---

## Pure-Node Verification (no browser)

Three scripts live in `scripts/`:

```bash
npx tsx scripts/verify-mesh-edit.mts
# 14 pass / 0 fail — boundary detection, loop walking, fan triangulation
# round-trip on a synthetic holey box

npx tsx scripts/verify-store.mts
# 31 pass — store invariants (history, transforms, collider defaults, etc.)

npx tsx scripts/verify-physics.mts
# physics invariants

npx tsx scripts/make-holey-cube.ts
# (re)generates public/fixtures/holey-cube.glb from a BoxGeometry with
# the top-face triangles deleted. Output: 24 vertices, 10 triangles
# (originally 12).
```

---

## Self-Review Notes

The implementation went through three review passes during development. Key calls:

| Concern | Resolution |
|---------|------------|
| `mergeVertices` from three kept per-face normals separate on box geometry, so vertex counts never went from 24 → 8 | Wrote a custom `weldVertices` in `src/lib/meshEdit.ts` that quantizes by position only. Verified: 24 → 8 on a unit BoxGeometry. |
| Undo of `fillHoles` / `makeFace` / `boolean` mutated the BufferGeometry in place — undo only restored the asset record, not the actual vertices/indices | Added `AssetRef.geometrySnapshot`, `setGeometrySnapshot` action, and `GeometryUndoBridge` that writes the snapshot back when `geometryUndoNonce` bumps. Verified end-to-end with the DevTools test above. |
| `fillHoles` on a freshly-loaded `.glb` would see every edge as boundary (no vertex sharing) | `fillHolesOnAsset` calls `weldVertices` first, then runs boundary detection on the welded geometry, then copies the result back. |
| Boundary detection on a non-indexed geometry would need ε-equality between vertex positions, not implemented | We bail with `return []` for non-indexed geometries. Most `.glb` / `.gltf` files come indexed, and primitives are created indexed by three. |
| `Math.floor` in weld hash bucketed -0.0001 and +0.0001 into different keys | Switched to `Math.round`. |
| Duplicate `{mode === 'edit' && (` block in Sidebar (the second one was a leftover from an earlier edit) | Removed; the sidebar now has a single Edit section. |
| `Boolean CSG` brushes share geometry with the live assets | We `weldVertices` first, hand the welded copy to `Brush`, and dispose the welded copy after the evaluator runs. The live asset geometry is never touched by the Brush. |

### What we deliberately did NOT do (deferred)

- **Halfedge / face-edge selection** — picking individual edges or faces. The MVP supports vertex selection + per-triangle face creation, but not edge picking.
- **Bridge edge loops** — selecting two boundary loops and bridging them with a tube. This requires halfedge structure.
- **Liepa / ear-clipping** — proper triangulation of non-convex / non-planar holes. We use centroid-fan, which works for the small boxy holes our fixture produces; non-planar holes will look stepped.
- **Boolean on per-vertex edits** — boolean works on the base shape; the user's drag edits are not part of the brush. The sidebar copy mentions this.
- **Multi-loop holes** (hole with an island inside it) — centroid-fan treats it as a single loop. The island gets covered.

### Known minor issues

- **Self-intersection in CSG result**: three-bvh-csg can produce non-manifold seams. Run **Fill holes** on the result to patch them.
- **Box-geometry boolean**: works, but the result is unindexed (no shared vertices). If you want to do further hole-fill on a boolean result, click Reset edits first to bake any pending offsets, then run Fill holes — the weld step will normalize topology.
- **OBJ files**: vertex sharing in `.obj` depends on the exporter. If you upload a `.obj` with no shared vertices, the weld step will handle it. If you upload one with bad topology (broken edges), boundary detection may report false positives.

---

## Fixture Generation

The holey-cube fixture is generated programmatically. To regenerate:

```bash
npx tsx scripts/make-holey-cube.ts
```

Writes `holey-cube.glb` (1 KB) to the repo root and `public/fixtures/`. The generator:
1. Creates a `BoxGeometry(1, 1, 1)` — 24 vertices, 12 triangles.
2. Walks the index buffer; keeps only triangles where NOT all 3 vertices have `y > 0.49` (deletes the top face).
3. Packs the result via `@gltf-transform/core` and writes the binary GLB.

The result has 24 vertices and 10 triangles. Boundary detection should find 4 boundary edges forming 1 loop around the open top.
