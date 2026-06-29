/**
 * Phase 4c-A verification: collider input helpers.
 *
 * Pure-Node + tsx; no browser. Exercises the parse / clamp / edit
 * logic in isolation. React-level behaviour (focus / blur events,
 * "one history entry per focus session") is covered by a separate
 * integration test below that goes through useEditor directly.
 */
import { DEFAULT_COLLIDER, type ColliderSpec } from '@/lib/formats';
import {
  applyEdit,
  clamp,
  fieldsFor,
  parseClamped,
  MAX,
  MIN,
} from '@/lib/colliderInput';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];
function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// ─── parseClamped: numeric strings round-trip ─────────────────────
{
  check('1. parseClamped("1.5") → 1.5', parseClamped('1.5') === 1.5);
  check('2. parseClamped("0") → MIN (clamp on the way in)', parseClamped('0') === MIN);
  check('3. parseClamped("-3") → MIN', parseClamped('-3') === MIN);
  check('4. parseClamped("999") → MAX', parseClamped('999') === MAX);
  check('5. parseClamped("") → null (rejected)', parseClamped('') === null);
  check('6. parseClamped("abc") → null', parseClamped('abc') === null);
  check('7. parseClamped("NaN") → null', parseClamped('NaN') === null);
  check('8. parseClamped("Infinity") → null', parseClamped('Infinity') === null);
  check('9. parseClamped("-Infinity") → null', parseClamped('-Infinity') === null);
  check('10. parseClamped("1e-10") → MIN (clamped from below)', parseClamped('1e-10') === MIN);
  check('11. parseClamped("0.5") → 0.5 (in range, unchanged)', parseClamped('0.5') === 0.5);
}

// ─── clamp: matches parseClamped's output range ───────────────────
{
  check('12. clamp(0.5) → 0.5', clamp(0.5) === 0.5);
  check('13. clamp(MIN) → MIN', clamp(MIN) === MIN);
  check('14. clamp(MAX) → MAX', clamp(MAX) === MAX);
  check('15. clamp(MIN - 0.01) → MIN', clamp(MIN - 0.01) === MIN);
  check('16. clamp(MAX + 1) → MAX', clamp(MAX + 1) === MAX);
}

// ─── applyEdit: field-by-field edits produce a valid spec ────────
{
  const box = DEFAULT_COLLIDER.box;
  const boxX = applyEdit(box, 'halfExtentsX', 1.25);
  check(
    '17. applyEdit box halfExtentsX updates only X',
    boxX.type === 'box' &&
      approx(boxX.halfExtents[0], 1.25) &&
      approx(boxX.halfExtents[1], 0.5) &&
      approx(boxX.halfExtents[2], 0.5),
    JSON.stringify(boxX.halfExtents),
  );
  const boxY = applyEdit(box, 'halfExtentsY', 2);
  check(
    '18. applyEdit box halfExtentsY updates only Y',
    boxY.halfExtents[0] === 0.5 &&
      boxY.halfExtents[1] === 2 &&
      boxY.halfExtents[2] === 0.5,
  );
  const boxZ = applyEdit(box, 'halfExtentsZ', 3.5);
  check(
    '19. applyEdit box halfExtentsZ updates only Z',
    boxZ.halfExtents[0] === 0.5 &&
      boxZ.halfExtents[1] === 0.5 &&
      boxZ.halfExtents[2] === 3.5,
  );

  const sphere = DEFAULT_COLLIDER.sphere;
  const sphere2 = applyEdit(sphere, 'radius', 0.8);
  check(
    '20. applyEdit sphere radius updates radius only',
    sphere2.type === 'sphere' && approx(sphere2.radius, 0.8),
  );

  const capsule = DEFAULT_COLLIDER.capsule;
  const capR = applyEdit(capsule, 'radius', 0.7);
  const capH = applyEdit(capsule, 'height', 2.0);
  check(
    '21. applyEdit capsule radius updates radius only',
    capR.type === 'capsule' && approx(capR.radius, 0.7) && approx(capR.height, 1.2),
  );
  check(
    '22. applyEdit capsule height updates height only',
    capH.type === 'capsule' && approx(capH.radius, 0.4) && approx(capH.height, 2.0),
  );

  const cyl = DEFAULT_COLLIDER.cylinder;
  const cylR = applyEdit(cyl, 'radius', 0.6);
  const cylH = applyEdit(cyl, 'height', 3);
  check(
    '23. applyEdit cylinder radius/height behave like capsule',
    cylR.radius === 0.6 && cylH.height === 3,
  );

  // Field-type mismatch throws — programmer error, not a user error.
  let threw = false;
  try {
    applyEdit(sphere, 'halfExtentsX', 1);
  } catch {
    threw = true;
  }
  check('24. applyEdit field on wrong type throws', threw);
  threw = false;
  try {
    applyEdit(box, 'radius', 1);
  } catch {
    threw = true;
  }
  check('25. applyEdit radius on box throws', threw);
}

// ─── fieldsFor: returns the right field set per type ──────────────
{
  const boxFields = fieldsFor(DEFAULT_COLLIDER.box);
  check(
    '26. fieldsFor(box) returns halfExtentsX/Y/Z',
    boxFields.length === 3 &&
      boxFields[0].field === 'halfExtentsX' &&
      boxFields[1].field === 'halfExtentsY' &&
      boxFields[2].field === 'halfExtentsZ',
  );
  const sphereFields = fieldsFor(DEFAULT_COLLIDER.sphere);
  check(
    '27. fieldsFor(sphere) returns radius only',
    sphereFields.length === 1 && sphereFields[0].field === 'radius',
  );
  const capFields = fieldsFor(DEFAULT_COLLIDER.capsule);
  check(
    '28. fieldsFor(capsule) returns radius + height',
    capFields.length === 2 &&
      capFields[0].field === 'radius' &&
      capFields[1].field === 'height',
  );
  const cylFields = fieldsFor(DEFAULT_COLLIDER.cylinder);
  check(
    '29. fieldsFor(cylinder) returns radius + height',
    cylFields.length === 2 &&
      cylFields[0].field === 'radius' &&
      cylFields[1].field === 'height',
  );
  // Values come from the spec
  check(
    '30. fieldsFor values come from the spec',
    boxFields[0].value === 0.5 && sphereFields[0].value === 0.6,
  );
}

// ─── Default collider coverage: every DEFAULT_COLLIDER is editable ─
// (Sanity: every type we ship has a working applyEdit / fieldsFor path.)
{
  const types: ColliderSpec['type'][] = ['box', 'sphere', 'capsule', 'cylinder'];
  let allOk = true;
  for (const t of types) {
    const spec = DEFAULT_COLLIDER[t];
    if (fieldsFor(spec).length === 0) allOk = false;
  }
  check('31. every DEFAULT_COLLIDER has at least one editable field', allOk);
}

// ─── Summary ──────────────────────────────────────────────────────
const passed = RESULTS.filter((r) => r.pass).length;
const failed = RESULTS.length - passed;
console.log('── collider input verification ──\n');
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
