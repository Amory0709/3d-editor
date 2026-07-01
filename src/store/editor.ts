import { create } from 'zustand';
import type { EulerOrder } from 'three';
import {
  type AssetFormat,
  type AssetKind,
  type ColliderSpec,
  type PrimitiveType,
} from '@/lib/formats';

/** Object transform in world space, stored per asset.
 *  - `rotation` is `[x, y, z, order]` where `order` is the Euler order
 *    (matches THREE.Euler.order). The order is tracked so downstream
 *    consumers (physics) can re-build a quaternion without re-asserting
 *    a default — the gizmo or a future numeric inspector can rotate in
 *    YXZ without losing fidelity.
 *  - `scale` is local object scale; collider shapes bake the scale into
 *    their halfExtents / radius (see lib/physics.ts). */
export interface ObjectTransform {
  position: [number, number, number];
  rotation: [number, number, number, EulerOrder];
  scale: [number, number, number];
}

export const DEFAULT_TRANSFORM: ObjectTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 'XYZ'],
  scale: [1, 1, 1],
};

export type TransformMode = 'translate' | 'rotate' | 'scale';

export type EditorMode = 'mesh' | 'collision' | 'gaussian' | 'edit' | 'combine';

export type AxisLock = 'x' | 'y' | 'z' | null;

/** Per-asset collider (phase 4a / 4b). null = no collider set.
 *  The actual shape is a discriminated union in lib/formats — re-exported
 *  here as a type alias for the asset record. */
export type { ColliderSpec } from '@/lib/formats';

export interface AssetRef {
  /** stable id used as R3F key + state lookup */
  id: string;
  /** human-readable name (file name or primitive label) */
  name: string;
  /** local object URL for file assets; undefined for primitives */
  url?: string;
  /** detected format from extension, or 'unknown' for primitives */
  format: AssetFormat;
  /** payload class — drives which renderer to use */
  kind: AssetKind;
  /** where the asset came from */
  source: 'file' | 'primitive';
  /** primitive type, set only when source === 'primitive' */
  primitiveType?: PrimitiveType;
  /** bytes; 0 for primitives */
  size: number;
  /** when loaded */
  loadedAt: number;
  /** current transform in world space */
  transform: ObjectTransform;
  /** assigned collider marker (phase 4a) */
  collider: ColliderSpec | null;
  /**
   * Phase 3.2a: per-vertex position offsets (length = 3 * vertexCount).
   * null = no edits; vertices are at their base geometry positions.
   * Stored as plain array so zustand equality checks stay cheap and the
   * data survives structuredClone for undo.
   */
  vertexOffsets: number[] | null;

  /**
   * Phase 3.2b/3.2c/5: snapshot of the asset's geometry buffers
   * (positions + indices) captured BEFORE a destructive geometry
   * mutation (hole-fill, make-face, boolean). The undo action restores
   * this back into the live BufferGeometry, so undo actually rewinds
   * vertex/index changes — not just the asset record.
   *
   * Only set on assets that have had geometry mutated. Missing/null
   * means "geometry unchanged from its initial loaded state".
   *
   * Format: { positions: number[], indices: number[] | null }.
   * Stored as plain arrays for zustand compatibility.
   */
  geometrySnapshot: { positions: number[]; indices: number[] | null } | null;

  /**
   * Bumped on every destructive geometry mutation (hole-fill, make-face,
   * boolean). The undo/redo comparison uses this nonce — not the
   * snapshot reference — because commitMakeFace enriches preAssets with
   * the same snapshot object, so reference equality would always be true.
   * (See commitMakeFace for the rationale.)
   */
  geometryMutationNonce: number;
}

/**
 * Undo / redo stacks of `assets` snapshots.
 *
 * - `past` holds the snapshots taken BEFORE each trackable mutation.
 * - `future` holds snapshots that were displaced by an undo, available
 *   for redo. Any new mutation clears `future` (standard editor behavior).
 *
 * Snapshot is the full `assets` array — small enough that we don't need
 * fine-grained command objects in phase 3.1. Each trackable action
 * (add/remove/transform/collider) snapshots via `pushHistory` first.
 */
