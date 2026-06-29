import { useFrame } from '@react-three/fiber';
import { useEditor } from '@/store/editor';
import { stepWorld, syncBodies } from '@/lib/physics';

/**
 * Headless component that owns the per-frame physics tick. Mounted
 * inside the <Canvas> so it has access to R3F's useFrame.
 *
 * Each frame:
 *   1. Read the latest assets snapshot from the store.
 *   2. Reconcile the physics world against the assets (one-way sync:
 *      editor → physics).
 *   3. Step the world forward by the elapsed dt.
 *
 * Bodies are static (mass=0) in phase 4b, so the world step is a no-op
 * for collision resolution — it just keeps the engine "live" so future
 * phase-4d (play mode) and phase-4e (collision events) features can
 * hook in without restructuring the loop.
 */
export function PhysicsTicker(): null {
  useFrame((_, dt) => {
    const assets = useEditor.getState().assets;
    syncBodies(assets);
    stepWorld(dt);
  });
  return null;
}
