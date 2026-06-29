/**
 * Phase 4c-A: collider numeric input helpers.
 *
 * The sidebar exposes number inputs for `halfExtents` / `radius` / `height`
 * (4 collider types, different shapes). To keep the UX consistent with
 * the rest of the editor — and to keep the test surface pure — the
 * validation / clamping / commit logic lives here as plain functions.
 *
 * UX decisions (locked in with the user):
 *
 *  - Clamp on blur, not on every keystroke. Letting the user type
 *    `0` or `-1` mid-edit would be jarring; one clamp on focus loss
 *    mirrors what Blender does and what the gizmo drag-commit
 *    (phase 3.1) does.
 *
 *  - NaN is rejected outright (no value to commit).
 *
 *  - Clamp range is [MIN, MAX] = [0.01, 100]. 0.01 keeps the body
 *    numerically stable (zero-radius spheres / zero-extent boxes
 *    confuse the broadphase). 100 is a soft cap; bigger colliders
 *    are unusual and the user can type past it if needed (we don't
 *    hard-block, we clamp the display value on commit).
 *
 *  - One history entry per focus session, not per keystroke. The
 *    same pattern as the gizmo drag-commit. Implemented in
 *    `ColliderEditor.NumberField` — it captures the pre-edit value
 *    on focus, parses + clamps on blur, and only calls
 *    `setAssetCollider` (which pushes a history entry) if the
 *    parsed value actually differs. This module only exposes the
 *    pure parse / clamp / apply helpers; the React layer owns the
 *    no-op gate.
 */
import type { ColliderSpec } from '@/lib/formats';

/** Hard limits for collider dimensions (scene units, ~meters). */
export const MIN = 0.01;
export const MAX = 100;

/**
 * Parse a string from an <input type="number"> and clamp it into
 * [MIN, MAX]. Returns null on NaN / empty so the caller can decide
 * whether to keep the previous value or reject the edit.
 *
 * `Infinity` and `-Infinity` are also NaN-like (Number('') is NaN,
 * `parseFloat('Infinity')` is Infinity) — guard them too.
 */
export function parseClamped(raw: string): number | null {
  // Treat empty string as "no value" — the user cleared the field
  // while typing; we don't want to silently turn that into MIN(0.01).
  if (raw === '' || raw.trim() === '') return null;
  // The browser's <input type="number"> already blocks most non-numeric
  // input, but we still see NaN for `-` / `e` / pasted garbage.
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clamp(n);
}

export function clamp(n: number): number {
  if (n < MIN) return MIN;
  if (n > MAX) return MAX;
  return n;
}

/**
 * Apply a partial edit to a ColliderSpec. Pure function. The caller
 * supplies a `field` and a numeric `value`; we return a new
 * ColliderSpec with that field updated.
 *
 * Used by the input components' onBlur handler to build the new spec
 * before passing it to `setAssetCollider`.
 *
 * Throws if the field doesn't exist on the spec's type — that's a
 * programmer error (typo in the field name on the JSX side) and
 * should fail loudly in dev.
 */
export function applyEdit(
  spec: ColliderSpec,
  field: ColliderField,
  value: number,
): ColliderSpec {
  switch (spec.type) {
    case 'box':
      if (field === 'halfExtentsX') {
        return { ...spec, halfExtents: [value, spec.halfExtents[1], spec.halfExtents[2]] };
      }
      if (field === 'halfExtentsY') {
        return { ...spec, halfExtents: [spec.halfExtents[0], value, spec.halfExtents[2]] };
      }
      if (field === 'halfExtentsZ') {
        return { ...spec, halfExtents: [spec.halfExtents[0], spec.halfExtents[1], value] };
      }
      break;
    case 'sphere':
      if (field === 'radius') return { ...spec, radius: value };
      break;
    case 'capsule':
    case 'cylinder':
      if (field === 'radius') return { ...spec, radius: value };
      if (field === 'height') return { ...spec, height: value };
      break;
  }
  // Unreachable in practice — TypeScript would have caught a typo
  // at the call site, but the runtime check is a safety net for
  // cases where the field string is built dynamically.
  throw new Error(
    `applyEdit: field ${String(field)} is not editable on collider type ${spec.type}`,
  );
}

/** Field names we expose in the sidebar. */
export type ColliderField = 'halfExtentsX' | 'halfExtentsY' | 'halfExtentsZ' | 'radius' | 'height';

/** The set of editable fields for a given collider type, in display order. */
export function fieldsFor(spec: ColliderSpec): ReadonlyArray<{
  field: ColliderField;
  label: string;
  value: number;
}> {
  switch (spec.type) {
    case 'box':
      return [
        { field: 'halfExtentsX', label: 'X', value: spec.halfExtents[0] },
        { field: 'halfExtentsY', label: 'Y', value: spec.halfExtents[1] },
        { field: 'halfExtentsZ', label: 'Z', value: spec.halfExtents[2] },
      ];
    case 'sphere':
      return [{ field: 'radius', label: 'r', value: spec.radius }];
    case 'capsule':
    case 'cylinder':
      return [
        { field: 'radius', label: 'r', value: spec.radius },
        { field: 'height', label: 'h', value: spec.height },
      ];
  }
}