interface History {
  past: AssetRef[][];
  future: AssetRef[][];
}

const HISTORY_LIMIT = 100;

/** Phase 4e: ring-buffer cap for the collision log. When more than
 *  this many events have fired in the current play session, the
 *  oldest are dropped to keep the UI list bounded. 100 ≈ a busy
 *  play session of many short contacts; older events are not
 *  interesting once the user is investigating a specific collision. */
const COLLISION_LOG_LIMIT = 100;

/** One collision event for the sidebar log. `a` and `b` are
 *  canonical asset ids (a < b by string compare). `t` is the
 *  playClock value (seconds since the current play started) at
 *  the moment the event was pushed; the sidebar uses it to render
 *  "X.Xs ago" relative to the live playClock. */
export interface CollisionEvent {
  a: string;
  b: string;
  t: number;
}

interface EditorState {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;

  assets: AssetRef[];
  activeAssetId: string | null;
  addAsset: (asset: AssetRef) => void;
  removeAsset: (id: string) => void;
  setActiveAsset: (id: string | null) => void;
  setAssetTransform: (id: string, transform: ObjectTransform) => void;
  /**
   * Live transform update — does NOT push history and does NOT clear redo.
   * Used by TransformControls during a gizmo drag, so each onObjectChange
   * frame doesn't pollute the undo stack with intermediate positions.
   * The drag is committed via {@link commitTransformDrag} on mouse-up.
   */
  setAssetTransformLive: (id: string, transform: ObjectTransform) => void;
  /**
   * Commit a gizmo drag — pushes the pre-drag assets snapshot to the undo
   * stack so a single ⌘Z reverts the entire drag, not just the last frame.
   * If the transform didn't actually change, this is a no-op.
   */
  commitTransformDrag: (preDragAssets: AssetRef[]) => void;
  /**
   * Phase 3.2a — push a snapshot to history at the end of a vertex
   * drag if any vertex offsets changed. Mirrors
   * {@link commitTransformDrag} but for per-vertex edits.
   */
  commitVertexEdit: (preDragAssets: AssetRef[]) => void;
  /** Phase 3.2a — update an asset's `vertexOffsets`. null clears edits. */
  setVertexOffsets: (id: string, offsets: number[] | null) => void;
  /**
   * Phase 3.2b — replace the entire vertex buffer + index buffer for an
   * asset. Used by hole-fill and make-face, which grow the geometry
   * (new centroid vertices, new triangles). Caller passes the FULL
   * new position array; we rebuild offsets to match its length with
   * zeros for newly added vertices, preserving any pre-existing offsets
   * for shared vertices.
   *
   * The BufferGeometry is mutated in place by the caller; this action
   * just keeps the store's `vertexOffsets` in sync.
   */
  setVertexData: (id: string, positions: number[]) => void;

  /**
   * Phase 3.2c — commit a Make-Face operation to history. The actual
   * geometry mutation is done by the caller (meshOps.makeFaceOnAsset);
   * this just pushes a history entry so Cmd+Z rewinds to pre-face state.
   */
  commitMakeFace: (
    id: string,
    preFaceAssets: AssetRef[],
    triangleIndices: number[],
  ) => void;

  /**
   * Phase 3.2b/3.2c/5 — attach a snapshot of an asset's geometry
   * buffers to its AssetRef so undo can restore them. Called by
   * lib/meshOps BEFORE the geometry mutation, so undo (which restores
   * the AssetRef) also has the pre-mutation geometry to write back.
   *
   * If a snapshot already exists, do NOT overwrite — the existing
   * snapshot represents an earlier state the user hasn't rewound
   * from yet.
   */
  setGeometrySnapshot: (
    id: string,
    snapshot: { positions: number[]; indices: number[] | null } | null,
  ) => void;
  resetAssetTransform: (id: string) => void;
  setAssetCollider: (id: string, collider: ColliderSpec | null) => void;

