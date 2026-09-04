/**
 * Pure-Node store verification for the Phase 4f / Paint flow.
 *
 * Run with:
 *   npx tsx --tsconfig ./tsconfig.app.json scripts/verify-paint.mts
 *
 * Covers the STORE contract that feeds PaintPart (src/components/PaintMesh.tsx):
 *   • setMeshColor writes / updates per-mesh overrides
 *   • clearMeshColors ("Reset all colors") clears them to undefined
 *   • THE RE-RENDER CONTRACT (bug report §4): the reset path returns a NEW
 *     assets array AND a NEW asset object so the default Object.is Zustand
 *     selector in Viewport re-renders PaintMesh → PaintBody → PaintPart with
 *     `overrideColor === undefined` over a stable `source` (keyed by
 *     source.uuid). This is the input the R3F material fix depends on;
 *     without this re-render the component fix could never observe the reset.
 *   • undo restores cleared overrides; play-mode guards; no-op idempotence.
 *
 * NOTE: this script exercises the STORE only. It cannot reach the R3F
 * material attach/detach side effect that the actual bug fix addresses
 * (R3F `<primitive object={material} attach="material" />` mutates
 * `source.material` on attach, restores on detach). That side effect is
 * verified by the R3F reconciler test in the accompanying test plan, which
 * requires `@react-three/test-renderer` + a DOM env (happy-dom) — not
 * installable in the pure-Node sandbox this script targets.
 */
import { useEditor, DEFAULT_TRANSFORM } from '@/store/editor';
import type { AssetRef } from '@/store/editor';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];
function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

function makeGlb(id: string, name = 'test.glb'): AssetRef {
  return {
    id,
    name,
    url: `blob:http://localhost/${id}`,
    format: 'glb',
    kind: 'mesh',
    source: 'file',
    size: 0,
    loadedAt: 0,
    transform: { ...DEFAULT_TRANSFORM },
    collider: null,
    vertexOffsets: null,
    geometrySnapshot: null,
    geometryMutationNonce: 0,
  };
}

function glb(id: string): AssetRef {
  const a = useEditor.getState().assets.find((x) => x.id === id);
  if (!a) throw new Error(`asset ${id} missing from store`);
  return a;
}

console.log('── phase 4f / paint: setMeshColor + clearMeshColors ──');

// 1. setMeshColor writes a per-mesh override, creating the map.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p1'));
  const before = glb('p1').meshColors;
  useEditor.getState().setMeshColor('p1', 'Wheel', '#ff0000');
  const after = glb('p1').meshColors;
  check(
    '1. setMeshColor writes meshColors[name]=color',
    after?.Wheel === '#ff0000',
    `before=${before ?? 'undef'} after=${JSON.stringify(after)}`,
  );
  check(
    '1b. setMeshColor creates the meshColors map (undefined → object)',
    before === undefined && after !== undefined,
    `before=${before ?? 'undef'} after=${after === undefined ? 'undef' : 'obj'}`,
  );
}

// 2. setMeshColor with the same color is a no-op (unchanged assets ref).
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p2'));
  useEditor.getState().setMeshColor('p2', 'Wheel', '#ff0000');
  const s1 = useEditor.getState().assets;
  useEditor.getState().setMeshColor('p2', 'Wheel', '#ff0000');
  const s2 = useEditor.getState().assets;
  check('2. setMeshColor same color is a no-op', s1 === s2, `assets ref identical: ${s1 === s2}`);
}

// 3. Multiple overrides coexist without dropping earlier keys.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p3'));
  useEditor.getState().setMeshColor('p3', 'Wheel', '#ff0000');
  useEditor.getState().setMeshColor('p3', 'Body', '#00ff00');
  const mc = glb('p3').meshColors;
  check(
    '3. multiple overrides coexist',
    mc?.Wheel === '#ff0000' && mc?.Body === '#00ff00',
    JSON.stringify(mc),
  );
}

// 4. setMeshColor updates an existing key to a new color.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p4'));
  useEditor.getState().setMeshColor('p4', 'Wheel', '#ff0000');
  useEditor.getState().setMeshColor('p4', 'Wheel', '#0000ff');
  check(
    '4. setMeshColor updates existing key',
    glb('p4').meshColors?.Wheel === '#0000ff',
    JSON.stringify(glb('p4').meshColors),
  );
}

