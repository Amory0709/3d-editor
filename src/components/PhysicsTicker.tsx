import { useFrame } from '@react-three/fiber';
import { runPhysicsTick } from '@/lib/physicsTick';

/**
 * Headless component that owns the per-frame physics tick. Mounted
 * inside the <Canvas> so it has access to R3F's useFrame.
 *
 * Delegates the actual work to {@link runPhysicsTick} (in
 * src/lib/physicsTick.ts) so the loop's sequencing is unit-testable
 * without an R3F <Canvas> — see scripts/verify-timestamp-bug.mts,
 * which drives the real tick body against the real store + real
 * cannon-es world. See runPhysicsTick's docstring for the per-phase
 * behavior (edit-mode sync, play-mode step + body read-back +
 * collision-event drain).
 */
export function PhysicsTicker(): null {
  useFrame((_, dt) => {
    runPhysicsTick(dt);
  });
  return null;
}
