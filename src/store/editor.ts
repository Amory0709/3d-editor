import { create } from 'zustand';

export type EditorMode = 'mesh' | 'collision' | 'gaussian';

export interface AssetRef {
  /** stable id used as R3F key + state lookup */
  id: string;
  /** original file name */
  name: string;
  /** local object URL (revoked when removed) */
  url: string;
  /** detected format from extension */
  format: 'glb' | 'gltf' | 'obj' | 'splat' | 'ply' | 'spz' | 'unknown';
  /** payload class — drives which renderer/editor to use */
  kind: 'mesh' | 'gaussian';
  /** bytes */
  size: number;
  /** when loaded */
  loadedAt: number;
}

interface EditorState {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;

  assets: AssetRef[];
  activeAssetId: string | null;
  addAsset: (asset: AssetRef) => void;
  removeAsset: (id: string) => void;
  setActiveAsset: (id: string | null) => void;

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
      if (target) URL.revokeObjectURL(target.url);
      const remaining = s.assets.filter((a) => a.id !== id);
      return {
        assets: remaining,
        activeAssetId:
          s.activeAssetId === id ? (remaining[0]?.id ?? null) : s.activeAssetId,
      };
    }),
  setActiveAsset: (id) => set({ activeAssetId: id }),

  loading: false,
  setLoading: (loading) => set({ loading }),

  error: null,
  setError: (error) => set({ error }),
}));

/** detect format from file name; fallback unknown */
export function detectFormat(name: string): AssetRef['format'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.gltf')) return 'gltf';
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.splat')) return 'splat';
  if (lower.endsWith('.ply')) return 'ply';
  if (lower.endsWith('.spz')) return 'spz';
  return 'unknown';
}

/** classify into mesh vs gaussian renderer bucket */
export function classifyKind(format: AssetRef['format']): AssetRef['kind'] {
  if (format === 'splat' || format === 'ply' || format === 'spz') return 'gaussian';
  // glb/gltf/obj/unknown default to mesh
  return 'mesh';
}