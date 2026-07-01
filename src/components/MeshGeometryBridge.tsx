import { useEffect } from 'react';
import type { BufferGeometry } from 'three';
import { BufferAttribute } from 'three';
import { useEditor } from '@/store/editor';

/**
 * Phase 3.2 — module-level registry mapping asset id -> BufferGeometry.
 *
 * Each renderer (GLTFMesh / OBJMesh / PrimitiveRenderer) calls
 * `registerGeometry(id, geometry)` from inside its mount effect.
 * EditableMesh reads via `getGeometry(id)` from inside its useFrame
 * (which already runs every frame, so a stale ref is fine).
 *
 * We deliberately use a module-level Map instead of React state or
 * context: BufferGeometry is a Three.js object with GPU buffers, not
 * a serializable React value. Putting it in zustand would cause spurious
 * re-renders; context would force every consumer to re-render on every
 * keystroke. The Map is read once per frame and is cheap.
 *
 * Lifecycle: when the renderer unmounts, the registry entry is cleared.
 * When the geometry changes (e.g. primitive type switch), the new
 * geometry replaces the old one.
 */

const registry: Map<string, BufferGeometry> = new Map();

export function getGeometry(id: string | null): BufferGeometry | null {
  if (!id) return null;
  return registry.get(id) ?? null;
}

export function registerGeometry(id: string, geometry: BufferGeometry | null): void {
  if (geometry === null) {
    registry.delete(id);
  } else {
    registry.set(id, geometry);
  }
}

/**
 * Component for a renderer to mount inside <Canvas>. Calls
 * `registerGeometry` on mount/unmount and on geometry identity change.
 */
export function GeometryRegistrar({
  assetId,
  geometry,
}: {
  assetId: string;
  geometry: BufferGeometry | null;
}) {
  useEffect(() => {
    registerGeometry(assetId, geometry);
    return () => {
      registerGeometry(assetId, null);
    };
  }, [assetId, geometry]);
  return null;
}

/**
 * Phase 3.2b/3.2c/5 — listen to `geometryUndoNonce` from the store.
 * When undo/redo rewinds a geometry mutation, this writes the
 * `geometrySnapshot` arrays back into the live BufferGeometry so the
 * renderer reflects the rewound state.
 *
 * Mount this once near the Canvas root. It doesn't render anything.
 */
export function GeometryUndoBridge() {
  const nonce = useEditor((s) => s.geometryUndoNonce);
  const targetsKey = useEditor((s) => s.geometryUndoTargets.join(','));

  useEffect(() => {
    // Read fresh state inside the effect (not from selector closures)
    // so we always act on the latest assets array.
    if (nonce === 0) return; // initial mount
    const targets = useEditor.getState().geometryUndoTargets;
    if (targets.length === 0) return;
    const assets = useEditor.getState().assets;
    for (const id of targets) {
      const asset = assets.find((a) => a.id === id);
      if (!asset) continue;
      const geom = getGeometry(id);
      if (!geom) continue;
      const snap = asset.geometrySnapshot;
      if (!snap) {
        // The undo/redo comparison flagged this asset as having a
        // BufferGeometry change, but the asset's snapshot is null.
        // Most likely cause: the asset was mutated by a code path
        // that didn't call setGeometrySnapshot, or the asset was
        // removed and re-added in the same undo step. Log so we can
        // diagnose; skip the restore (nothing to write).
        console.warn(
          `[GeometryUndoBridge] no snapshot for asset ${id} (in geometryUndoTargets); skipping BufferGeometry restore`,
        );
        continue;
      }
      // Restore positions.
      const posArr = new Float32Array(snap.positions);
      const posAttr = geom.getAttribute('position');
      if (posAttr) {
        posAttr.array.set(posArr);
        posAttr.needsUpdate = true;
      } else {
        geom.setAttribute('position', new BufferAttribute(posArr, 3));
      }
      // Restore indices.
      if (snap.indices) {
        const useUint32 = snap.positions.length / 3 > 65535;
        const idxArr = useUint32 ? new Uint32Array(snap.indices) : new Uint16Array(snap.indices);
        geom.setIndex(new BufferAttribute(idxArr, 1));
      } else {
        geom.setIndex(null);
      }
      geom.computeVertexNormals();
      geom.computeBoundingSphere();
    }
  }, [nonce, targetsKey]);
  return null;
}