// 5. clearMeshColors sets meshColors to undefined.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p5'));
  useEditor.getState().setMeshColor('p5', 'Wheel', '#ff0000');
  useEditor.getState().setMeshColor('p5', 'Body', '#00ff00');
  useEditor.getState().clearMeshColors('p5');
  check(
    '5. clearMeshColors sets meshColors to undefined',
    glb('p5').meshColors === undefined,
    JSON.stringify(glb('p5').meshColors),
  );
}

// 6. clearMeshColors is a no-op when there are no overrides.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p6'));
  const s1 = useEditor.getState().assets;
  useEditor.getState().clearMeshColors('p6');
  const s2 = useEditor.getState().assets;
  check('6. clearMeshColors no-op when no overrides', s1 === s2, `assets ref identical: ${s1 === s2}`);
}

// 7. clearMeshColors is a no-op for a missing asset.
{
  useEditor.getState().resetHistoryForTest();
  const s1 = useEditor.getState().assets;
  useEditor.getState().clearMeshColors('does-not-exist');
  const s2 = useEditor.getState().assets;
  check('7. clearMeshColors no-op for missing asset', s1 === s2, `assets ref identical: ${s1 === s2}`);
}

// 8–10. THE RE-RENDER CONTRACT: reset returns a NEW assets array AND a NEW
// asset object so Viewport's default Object.is selector re-renders.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p8'));
  useEditor.getState().setMeshColor('p8', 'Wheel', '#ff0000');
  const assetsBefore = useEditor.getState().assets;
  const assetBefore = assetsBefore.find((a) => a.id === 'p8')!;
  useEditor.getState().clearMeshColors('p8');
  const assetsAfter = useEditor.getState().assets;
  const assetAfter = assetsAfter.find((a) => a.id === 'p8')!;
  check(
    '8. clearMeshColors returns a NEW assets array (Viewport Object.is selector re-renders)',
    assetsBefore !== assetsAfter,
    `same ref: ${assetsBefore === assetsAfter}`,
  );
  check(
    '9. clearMeshColors returns a NEW asset object (PaintMesh gets a new `asset` prop)',
    assetBefore !== assetAfter,
    `same ref: ${assetBefore === assetAfter}`,
  );
  check(
    '10. reset asset has meshColors === undefined',
    assetAfter.meshColors === undefined,
    JSON.stringify(assetAfter.meshColors),
  );
}

// 11–12. undo restores the cleared overrides.
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p9'));
  useEditor.getState().setMeshColor('p9', 'Wheel', '#ff0000');
  useEditor.getState().clearMeshColors('p9');
  check('11. before undo: meshColors undefined', glb('p9').meshColors === undefined);
  useEditor.getState().undo();
  check(
    '12. undo restores meshColors',
    glb('p9').meshColors?.Wheel === '#ff0000',
    JSON.stringify(glb('p9').meshColors),
  );
}

// 13–14. play-mode guards (paint edits are not allowed during simulation).
{
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().addAsset(makeGlb('p10'));
  useEditor.getState().setMeshColor('p10', 'Wheel', '#ff0000');
  useEditor.getState().setPlayMode(true);
  const sEnter = useEditor.getState().assets;
  useEditor.getState().setMeshColor('p10', 'Wheel', '#00ff00');
  const sAfterSet = useEditor.getState().assets;
  check(
    '13. setMeshColor is a no-op in play mode',
    sEnter === sAfterSet && glb('p10').meshColors?.Wheel === '#ff0000',
    `Wheel=${glb('p10').meshColors?.Wheel}`,
  );
  useEditor.getState().clearMeshColors('p10');
  const sAfterClear = useEditor.getState().assets;
  check(
    '14. clearMeshColors is a no-op in play mode',
    sAfterSet === sAfterClear && glb('p10').meshColors?.Wheel === '#ff0000',
    `Wheel=${glb('p10').meshColors?.Wheel}`,
  );
  useEditor.getState().setPlayMode(false);
}

// ─── Summary ────────────────────────────────────────────────────────
const passed = RESULTS.filter((r) => r.pass).length;
const failed = RESULTS.length - passed;

console.log('\n── results ──');
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
