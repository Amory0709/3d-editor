/**
 * Regression test for the Phase-4e collision-timestamp bug.
 *
 * Bug: PhysicsTicker stamped each frame's collision events with
 * `state.playClock`, where `state` was the zustand snapshot captured
 * at the top of the frame. Because `tickPlayClock(dt)` calls `set()`
 * (zustand replaces its internal state with a new object), the
 * local `state` ref still pointed at the PRE-tick object, so every
 * event's `t` lagged the live clock by exactly one frame's `dt`.
 * Invisible at 60fps (formatElapsed's "just now" bucket absorbs ~16ms),
 * but a collision firing on a dt-spike frame (tab refocus — R3F's
 * clock.getDelta() is unclamped while stepWorld caps its substep at
 * 0.1s) was stamped with the PRE-spike clock and immediately rendered
 * as seconds-old.
 *
 * This script drives the REAL per-frame loop body (`runPhysicsTick` in
 * src/lib/physicsTick.ts — extracted from PhysicsTicker so it's
 * testable without an R3F <Canvas>) against the real `useEditor`
 * store and a real cannon-es collision. It does NOT synthesize event
 * arrays; beginContact is fired by the engine.
 *
 * Run:
 *   npx tsx --tsconfig ./tsconfig.app.json scripts/verify-timestamp-bug.mts
 *
 * Pure-Node + tsx; no browser / dev server / playwright needed.
 */
import { useEditor } from '@/store/editor';
import { DEFAULT_COLLIDER } from '@/lib/formats';
import { runPhysicsTick } from '@/lib/physicsTick';
import {
  drainCollisionEvents,
  resetPhysicsWorld,
  syncBodies,
} from '@/lib/physics';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];

function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

/** Verbatim copy of Sidebar.tsx's formatElapsed — the label the user
 *  sees in the collision log is `formatElapsed(playClock - e.t)`. */
