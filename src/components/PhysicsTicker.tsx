import { useFrame } from '@react-three/fiber';
import { useEditor } from '@/store/editor';
import {
  readBodiesToAssets,
  stepWorld,
  syncBodies,
} from '@/lib/physics';

/**
 * Headless component that owns the per-frame physics tick. Mounted
 * inside the <Canvas> so it has access to R3F's useFrame.
 *
 * Two modes, driven by `useEditor.getState().playMode`:
 *
 *   • Edit mode (4b): one-way editor → physics. `syncBodies` pulls
 *     the latest assets and updates each body's transform; bodies
 *     are static so `stepWorld` is a no-op. This keeps the engine
 *     "live" so future features (raycast pick, collision events)
 *     can hook in without restructuring the loop.
 *
 *   • Play mode (4d): one-way physics → editor. `syncBodies` flips
 *     bodies dynamic and stops touching their transforms.
 *     `stepWorld` runs the simulation; afterwards we read each
 *     body's transform back into the store via
 *     `setAssetTransformFromPlay`, which the visual layer
 *     (TransformableAsset) follows. Bodies' scale is left alone —
 *     the store keeps the existing scale when position+rotation
 *     are written.
 */
export function PhysicsTicker(): null {
  useFrame((_, dt) => {
    const state = useEditor.getState();
    syncBodies(state.assets, state.playMode);

    if (state.playMode) {
      // Play mode: bodies drive their own transform. After the step,
      // read each body back into the store so the visual layer can
      // follow.
      stepWorld(dt);
      const updates = readBodiesToAssets();
      for (const u of updates) {
        state.setAssetTransformFromPlay(u.assetId, u.position, u.rotation);
      }
    } else {
      // Edit mode: keep the world "live" by stepping (no-op for
      // static bodies, but future dynamic-mixed cases can hook in
      // without a loop restructure).
      stepWorld(dt);
    }
  });
  return null;
}
