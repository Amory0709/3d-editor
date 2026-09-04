/**
 * Per-frame physics + play-clock orchestration, extracted from
 * PhysicsTicker so the loop's sequencing is testable without an R3F
 * <Canvas> (useFrame isn't Node-runnable, but the body of the loop
 * is pure store + physics calls).
 *
 * Exactly mirrors the order PhysicsTicker used to inline:
 *   1. snapshot the editor store (editor → physics sync baseline)
 *   2. syncBodies (editor → physics in edit mode; no-op churn in
 *      steady-state play)
 *   3. in play mode:
 *      a. stepWorld(dt)
 *      b. tickPlayClock(dt) — advance the clock BEFORE draining so
 *         this frame's events get the post-step time
 *      c. read each body back into the store (physics → editor)
 *      d. drain collision events and stamp them with the clock
 *
 * Why this lives in src/lib (not inlined in the component): the
 * Phase-4e collision-timestamp bug shipped because no verification
 * exercised the loop's ordering — each store/physics helper was
 * correct in isolation, but the sequencing (snapshot → tick → drain
 * → stamp) read the clock off the stale snapshot. Hoisting the body
 * here lets scripts/verify-timestamp-bug.mts drive the real loop.
 *
 * Phase notes (the component's docstring used to carry these):
 *   • Edit mode (4b): one-way editor → physics. syncBodies pulls the
 *     latest assets and updates each body's transform; bodies are
 *     static (mass = 0) so there's nothing to step. The world stays
 *     queryable for future features (raycast pick, collision events)
 *     without per-frame work.
 *   • Play mode (4d): one-way physics → editor. syncBodies flips
 *     bodies dynamic and stops touching their transforms. stepWorld
 *     runs the simulation; afterwards we read each body's transform
 *     back into the store via setAssetTransformFromPlay, which the
 *     visual layer (TransformableAsset) follows. Bodies' scale is
 *     left alone — the store keeps the existing scale when
 *     position+rotation are written.
 *   • Play mode (4e): stepWorld fires beginContact events on dynamic
 *     bodies. After the step, we drain the event buffer and push the
 *     entries into the store (with the current playClock as the
 *     timestamp) for the sidebar to render. Tick playClock by dt so
 *     the "X.Xs ago" labels update over time.
 */
import { useEditor } from '@/store/editor';
import {
  drainCollisionEvents,
  readBodiesToAssets,
  stepWorld,
  syncBodies,
} from '@/lib/physics';

export function runPhysicsTick(dt: number): void {
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
      // Read the clock off the LIVE store, not the `state` snapshot
      // captured at the top of the frame. `tickPlayClock(dt)` above
      // called `set()`, so zustand replaced its internal state with a
      // new object; the local `state` ref still points at the
      // PRE-tick object, so `state.playClock` would lag the post-step
      // time the comment intends by exactly one frame's dt. At 60fps
      // formatElapsed's rounding absorbs the ~16ms; but on a dt-spike
      // frame (tab refocus — R3F's clock.getDelta() is unclamped
      // while stepWorld caps its substep at 0.1s), a fresh contact
      // stamped with the pre-spike clock would render as seconds-old
      // the instant it fires and stay skewed for the rest of the play
      // session. `useEditor.getState()` returns the current object.
      state.addCollisionEvents(events, useEditor.getState().playClock);
    }
  }
  // Edit mode: no step. Bodies are static — `syncBodies` already
  // pushed the asset's transform into the body. Stepping a static
  // world is a provable no-op.
}