  /**
   * Play mode (phase 4d). When true:
   *   - bodies are dynamic (mass > 0) and the world step actually
   *     moves them
   *   - the asset's transform is the body's transform (physics is
   *     the source of truth during play)
   *   - gizmo, primitive add, upload, collider editor, and undo of
   *     mid-play motion are all disabled
   *
   * `setPlayMode` is the only way to flip this flag. Entering play
   * snapshots the current assets (so a stop+undo reverts the whole
   * play session in one history entry); exiting play writes each
   * body's transform back to its asset and flips bodies back to
   * static.
   */
  playMode: boolean;
  setPlayMode: (play: boolean) => void;
  /**
   * Write a body's position + rotation into the asset graph during
   * play mode. Scale is preserved from the existing asset (the body
   * never owns scale). Called by PhysicsTicker every frame for every
   * dynamic body. Does NOT push history (play is a sandbox; the
   * snapshot is taken once on enter-play). Does NOT clear redo.
   */
  setAssetTransformFromPlay: (
    id: string,
    position: [number, number, number],
    rotation: [number, number, number, EulerOrder],
  ) => void;

  /**
   * Phase 4e: collision log. Newest events at the END of the array
   * (the order cannon-es fired them during stepWorld). Capped at
   * `COLLISION_LOG_LIMIT`; when a push would exceed the cap, the
   * oldest entries are dropped. Persists across play stops so the
   * user can review "what just happened" after stopping; cleared on
   * the next play start.
   *
   * `(a, b)` is canonicalized (a < b by string compare) so the same
   * physical contact produces the same entry regardless of which
   * body's listener fired first. Asset names are looked up by the
   * sidebar at render time, not stored here.
   */
  collisionEvents: CollisionEvent[];
  /** Append new events with a play-clock timestamp; drops oldest if cap exceeded. */
  addCollisionEvents: (
    events: ReadonlyArray<{ a: string; b: string }>,
    atTime: number,
  ) => void;
  /** Play-clock seconds since the current play started. Reset to 0
   *  on setPlayMode(true); ticked each frame by PhysicsTicker. */
  playClock: number;
  tickPlayClock: (dt: number) => void;

  /**
   * Phase 3.2a — true while the user is dragging a vertex handle in
   * EditableMesh. Viewport reads this to disable OrbitControls so the
   * camera doesn't rotate while the user is dragging a vertex. With
   * OrbitControls left enabled, the camera rotates on every pointermove
   * (it listens to canvas DOM events, separate from R3F's event tree),
   * which makes the captured cameraRight / cameraUp basis stale and
   * the vertex appears to "fly" away from the cursor. See EditableMesh
   * onPointerDown / Viewport <OrbitControls enabled={...}>.
   */
  vertexDragging: boolean;
  setVertexDragging: (dragging: boolean) => void;

  /** primitive authoring (phase 3) */
  addPrimitive: (type: PrimitiveType) => void;

  /** transform gizmo mode (phase 3) */
  transformMode: TransformMode;
  setTransformMode: (mode: TransformMode) => void;

  /** axis lock (phase 3.1) — null = unlocked, 'x' / 'y' / 'z' = lock to that axis */
  axisLock: AxisLock;
  setAxisLock: (axis: AxisLock) => void;
  toggleAxisLock: (axis: Exclude<AxisLock, null>) => void;

  /**
   * Phase 3.2c — indices of vertices currently picked for face creation.
   * The user shifts the selection by clicking dots (we add to the set,
   * dedup, drop if already in it). `F` hotkey turns the selection
   * into a triangle/quad fan. Cleared whenever the active asset changes
   * or the user leaves edit mode.
   */
  selectedVertices: number[];
  toggleSelectedVertex: (idx: number) => void;
  clearSelectedVertices: () => void;

  /**
   * Phase 5 — second asset picked for boolean combine. Set when the
   * user explicitly picks "Combine target" from the sidebar; we keep
   * this separate from `activeAssetId` so the gizmo stays on whichever
   * mesh the user is dragging, while the second pick accumulates here.
   */
  combineTargetId: string | null;
  setCombineTarget: (id: string | null) => void;

  /** undo / redo (phase 3.1) */
  history: History;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;

