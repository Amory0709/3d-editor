import { create } from 'zustand';
import { GAUSSIAN_FORMATS, type AssetFormat, type AssetKind, type PrimitiveType } from '@/lib/formats';

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

  /** primitive authoring (phase 3) */
  addPrimitive: (type: PrimitiveType) => void;

  /** transform gizmo mode (phase 3) */
  transformMode: TransformMode;
  setTransformMode: (mode: TransformMode) => void;

  /** global busy flag while parsing/loading a file */
  loading: boolean;
  setLoading: (loading: boolean) => void;

  /** free-text error banner */
  error: string | null;
  setError: (error: string | null) => void;
}

export const useEditor = create<EditorState>((set) => ({
  mode: 'mesh',
  setMode: (mode) => set({ mode }),

  assets: [],
  activeAssetId: null,

  addAsset: (asset) =>
    set((s) => ({
      assets: [...s.assets, asset],
      activeAssetId: asset.id,
    })),

  removeAsset: (id) =>
    set((s) => {
      const target = s.assets.find((a) => a.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      const remaining = s.assets.filter((a) => a.id !== id);
      return {
        assets: remaining,
        activeAssetId:
          s.activeAssetId === id ? (remaining[0]?.id ?? null) : s.activeAssetId,
      };
    }),

  setActiveAsset: (id) => set({ activeAssetId: id }),

  setAssetTransform: (id, transform) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, transform } : a)),
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
    };
    set((s) => ({
      assets: [...s.assets, asset],
      activeAssetId: id,
    }));
  },

  transformMode: 'translate',
  setTransformMode: (mode) => set({ transformMode: mode }),

  loading: false,
  setLoading: (loading) => set({ loading }),

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