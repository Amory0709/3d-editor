import { useFrame } from '@react-three/fiber';
import { useEditor } from '@/store/editor';
import {
  drainCollisionEvents,
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
 *     are static (mass = 0) so there's nothing to step. The world
 *     stays queryable for future features (raycast pick, collision
 *     events) without per-frame work.
 *
 *   • Play mode (4d): one-way physics → editor. `syncBodies` flips
 *     bodies dynamic and stops touching their transforms.
 *     `stepWorld` runs the simulation; afterwards we read each
 *     body's transform back into the store via
 *     `setAssetTransformFromPlay`, which the visual layer
 *     (TransformableAsset) follows. Bodies' scale is left alone —
 *     the store keeps the existing scale when position+rotation
 *     are written.
 *
 *   • Play mode (4e): `stepWorld` fires `beginContact` events on
 *     dynamic bodies. After the step, we drain the event buffer and
 *     push the entries into the store (with the current playClock
 *     as the timestamp) for the sidebar to render. Tick playClock
 *     by dt so "X.Xs ago" labels update over time.
 */
export function PhysicsTicker(): null {
  useFrame((_, dt) => {
    const state = useEditor.getState();
    syncBodies(state.assets, state.playMode);

    if (state.playMode) {
      // Play mode: bodies drive their own transform. After the step,
      // read each body back into the store so the visual layer can
      // follow. The next setPlayMode(false) call will leave assets
      // already at the body's final position.
      stepWorld(dt);
      // Phase 4e: advance the play clock BEFORE draining so the
      // timestamps on this frame's events match the post-step time
      // (so a "0.1s ago" event was 0.1s before this frame).
      state.tickPlayClock(dt);
      const updates = readBodiesToAssets();
      for (const u of updates) {
        state.setAssetTransformFromPlay(u.assetId, u.position, u.rotation);
      }
      const events = drainCollisionEvents();
      if (events.length > 0) {
        state.addCollisionEvents(events, state.playClock);
      }
    }
    // Edit mode: no step. Bodies are static — `syncBodies` already
    // pushed the asset's transform into the body. Stepping a static
    // world is a provable no-op.
  });
  return null;
}