function formatElapsed(seconds: number): string {
  if (seconds <= 0.05) return 'just now';
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms ago`;
  if (seconds < 60) return `${seconds.toFixed(1)}s ago`;
  return `${(seconds / 60).toFixed(1)}m ago`;
}

/** Add a cube + sphere, overlapping, ready to collide on the first
 *  step. Returns once both bodies are built (synced static). */
function setupOverlap(): { cubeId: string; sphereId: string } {
  useEditor.getState().addPrimitive('cube');
  const cubeId = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(cubeId, DEFAULT_COLLIDER.box);
  useEditor.getState().addPrimitive('sphere');
  const sphereId = useEditor.getState().activeAssetId!;
  useEditor.getState().setAssetCollider(sphereId, DEFAULT_COLLIDER.sphere);
  // Cube at origin (top face y=0.5). Sphere center y=0.9, radius 0.6,
  // bottom y=0.3 — penetrating the cube's top. The first stepWorld
  // fires beginContact (confirmed by verify-physics.mts test 31 using
  // this exact geometry).
  useEditor.getState().setAssetTransform(cubeId, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  useEditor.getState().setAssetTransform(sphereId, {
    position: [0, 0.9, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
  });
  return { cubeId, sphereId };
}

function reset(): void {
  useEditor.getState().resetHistoryForTest();
  if (useEditor.getState().playMode) {
    useEditor.setState({ playMode: false, activeAssetId: null });
    syncBodies(useEditor.getState().assets, false);
  } else {
    useEditor.setState({ activeAssetId: null });
  }
  const ids = useEditor.getState().assets.map((a) => a.id);
  for (const id of ids) useEditor.getState().removeAsset(id);
  // Clear any leftover log + clock so a stale value from a prior case
  // can't bleed into assertions (setPlayMode(false) keeps them for the
  // user to review; tests need a clean slate).
  useEditor.setState({ collisionEvents: [], playClock: 0 });
  resetPhysicsWorld();
  drainCollisionEvents();
}

const DT = 1 / 60;

// ─── Test 1: normal frame stamps events with POST-tick clock ───────
// The fix: read `useEditor.getState().playClock` (live) at drain time,
// not the stale `state.playClock` snapshot. After a 1/60s tick the
// live clock == DT, so the event must be stamped at DT (not 0).
{
  reset();
  setupOverlap();
  useEditor.getState().setPlayMode(true); // resets playClock=0, log=[]
  syncBodies(useEditor.getState().assets, true);

  const preTickSnapshot = useEditor.getState().playClock; // 0
  runPhysicsTick(DT);
  const livePost = useEditor.getState().playClock; // DT
  const events = useEditor.getState().collisionEvents;

  check(
    '1a. real runPhysicsTick produced an engine-driven collision (events=1)',
    events.length === 1,
    `events=${events.length}`,
  );
  check(
    '1b. event.t == POST-tick playClock (the live store value, the fix)',
    events.length === 1 && approx(events[0].t, livePost),
    `event.t=${events[0]?.t} livePost=${livePost}`,
  );
  check(
    '1c. event.t != pre-tick (not the stale snapshot value 0)',
    events.length === 1 && !approx(events[0].t, preTickSnapshot),
    `event.t=${events[0]?.t} preTick=${preTickSnapshot}`,
  );
  check(
    '1d. event does NOT lag the live clock by one frame (lag ≈ 0, not dt)',
    events.length === 1 && approx(livePost - events[0].t, 0),
    `lag=${livePost - (events[0]?.t ?? 0)} dt=${DT}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 2: dt-spike frame no longer renders a fresh contact as seconds-old ──
// Headline scenario: a 3.0s tab-refocus dt reaches runPhysicsTick.
// stepWorld caps its substep at 0.1s, but a fresh contact forming
// within that window still fires beginContact on the spike frame.
// Pre-fix the event was stamped with the PRE-spike clock (0) and
// immediately read "3.0s ago"; post-fix it's stamped at 3.0 ("just now").
{
  reset();
  setupOverlap();
  useEditor.getState().setPlayMode(true); // playClock=0
  syncBodies(useEditor.getState().assets, true);

  runPhysicsTick(3.0); // spike dt
  const liveClockSpike = useEditor.getState().playClock; // 3.0
  const events = useEditor.getState().collisionEvents;

  check(
    '2a. spike frame produced a collision (fresh contact within 0.1s substep window)',
    events.length === 1,
    `events=${events.length}`,
  );
  check(
    '2b. spike-frame event.t == post-tick clock (3.0), NOT pre-spike (0)',
    events.length === 1 && approx(events[0].t, 3.0) && !approx(events[0].t, 0),
    `event.t=${events[0]?.t} liveClock=${liveClockSpike}`,
  );
  const labelSpike = formatElapsed(liveClockSpike - events[0].t);
  check(
    '2c. on the spike frame, the just-fired event reads "just now" (NOT "3.0s ago")',
    labelSpike === 'just now',
    `label="${labelSpike}" event.t=${events[0]?.t} liveClock=${liveClockSpike}`,
  );

  // Next normal frame: the spike event must stay correct (the offset
  // does NOT persist for that event). Pre-fix it would still read
  // "3.0s ago" here because e.t was 0 while the clock kept advancing.
  runPhysicsTick(DT);
  const liveClockNext = useEditor.getState().playClock; // 3.0 + 1/60
  const eventsAfter = useEditor.getState().collisionEvents;
  const labelNext = formatElapsed(liveClockNext - eventsAfter[0].t);
  check(
    '2d. on the next normal frame, the spike event is still "just now" (offset does not persist)',
    eventsAfter.length === 1 &&
      approx(eventsAfter[0].t, 3.0) &&
      labelNext === 'just now',
    `label="${labelNext}" event.t=${eventsAfter[0]?.t} liveClock=${liveClockNext}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Test 3: format layer absorbs 1-dt on normal frames, exposes spikes ──
// Disambiguates why the bug went unnoticed: formatElapsed's <=0.05s
// "just now" bucket and 1-decimal rounding absorb a 16ms offset, so a
// normal-frame event renders byte-identically to the fixed version,
// while a multi-second spike offset is fully visible. Locks in that
// contract so a future tweak to the threshold can't silently re-mask.
{
  check(
    '3a. normal-frame 1-dt offset (1/60s) absorbed → "just now"',
    formatElapsed(DT) === 'just now',
    `label="${formatElapsed(DT)}"`,
  );
  check(
    '3b. spike offset (3.0s) visible → "3.0s ago" (the bug-mask the threshold provides)',
    formatElapsed(3.0) === '3.0s ago',
    `label="${formatElapsed(3.0)}"`,
  );
}

// ─── Test 4: the snapshot is provably stale (test is sensitive) ────
// Proves the test isn't vacuous: capturing the store via getState(),
// then mutating via the snapshot's own action, leaves the snapshot's
// scalar fields at their pre-mutation values. This is exactly the
// zustand mechanism that made `state.playClock` read the pre-tick
// value. If this ever changes (e.g. zustand mutates in place), the
// bug would resurface differently and these checks flag it.
{
  reset();
  useEditor.getState().setPlayMode(true); // playClock=0

  const snap = useEditor.getState(); // the exact pattern PhysicsTicker used
  const pre = snap.playClock; // 0
  snap.tickPlayClock(DT); // mutates the store via set()
  const livePost = useEditor.getState().playClock; // DT
  const snapAfter = snap.playClock; // still the OLD object

  check(
    '4a. snapshot.playClock unchanged by the in-frame tick (stale)',
    approx(snapAfter, pre) && approx(pre, 0),
    `snap=${snapAfter} pre=${pre}`,
  );
  check(
    '4b. live (getState()) playClock advanced by dt',
    approx(livePost, DT),
    `live=${livePost} dt=${DT}`,
  );
  check(
    '4c. snapshot diverges from live store (the exact staleness the fix sidesteps)',
    !approx(snapAfter, livePost),
    `snap=${snapAfter} live=${livePost}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Summary ──────────────────────────────────────────────────────
const passed = RESULTS.filter((r) => r.pass).length;
const failed = RESULTS.length - passed;
console.log('── timestamp-bug verification ──\n');
for (const r of RESULTS) {
  const icon = r.pass ? '✓' : '✗';
  const detail = r.detail ? ` (${r.detail})` : '';
  console.log(`  ${icon} ${r.name}${detail}`);
}
console.log(`\n${passed}/${RESULTS.length} pass`);
if (failed > 0) {
  console.error(`\n❌ ${failed} FAIL`);
  process.exit(1);
}
console.log(`\n✅ ALL PASS`);
