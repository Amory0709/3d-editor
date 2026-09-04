/**
 * Regression test for the "primitive geometries leak GPU buffers on
 * unmount (no BufferGeometry.dispose)" bug.
 *
 * Context: `makeGeometry()` (in `src/components/PrimitiveRenderer.tsx`)
 * is the single pipeline that allocates the `BufferGeometry` for a
 * primitive asset. Its owning React component, `PrimitiveEditable` in
 * `src/components/EditableMesh.tsx`, mounts the geometry via R3F
 * `<primitive object={geometry} attach="geometry" />`.
 *
 * Bug (introduced by commit d6f22db): the disposing `useEffect` that
 * lived in the old `<PrimitiveRenderer>` was deleted during the
 * refactor and re-added nowhere. R3F intentionally does NOT dispose
 * objects passed via `<primitive>` ("their state may be kept outside
 * of React!"), so every unmount of `<PrimitiveEditable>` (asset delete,
 * paint-mode toggle) leaked a dead WebGLBuffer until page reload. The
 * stale JSDoc on `makeGeometry` claimed disposal happened "via the
 * useEffect cleanup in EditableMeshBody" — a cleanup that does not
 * exist.
 *
 * Fix: `PrimitiveEditable` now owns a `useEffect(() => () =>
 * geometry.dispose(), [geometry])`, restoring exactly what d6f22db
 * removed, and the JSDoc on `makeGeometry` was corrected.
 *
 * Why a source-level guard + behavioral test: this repo runs its
 * verification as plain-Node `tsx` scripts that import real three.js
 * geometry (no browser, no R3F `<Canvas>`, no @react-three/test-renderer
 * installed — see `scripts/verify-persistent-edits.mts` for the same
 * idiom). Mounting `PrimitiveEditable` is therefore impossible here
 * (its body runs R3F hooks), so we guard the regression two ways:
 *   1. A source-level check that `PrimitiveEditable` contains a
 *      disposing `useEffect` with `[geometry]` deps — the exact line
 *      d6f22db deleted. This would have caught the original bug.
 *   2. A behavioral check that `makeGeometry(...).dispose()` on real
 *      three geometries dispatches the `dispose` event (the mechanism
 *      by which `WebGLAttributes` releases the GPU buffers) and that
 *      distinct primitive geometries do not alias, so disposing one
 *      never corrupts a sibling asset's geometry (critical because
 *      GLB/OBJ geometries are loader-cached and must not be
 *      over-released).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makeGeometry } from '../src/components/PrimitiveRenderer';

const here = dirname(fileURLToPath(import.meta.url));
const editableMeshSrc = readFileSync(
  resolve(here, '../src/components/EditableMesh.tsx'),
  'utf8',
);
const primitiveRendererSrc = readFileSync(
  resolve(here, '../src/components/PrimitiveRenderer.tsx'),
  'utf8',
);

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const PRIMITIVE_TYPES = ['cube', 'sphere', 'cylinder'] as const;

// === Test 1: makeGeometry returns a populated BufferGeometry ===
console.log('Test 1: makeGeometry returns a populated, indexed BufferGeometry for each primitive type');
{
  for (const t of PRIMITIVE_TYPES) {
    const g = makeGeometry(t) as import('three').BufferGeometry;
    const pos = g.getAttribute('position');
    check(`${t}: has a position attribute`,
      !!pos, `attr=${pos ? pos.constructor.name : 'null'}`);
    check(`${t}: position count > 0`, pos && pos.count > 0, `count=${pos?.count}`);
    // dispose immediately so nothing leaks from the test itself
    g.dispose();
  }
}

// === Test 2: BufferGeometry.dispose() dispatches the 'dispose' event ===
console.log('\nTest 2: dispose() dispatches the "dispose" event (the WebGLAttributes release trigger)');
{
  for (const t of PRIMITIVE_TYPES) {
    const g = makeGeometry(t) as import('three').BufferGeometry;
    let fired = 0;
    let target: unknown = null;
    g.addEventListener('dispose', (e: { target?: unknown }) => {
      fired++;
      target = e.target;
    });
    g.dispose();
    check(`${t}: dispose() fires the 'dispose' event exactly once`,
      fired === 1, `fired=${fired}`);
    check(`${t}: event.target is the disposed geometry`,
      target === g, `target===self=${target === g}`);
  }
}

// === Test 3: dispose() is safe to call on every primitive type (no throw) ===
console.log('\nTest 3: dispose() does not throw for any primitive geometry');
{
  for (const t of PRIMITIVE_TYPES) {
    let threw = false;
    try {
      makeGeometry(t).dispose();
    } catch {
      threw = true;
    }
    check(`${t}: dispose() does not throw`, !threw);
  }
}

// === Test 4: distinct primitive geometries do NOT alias (dispose only what you own) ===
console.log('\nTest 4: disposing one primitive geometry never disposes another (no aliasing / no over-release)');
{
  const g1 = makeGeometry('cube') as import('three').BufferGeometry;
  const g2 = makeGeometry('cube') as import('three').BufferGeometry;
  check('makeGeometry returns fresh objects (g1 !== g2)',
    g1 !== g2);

  let g2Disposed = 0;
  g2.addEventListener('dispose', () => { g2Disposed++; });
  const g2CountBefore = g2.getAttribute('position').count;

  g1.dispose(); // dispose the sibling

  check("g2's 'dispose' event did not fire after g1.dispose()",
    g2Disposed === 0, `g2Disposed=${g2Disposed}`);
  check("g2's position attribute survives g1.dispose()",
    g2.getAttribute('position').count === g2CountBefore);
  // dispose never disturbs the index either
  check('g2 still has an index after g1.dispose()',
    g2.index !== null && g2.index !== undefined);

  g2.dispose(); // clean up
  check('g2.dispose() fires its own event exactly once (after g1 was already disposed)',
    g2Disposed === 1, `g2Disposed=${g2Disposed}`);
}

// === Test 5 (regression guard): PrimitiveEditable disposes its geometry ===
// in a useEffect cleanup keyed on [geometry]. This is the exact line that
// commit d6f22db deleted and the fix restores. If someone removes it again,
// this check fails.
console.log('\nTest 5 (d6f22db regression guard): PrimitiveEditable disposes geometry via useEffect([geometry])');
{
  // Slice the PrimitiveEditable function body: from its declaration up to
  // the next top-level `function `.
  const startIdx = editableMeshSrc.indexOf('function PrimitiveEditable(');
  check('EditableMesh.tsx defines PrimitiveEditable', startIdx !== -1);
  const afterStart = editableMeshSrc.slice(startIdx + 1);
  const nextFn = afterStart.indexOf('\nfunction ');
  check('PrimitiveEditable has a closing boundary (next top-level function)',
    nextFn !== -1);
  const body = nextFn !== -1
    ? editableMeshSrc.slice(startIdx, startIdx + 1 + nextFn)
    : editableMeshSrc.slice(startIdx);

  // Permissive-but-specific: a useEffect whose arrow body calls
  // geometry.dispose() and whose dependency array is [geometry].
  const disposeEffect = /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?geometry\.dispose\(\)[\s\S]*?\},\s*\[geometry\]\s*\)/;
  check('PrimitiveEditable contains a useEffect that disposes geometry with [geometry] deps',
    disposeEffect.test(body),
    disposeEffect.test(body) ? '' : 'expected useEffect(() => { ... geometry.dispose() ... }, [geometry]) inside PrimitiveEditable');

  // Defensively assert the dispose call is actually present at all.
  check('PrimitiveEditable calls geometry.dispose()',
    /geometry\.dispose\(\)/.test(body));

  // And that useMemo is still the allocator (the fix didn't move allocation).
  check('PrimitiveEditable still allocates geometry via useMemo([primitiveType])',
    /useMemo\([\s\S]*?makeGeometry\([\s\S]*?\[[\s\S]*?primitiveType[\s\S]*?\]\s*\)/.test(body) ||
      /useMemo\([\s\S]*?makeGeometry\(primitiveType\)[\s\S]*?\[primitiveType\][\s\S]*?\)/.test(body));
}

// === Test 6 (stale-doc guard): PrimitiveRenderer.tsx JSDoc no longer ===
// points at a non-existent EditableMeshBody cleanup.
console.log('\nTest 6 (stale-doc guard): PrimitiveRenderer.tsx lifecycle doc points at PrimitiveEditable');
{
  check('PrimitiveRenderer.tsx no longer claims disposal in EditableMeshBody',
    !/EditableMeshBody/.test(primitiveRendererSrc),
    'stale JSDoc still references EditableMeshBody');
  check('PrimitiveRenderer.tsx attributes disposal to PrimitiveEditable',
    /PrimitiveEditable/.test(primitiveRendererSrc));
  check('PrimitiveRenderer.tsx documents the .dispose() call',
    /\.dispose\(\)/.test(primitiveRendererSrc) || /dispose/.test(primitiveRendererSrc));
  check('PrimitiveRenderer.tsx notes R3F does not auto-dispose primitives',
    /auto-dispose|does not auto-dispose|R3F does not/.test(primitiveRendererSrc));
}

console.log(`\n${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