  /**
   * Phase 3.2b/3.2c/5 — incremented when undo/redo rewinds a geometry
   * mutation. Components that own BufferGeometries listen to this
   * counter and the `geometryUndoTargets` list, then write the
   * `geometrySnapshot` arrays back into the live geometry.
   */
  geometryUndoNonce: number;
  geometryUndoTargets: string[];
  canRedo: () => boolean;
  /**
   * Test-only escape hatch: clear both undo and redo stacks. Not used by
   * the UI. Keeps verification scripts from needing to page-reload
   * between cases.
   */
  resetHistoryForTest: () => void;

  /** global busy flag while parsing/loading a file */
  loading: boolean;
  setLoading: (loading: boolean) => void;

  /**
   * Camera-refit requests (phase 4a). The store bumps this counter on
   * addAsset so the Viewport can re-run <Bounds> for the new asset.
   * Decoupled from `setActiveAsset` so selection switches never refit,
   * and decoupled from the F key so we can refit on uploads without
   * a keyboard event.
   */
  refitRequestNonce: number;

  /** free-text error banner */
  error: string | null;
  setError: (error: string | null) => void;
}

/** Snapshot the current assets array onto the undo stack. */
function snapshotHistory(prev: History, current: AssetRef[]): History {
  const past = [...prev.past, current];
  // Cap the stack so we don't grow unbounded.
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

/** Cheap structural equality on a transform triple. */
function transformsEqual(
  a: ObjectTransform,
  b: ObjectTransform,
): boolean {
  return (
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.position[2] === b.position[2] &&
    a.rotation[0] === b.rotation[0] &&
    a.rotation[1] === b.rotation[1] &&
    a.rotation[2] === b.rotation[2] &&
    a.rotation[3] === b.rotation[3] &&
    a.scale[0] === b.scale[0] &&
    a.scale[1] === b.scale[1] &&
    a.scale[2] === b.scale[2]
  );
}

/** Shallow compare of two vertexOffset arrays. null vs null = equal. */
function vertexOffsetsEqual(
  a: number[] | null,
  b: number[] | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const useEditor = create<EditorState>((set, get) => ({
  mode: 'mesh',
  setMode: (mode) =>
    set((s) => {
      // Phase 4d safety net: switching modes mid-play would change
      // which sidebar panels are visible (e.g. the Collider editor),
      // and any pending numeric edit would commit against the wrong
      // UI shape. UI disables mode tabs in play; this guard matches.
      if (s.playMode) return s;
      return mode !== 'edit'
        ? { mode, selectedVertices: [] }
        : { mode };
    }),

  assets: [],
  activeAssetId: null,
  history: { past: [], future: [] },

  addAsset: (asset) =>
    set((s) => {
      // Phase 4d safety net: the UI disables the upload button in
      // play, but we guard here too in case anything ever calls addAsset
      // programmatically (keyboard shortcut, drag-drop race, test).
      // Adding a static asset under a live dynamic world is incoherent.
      if (s.playMode) return s;
      return {
        history: snapshotHistory(s.history, s.assets),
        assets: [...s.assets, asset],
        activeAssetId: asset.id,
        // Refit on every new asset upload. Phase-3 review fix: a single
        // 'first fit' rule left OBJ uploads and post-clear re-uploads
        // unfitted. We don't refit on selection switch or removal —
        // just on add.
        refitRequestNonce: s.refitRequestNonce + 1,
      };
    }),

  removeAsset: (id) =>
    set((s) => {
      // Phase 4d safety net: UI disables the row's × in play mode,
      // but we guard here so a programmatic call can't yank an asset
      // out from under its body mid-simulation. Caller should
      // setPlayMode(false) first.
      if (s.playMode) return s;
      const target = s.assets.find((a) => a.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      const remaining = s.assets.filter((a) => a.id !== id);
      return {
        history: snapshotHistory(s.history, s.assets),
        assets: remaining,
        activeAssetId:
          s.activeAssetId === id ? (remaining[0]?.id ?? null) : s.activeAssetId,
      };
    }),

  setActiveAsset: (id) =>
    set((s) => ({
      activeAssetId: id,
      // Only wipe vertex selection when switching to a DIFFERENT asset.
      // The cube mesh has onClick={onSelect} which fires every time the
      // user clicks the cube body — even when the asset is already
      // active. Resetting selectedVertices on every click made the
      // spheres desync: click cube body (no intent to switch assets)
      // → selection vanishes while the user clearly still owns those
      // vertices. Same-asset click now keeps the selection.
      selectedVertices: s.activeAssetId === id ? s.selectedVertices : [],
    })),

  setAssetTransform: (id, transform) =>
    set((s) => {
      // Phase 4d: in play mode, physics is the source of truth. A
      // gizmo / keyboard / undo path that fires setAssetTransform
      // here would race the body's per-frame write-back. Reject the
      // call so the body wins. (Gizmo is also disabled in play, so
      // this is a safety net, not the primary defense.)
      if (s.playMode) return s;
      return {
        history: snapshotHistory(s.history, s.assets),
        assets: s.assets.map((a) => (a.id === id ? { ...a, transform } : a)),
      };
    }),

  setAssetTransformLive: (id, transform) =>
    set((s) => {
      // Defense in depth: see setAssetTransform. In play mode the
      // body is the source of truth; the gizmo is disabled so this
      // path is unreachable, but we no-op here in case anything
      // else (keyboard, undo of a non-play change) ever calls it.
      if (s.playMode) return s;
      return {
        // Live update during a gizmo drag — no history, no future clear.
        // The drag is committed once on mouse-up via commitTransformDrag.
        assets: s.assets.map((a) => (a.id === id ? { ...a, transform } : a)),
      };
    }),

  commitTransformDrag: (preDragAssets) => {
    const current = get().assets;
    // Quick guard: if the transform didn't actually change (e.g. user
    // clicked the gizmo without dragging), don't pollute the undo stack.
    if (
      preDragAssets.length === current.length &&
      preDragAssets.every((pre, i) => {
        const cur = current[i];
        return (
          cur &&
          cur.id === pre.id &&
          transformsEqual(pre.transform, cur.transform)
        );
      })
    ) {
      return;
    }
    set((s) => {
      const past = [...s.history.past, preDragAssets];
      if (past.length > HISTORY_LIMIT) past.shift();
      return {
        history: { past, future: [] },
      };
    });
  },

  /**
   * Phase 3.2a — vertex edit. Snapshot `preDragAssets` once at the
   * start of a vertex drag; on mouse-up, if any vertexOffset differs
   * from the snapshot, push the snapshot onto the undo stack as a
   * single history entry (mirrors the gizmo drag pattern).
   */
  commitVertexEdit: (preDragAssets: AssetRef[]) => {
    const current = get().assets;
    if (
      preDragAssets.length === current.length &&
      preDragAssets.every((pre, i) => {
        const cur = current[i];
        return (
          cur &&
          cur.id === pre.id &&
          // Vertex edit cares about vertexOffsets, not transform.
          // The transform might also have changed if the user moved
          // the asset during edit mode — that's a separate history
          // entry, captured by commitTransformDrag.
          vertexOffsetsEqual(pre.vertexOffsets, cur.vertexOffsets)
        );
      })
    ) {
      return;
    }
    set((s) => {
      const past = [...s.history.past, preDragAssets];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { history: { past, future: [] } };
    });
  },

  /**
   * Phase 3.2a — update an asset's vertexOffsets in place. Length
   * must be 3 * vertexCount; we don't validate here because the
   * EditableMesh component is the sole caller and matches the count
   * to the underlying BufferGeometry.
   */
  setVertexOffsets: (id: string, offsets: number[] | null) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, vertexOffsets: offsets } : a)),
    })),

  /**
   * Phase 3.2b — synchronize `vertexOffsets` after a hole-fill or
   * make-face operation has grown the geometry. New vertices added by
   * the operation start at zero offset; existing vertex offsets are
   * preserved at their old indices.
   *
   * `positions` is the new full position array (length 3 * newCount).
   * We rebuild offsets = zeros for all new vertices + preserve any
   * pre-existing offsets for vertices whose indices are unchanged.
   */
  setVertexData: (id: string, positions: number[]) =>
    set((s) => ({
      assets: s.assets.map((a) => {
        if (a.id !== id) return a;
        const oldOffsets = a.vertexOffsets ?? [];
        const oldCount = oldOffsets.length / 3;
        const newCount = positions.length / 3;
        const merged: number[] = new Array(newCount * 3).fill(0);
        for (let i = 0; i < Math.min(oldCount, newCount) * 3; i++) {
          merged[i] = oldOffsets[i] ?? 0;
        }
        return { ...a, vertexOffsets: merged };
      }),
    })),

  /**
   * Phase 3.2c — create a face (triangle or quad fan) from the user's
   * current vertex selection. Pre-snapshots assets to the history stack
   * so undo restores pre-face geometry + clears the selection.
   *
   * The actual geometry mutation is done by the caller
   * (`makeFaceOnAsset` in lib/meshOps) BEFORE calling this. We just
   * push the snapshot so Cmd+Z can rewind.
   *
   * `triangleIndices` is the new triangles' vertex indices as a flat
   * array — we use it to detect whether anything actually changed
   * (zero-length array = nothing to do).
   *
   * Snapshot attachment: meshOps calls setGeometrySnapshot BEFORE the
   * mutation, so the current AssetRef has the snapshot and preFaceAssets
   * (captured before setGeometrySnapshot) does not. We attach the
   * current snapshot to the preFaceAssets entry so undo can find it —
   * otherwise GeometryUndoBridge would see `null` on the restored asset
   * and silently skip restoring BufferGeometry.
   *
   * The undo/redo comparison uses `geometryMutationNonce` (not the
   * snapshot reference) precisely because the reference is now shared
   * between cur and pre after this enrichment.
   */
  commitMakeFace: (_id: string, preFaceAssets: AssetRef[], triangleIndices: number[]) =>
    set((s) => {
      if (triangleIndices.length === 0) return s;
      const curAsset = s.assets.find((a) => a.id === _id);
      const snap = curAsset?.geometrySnapshot ?? null;
      const enriched = snap
        ? preFaceAssets.map((a) =>
            a.id === _id ? { ...a, geometrySnapshot: snap } : a,
          )
        : preFaceAssets;
      return {
        history: snapshotHistory(s.history, enriched),
        selectedVertices: [],
        refitRequestNonce: s.refitRequestNonce + 1,
      };
    }),

  /**
   * Set an asset's geometrySnapshot. Pass null to clear it (e.g. when
   * the asset is removed or its geometry is replaced wholesale).
   *
   * Internal note: this is called by meshOps immediately before a
   * destructive mutation. If a snapshot already exists, we leave it
   * alone — the user hasn't rewound past the earlier mutation yet,
   * so the existing snapshot is still the correct undo target.
   */
  setGeometrySnapshot: (id, snapshot) =>
    set((s) => ({
      assets: s.assets.map((a) => {
        if (a.id !== id) return a;
        if (snapshot === null) return { ...a, geometrySnapshot: null };
        // Only set if not already set.
        if (a.geometrySnapshot) return a;
        return { ...a, geometrySnapshot: snapshot };
      }),
    })),

  resetAssetTransform: (id) =>
    set((s) => ({
      history: snapshotHistory(s.history, s.assets),
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, transform: { ...DEFAULT_TRANSFORM } } : a,
      ),
    })),

  setAssetCollider: (id, collider) =>
    set((s) => {
      // Phase 4d safety net: cannon-es can't reliably rebuild a body
      // (or change its shape) mid-step, and the syncBodies path would
      // either crash or leak. UI disables the collider picker AND the
      // numeric editor in play; this guard is belt-and-suspenders.
      if (s.playMode) return s;
      return {
        history: snapshotHistory(s.history, s.assets),
        assets: s.assets.map((a) => (a.id === id ? { ...a, collider } : a)),
      };
    }),

  playMode: false,
  setPlayMode: (play) => {
    const s = get();
    if (s.playMode === play) return;
    if (play) {
      // Entering play: snapshot current assets so a future stop+undo
      // reverts the whole play session in one entry. We don't push
      // history here — the snapshot is consumed by `setPlayMode(false)`
      // when the user actually stops.
      set({
        // The pre-play snapshot lives in history; clearing future is
        // appropriate (any pending redo is invalidated by entering play).
        history: { past: [...s.history.past, s.assets], future: [] },
        playMode: true,
        // De-select so the gizmo doesn't show a stale "active" target
        // once bodies take over. The play-mode UI will indicate state.
        activeAssetId: null,
        // Phase 4e: clear the previous play's collision log + reset
        // the clock. The log is intentionally NOT cleared on stop
        // (so the user can review "what just happened" after stopping),
        // but a fresh play starts a fresh log.
        collisionEvents: [],
        playClock: 0,
      });
    } else {
      // Exiting play: the body → asset writes were already done by
      // PhysicsTicker in the most recent play-mode frame, so the
      // store's assets already reflect each body's final position.
      // We just flip the flag. playClock + collisionEvents are kept
      // so the sidebar can still show "X.Xs ago" relative to the
      // last playClock value (frozen at stop time).
      set({ playMode: false });
    }
  },
  setAssetTransformFromPlay: (id, position, rotation) =>
    set((s) => {
      if (!s.playMode) return s; // safety: only meaningful during play
      return {
        assets: s.assets.map((a) => {
          if (a.id !== id) return a;
          return {
            ...a,
            transform: { ...a.transform, position, rotation },
          };
        }),
      };
    }),

  collisionEvents: [],
  addCollisionEvents: (events, atTime) =>
    set((s) => {
      // Skip the work entirely on no-op calls (the ticker calls this
      // every frame; most frames have zero events).
      if (events.length === 0) return s;
      // Defense in depth: the physics drain canonicalizes (a < b) and
      // dedups, but addCollisionEvents is a public store action — any
      // future caller (Playwright via window.__editor, a future
      // trigger-volume API, etc.) could push raw {a:'z', b:'a'} and
      // produce a duplicate-looking entry in the sidebar. Sort here
      // so the store contract is "always canonical" regardless of
      // caller.
      const stamped = events.map((e) => {
        const [a, b] = e.a < e.b ? [e.a, e.b] : [e.b, e.a];
        return { a, b, t: atTime };
      });
      const next = [...s.collisionEvents, ...stamped];
      if (next.length > COLLISION_LOG_LIMIT) {
        next.splice(0, next.length - COLLISION_LOG_LIMIT);
      }
      return { collisionEvents: next };
    }),

  playClock: 0,
  tickPlayClock: (dt) =>
    set((s) => {
      // Phase 4e: only ticks during play. Editor calls this every
      // frame from PhysicsTicker; we no-op when not in play so a
      // stray call from elsewhere doesn't drift the clock.
      if (!s.playMode) return s;
      return { playClock: s.playClock + dt };
    }),

  // Phase 3.2a — UI flag toggled by EditableMesh around vertex drag
  // (pointerDown sets true, pointerUp / window pointerup / unmount
  // set false). Viewport reads it to disable OrbitControls.
  vertexDragging: false,
  setVertexDragging: (dragging) => set({ vertexDragging: dragging }),

  addPrimitive: (type) => {
    const id = crypto.randomUUID();
    const asset: AssetRef = {
      id,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      format: 'unknown',
      kind: 'mesh',
      source: 'primitive',
      primitiveType: type,
      size: 0,
      loadedAt: Date.now(),
      transform: { ...DEFAULT_TRANSFORM },
      collider: null,
      vertexOffsets: null,
      geometrySnapshot: null,
      geometryMutationNonce: 0,
    };
    set((s) => {
      // Phase 4d safety net: same as addAsset — primitives add an
      // asset, which is incoherent mid-simulation. UI disables the
      // primitive buttons in play.
      if (s.playMode) return s;
      return {
        history: snapshotHistory(s.history, s.assets),
        assets: [...s.assets, asset],
        activeAssetId: id,
        // Match addAsset: every new asset upload triggers a refit.
        refitRequestNonce: s.refitRequestNonce + 1,
      };
    });
  },

  transformMode: 'translate',
  setTransformMode: (mode) => {
    // changing transform mode resets axis lock — locks are per-mode in Blender
    set({ transformMode: mode, axisLock: null });
  },

  axisLock: null,
  setAxisLock: (axis) => set({ axisLock: axis }),
  toggleAxisLock: (axis) =>
    set((s) => ({ axisLock: s.axisLock === axis ? null : axis })),

  // Phase 3.2c — vertex multi-select for face creation.
  selectedVertices: [],
  toggleSelectedVertex: (idx) =>
    set((s) => {
      const next = s.selectedVertices.includes(idx)
        ? s.selectedVertices.filter((v) => v !== idx)
        : [...s.selectedVertices, idx];
      return { selectedVertices: next };
    }),
  clearSelectedVertices: () => set({ selectedVertices: [] }),

  // Phase 5 — boolean target.
  combineTargetId: null,
  setCombineTarget: (id) => set({ combineTargetId: id }),

  undo: () => {
    const { history, assets, activeAssetId, playMode } = get();
    if (history.past.length === 0) return;
    // Phase 4d: undo during play would restore an old asset transform,
    // and the next syncBodies would teleport every body to that old
    // position — visually confusing. Play is a sandbox: the only
    // legitimate undo target is the pre-play snapshot, which the user
    // reaches after Stop. UI also disables the undo button.
    if (playMode) return;
    const prev = history.past[history.past.length - 1];
    const nextPast = history.past.slice(0, -1);

    // Phase 3.2b/3.2c/5 — restore geometry buffers for any asset whose
    // BufferGeometry was mutated between `prev` and current `assets`.
    // We compare geometryMutationNonce (a counter that meshOps bumps on
    // every destructive mutation) instead of snapshot references,
    // because commitMakeFace enriches preAssets with the same snapshot
    // object as cur, so reference equality would always be true.
    const changedAssetIds: string[] = [];
    for (const cur of assets) {
      const pre = prev.find((a) => a.id === cur.id);
      if (!pre) continue;
      if ((cur.geometryMutationNonce ?? 0) !== (pre.geometryMutationNonce ?? 0)) {
        changedAssetIds.push(cur.id);
      }
    }

    set({
      assets: prev,
      history: {
        past: nextPast,
        future: [assets, ...history.future],
      },
      activeAssetId: prev.find((a) => a.id === activeAssetId)
        ? activeAssetId
        : (prev[0]?.id ?? null),
      // Notify the renderer layer to restore geometry buffers.
      // The MeshGeometryBridge (or a small consumer) listens to this
      // counter and writes the buffers back into the live BufferGeometry.
      geometryUndoNonce: get().geometryUndoNonce + 1,
      geometryUndoTargets: changedAssetIds,
    });
  },

  redo: () => {
    const { history, assets, activeAssetId, playMode } = get();
    if (history.future.length === 0) return;
    // Phase 4d: same reasoning as undo — no redo during play.
    if (playMode) return;
    const next = history.future[0];
    const rest = history.future.slice(1);

    // Phase 3.2b/3.2c/5 — see undo() above. Compare nonces (not snapshot
    // refs, which are shared post-commitMakeFace enrichment).
    const changedAssetIds: string[] = [];
    for (const cur of assets) {
      const post = next.find((a) => a.id === cur.id);
      if (!post) continue;
      if ((cur.geometryMutationNonce ?? 0) !== (post.geometryMutationNonce ?? 0)) {
        changedAssetIds.push(cur.id);
      }
    }

    set({
      assets: next,
      history: {
        past: [...history.past, assets],
        future: rest,
      },
      activeAssetId: next.find((a) => a.id === activeAssetId)
        ? activeAssetId
        : (next[0]?.id ?? null),
      geometryUndoNonce: get().geometryUndoNonce + 1,
      geometryUndoTargets: changedAssetIds,
    });
  },

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  // Phase 3.2 — geometry undo hooks.
  geometryUndoNonce: 0,
  geometryUndoTargets: [],

  resetHistoryForTest: () => set({ history: { past: [], future: [] } }),

  loading: false,
  setLoading: (loading) => set({ loading }),

  refitRequestNonce: 0,

  error: null,
  setError: (error) => set({ error }),
}));