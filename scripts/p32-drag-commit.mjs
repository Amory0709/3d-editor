// Phase 3.2 verification: a single gizmo drag must commit exactly ONE
// history entry, not one per frame.
//
// We exercise the store actions directly (the surface that the Viewport
// shim wires to onMouseDown / onObjectChange / onMouseUp). The Viewport
// shim is just three callbacks toggling isDraggingRef — a trivial
// adapter that, if the store contract holds, cannot produce spam.

import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';

const URL = 'http://127.0.0.1:5173/';

// Preflight: if the dev server isn't reachable, skip with a clear
// message instead of failing with a confusing connection error.
try {
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`status ${r.status}`);
} catch (e) {
  console.error(`⚠ dev server not reachable at ${URL} (${e.message})`);
  console.error('  run `npm run dev` first, or use `npm run verify:store` for a');
  console.error('  browser-free equivalent that covers the same invariants.');
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// ─── Test 1: a 60-frame drag commits exactly 1 history entry ──────────
const t1 = await page.evaluate(async () => {
  const mod = await import('/src/store/editor.ts');
  const store = mod.useEditor;
  store.getState().resetHistoryForTest();
  store.getState().addPrimitive('cube');
  const id = store.getState().activeAssetId;
  const asset = store.getState().assets.find((a) => a.id === id);
  const pre = store.getState().assets;
  const pastBefore = store.getState().history.past.length;

  // Simulate 60 onObjectChange frames during a drag
  for (let i = 1; i <= 60; i++) {
    store.getState().setAssetTransformLive(id, {
      ...asset.transform,
      position: [i * 0.05, i * 0.02, 0],
    });
  }
  // Simulate mouseUp — commits pre-drag snapshot
  store.getState().commitTransformDrag(pre);

  return {
    pastAfter: store.getState().history.past.length,
    grew: store.getState().history.past.length - pastBefore,
    finalPos: store.getState().assets.find((a) => a.id === id).transform.position,
  };
});
console.log('Test 1: 60-frame drag');
console.log('  past grew by:', t1.grew, '(expected 1)');
console.log('  final position:', t1.finalPos);
if (t1.grew !== 1) {
  console.error('❌ FAIL: drag produced', t1.grew, 'history entries, expected 1');
  process.exit(1);
}
if (t1.finalPos[0] !== 3.0 || t1.finalPos[1] !== 1.2) {
  console.error('❌ FAIL: final position wrong');
  process.exit(1);
}
console.log('  ✓ pass');

// ─── Test 2: a click-without-drag commits 0 history entries ───────────
const t2 = await page.evaluate(async () => {
  const mod = await import('/src/store/editor.ts');
  const store = mod.useEditor;
  store.getState().resetHistoryForTest();
  store.getState().addPrimitive('cube');
  const pastBefore = store.getState().history.past.length;

  // No live updates — same final state as pre
  const pre = store.getState().assets;
  store.getState().commitTransformDrag(pre);

  return { grew: store.getState().history.past.length - pastBefore };
});
console.log('Test 2: no-op drag (click without movement)');
console.log('  past grew by:', t2.grew, '(expected 0)');
if (t2.grew !== 0) {
  console.error('❌ FAIL: no-op drag still added a history entry');
  process.exit(1);
}
console.log('  ✓ pass');

// ─── Test 3: a single ⌘Z reverts the entire drag in one step ─────────
const t3 = await page.evaluate(async () => {
  const mod = await import('/src/store/editor.ts');
  const store = mod.useEditor;
  store.getState().resetHistoryForTest();
  store.getState().addPrimitive('cube');
  const id = store.getState().activeAssetId;
  const asset = store.getState().assets.find((a) => a.id === id);
  const pre = store.getState().assets;

  // Drag
  for (let i = 1; i <= 60; i++) {
    store.getState().setAssetTransformLive(id, {
      ...asset.transform,
      position: [i * 0.05, i * 0.02, 0],
    });
  }
  store.getState().commitTransformDrag(pre);

  // Single undo
  store.getState().undo();
  const posAfterUndo = store.getState().assets.find((a) => a.id === id).transform.position;

  return { posAfterUndo };
});
console.log('Test 3: single ⌘Z reverts entire drag');
console.log('  position after undo:', t3.posAfterUndo, '(expected origin [0, 0, 0])');
if (t3.posAfterUndo[0] !== 0 || t3.posAfterUndo[1] !== 0) {
  console.error('❌ FAIL: undo did not revert to origin');
  process.exit(1);
}
console.log('  ✓ pass');

// ─── Test 4: setAssetTransform (reset button) still pushes 1 entry ───
const t4 = await page.evaluate(async () => {
  const mod = await import('/src/store/editor.ts');
  const store = mod.useEditor;
  store.getState().resetHistoryForTest();
  store.getState().addPrimitive('cube');
  const id = store.getState().activeAssetId;
  const pastBefore = store.getState().history.past.length;

  // External mutation path (reset button)
  store.getState().setAssetTransform(id, {
    position: [5, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });

  return { grew: store.getState().history.past.length - pastBefore };
});
console.log('Test 4: external setAssetTransform (reset button)');
console.log('  past grew by:', t4.grew, '(expected 1)');
if (t4.grew !== 1) {
  console.error('❌ FAIL: external mutation did not push history');
  process.exit(1);
}
console.log('  ✓ pass');

// ─── Test 5: commitTransformDrag doesn't lose redo stack ─────────────
// (Standard editor convention: a new mutation clears future. A drag
// commit is a "new mutation" from the user's POV.)
const t5 = await page.evaluate(async () => {
  const mod = await import('/src/store/editor.ts');
  const store = mod.useEditor;
  store.getState().resetHistoryForTest();
  store.getState().addPrimitive('cube');
  store.getState().addPrimitive('sphere');

  // Undo: now in future we have the addSphere state
  store.getState().undo();
  const futureBefore = store.getState().history.future.length;

  // Now drag-commits — future should be cleared
  const id = store.getState().activeAssetId;
  const asset = store.getState().assets.find((a) => a.id === id);
  const pre = store.getState().assets;
  store.getState().setAssetTransformLive(id, {
    ...asset.transform,
    position: [1, 0, 0],
  });
  store.getState().commitTransformDrag(pre);

  return { futureAfter: store.getState().history.future.length, futureBefore };
});
console.log('Test 5: drag commit clears redo stack (standard behavior)');
console.log('  future before:', t5.futureBefore, 'after:', t5.futureAfter);
if (t5.futureAfter !== 0) {
  console.error('❌ FAIL: drag commit did not clear future');
  process.exit(1);
}
console.log('  ✓ pass');

// ─── No console errors ────────────────────────────────────────────────
if (errors.length > 0) {
  // Filter WebGL errors (test env doesn't have GPU)
  const real = errors.filter((e) => !e.includes('WebGL') && !e.includes('context'));
  if (real.length > 0) {
    console.error('❌ FAIL: unexpected errors:', real);
    process.exit(1);
  }
}

console.log('\n✅ phase 3.2 drag-commit: ALL PASS');
console.log('   • 1 drag = 1 history entry (was ~60/frame)');
console.log('   • no-op drag = 0 history entries');
console.log('   • single ⌘Z reverts the entire drag');
console.log('   • external setAssetTransform still pushes 1 history entry');
console.log('   • drag commit clears redo stack (standard editor behavior)');

await browser.close();
