import { create } from 'zustand';
import {
  GAUSSIAN_FORMATS,
  type AssetFormat,
  type AssetKind,
  type ColliderSpec,
  type PrimitiveType,
} from '@/lib/formats';

/** Object transform in world space, stored per asset. */
export interface ObjectTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export const DEFAULT_TRANSFORM: ObjectTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

export type TransformMode = 'translate' | 'rotate' | 'scale';

export type EditorMode = 'mesh' | 'collision' | 'gaussian';

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
  resetAssetTransform: (id: string) => void;
  setAssetCollider: (id: string, collider: ColliderSpec | null) => void;

  /** primitive authoring (phase 3) */
  addPrimitive: (type: PrimitiveType) => void;

  /** transform gizmo mode (phase 3) */
  transformMode: TransformMode;
  setTransformMode: (mode: TransformMode) => void;

  /** axis lock (phase 3.1) — null = unlocked, 'x' / 'y' / 'z' = lock to that axis */
  axisLock: AxisLock;
  setAxisLock: (axis: AxisLock) => void;
  toggleAxisLock: (axis: Exclude<AxisLock, null>) => void;

  /** undo / redo (phase 3.1) */
  history: History;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
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
    a.scale[0] === b.scale[0] &&
    a.scale[1] === b.scale[1] &&
    a.scale[2] === b.scale[2]
  );
}

export const useEditor = create<EditorState>((set, get) => ({
  mode: 'mesh',
  setMode: (mode) => set({ mode }),

  assets: [],
  activeAssetId: null,
  history: { past: [], future: [] },

  addAsset: (asset) =>
    set((s) => ({
      history: snapshotHistory(s.history, s.assets),
      assets: [...s.assets, asset],
      activeAssetId: asset.id,
      // Refit on every new asset upload. Phase-3 review fix: a single
      // 'first fit' rule left OBJ uploads and post-clear re-uploads
      // unfitted. We don't refit on selection switch or removal —
      // just on add.
      refitRequestNonce: s.refitRequestNonce + 1,
    })),

  removeAsset: (id) =>
    set((s) => {
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

  setActiveAsset: (id) => set({ activeAssetId: id }),

  setAssetTransform: (id, transform) =>
    set((s) => ({
      history: snapshotHistory(s.history, s.assets),
      assets: s.assets.map((a) => (a.id === id ? { ...a, transform } : a)),
    })),

  setAssetTransformLive: (id, transform) =>
    set((s) => ({
      // Live update during a gizmo drag — no history, no future clear.
      // The drag is committed once on mouse-up via commitTransformDrag.
      assets: s.assets.map((a) => (a.id === id ? { ...a, transform } : a)),
    })),

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

  resetAssetTransform: (id) =>
    set((s) => ({
      history: snapshotHistory(s.history, s.assets),
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, transform: { ...DEFAULT_TRANSFORM } } : a,
      ),
    })),

  setAssetCollider: (id, collider) =>
    set((s) => ({
      history: snapshotHistory(s.history, s.assets),
      assets: s.assets.map((a) => (a.id === id ? { ...a, collider } : a)),
    })),

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
    };
    set((s) => ({
      history: snapshotHistory(s.history, s.assets),
      assets: [...s.assets, asset],
      activeAssetId: id,
      // Match addAsset: every new asset upload triggers a refit.
      refitRequestNonce: s.refitRequestNonce + 1,
    }));
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

  undo: () => {
    const { history, assets, activeAssetId } = get();
    if (history.past.length === 0) return;
    const prev = history.past[history.past.length - 1];
    const nextPast = history.past.slice(0, -1);
    set({
      assets: prev,
      history: {
        past: nextPast,
        future: [assets, ...history.future],
      },
      activeAssetId: prev.find((a) => a.id === activeAssetId)
        ? activeAssetId
        : (prev[0]?.id ?? null),
    });
  },

  redo: () => {
    const { history, assets, activeAssetId } = get();
    if (history.future.length === 0) return;
    const next = history.future[0];
    const rest = history.future.slice(1);
    set({
      assets: next,
      history: {
        past: [...history.past, assets],
        future: rest,
      },
      activeAssetId: next.find((a) => a.id === activeAssetId)
        ? activeAssetId
        : (next[0]?.id ?? null),
    });
  },

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  resetHistoryForTest: () => set({ history: { past: [], future: [] } }),

  loading: false,
  setLoading: (loading) => set({ loading }),

  refitRequestNonce: 0,

  error: null,
  setError: (error) => set({ error }),
}));

/** Pure helpers (also re-exported from lib/formats for backward compat). */
export function detectFormat(name: string): AssetFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.gltf')) return 'gltf';
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.splat')) return 'splat';
  if (lower.endsWith('.ply')) return 'ply';
  if (lower.endsWith('.spz')) return 'spz';
  return 'unknown';
}

export function classifyKind(format: AssetFormat): AssetKind {
  return GAUSSIAN_FORMATS.has(format) ? 'gaussian' : 'mesh';
}