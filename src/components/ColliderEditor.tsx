/**
 * Phase 4c-A: numeric collider editor (the editable counterpart to
 * the read-only `formatCollider` summary in the sidebar).
 *
 * The component owns the input's `string` state (HTML <input> can only
 * deal with strings — typing `-` momentarily would force a number
 * conversion to NaN). On blur the string is parsed + clamped via
 * `parseClamped` from lib/colliderInput; if the value actually
 * changed, we call `setAssetCollider` (which adds a history entry).
 *
 * We do NOT push history on every keystroke — that's the "blur commit"
 * UX rule. The pre-edit snapshot is captured the first time the
 * field gets focus (so a single ⌘Z reverts the entire field, not
 * the last keystroke).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '@/store/editor';
import { DEFAULT_COLLIDER, type ColliderSpec } from '@/lib/formats';
import {
  applyEdit,
  fieldsFor,
  parseClamped,
  type ColliderField,
} from '@/lib/colliderInput';

interface Props {
  assetId: string;
  spec: ColliderSpec;
}

export function ColliderEditor({ assetId, spec }: Props) {
  return (
    <div className="collider-editor">
      <div className="collider-editor-fields">
        {fieldsFor(spec).map((f) => (
          <NumberField
            key={f.field}
            assetId={assetId}
            spec={spec}
            field={f.field}
            label={f.label}
            initial={f.value}
          />
        ))}
      </div>
      <button
        className="reset-btn"
        onClick={() =>
          useEditor.getState().setAssetCollider(assetId, DEFAULT_COLLIDER[spec.type])
        }
        title="Reset collider dimensions to defaults"
      >
        ⟲ Reset to defaults
      </button>
    </div>
  );
}

interface FieldProps {
  assetId: string;
  spec: ColliderSpec;
  field: ColliderField;
  label: string;
  initial: number;
}

/**
 * A single labelled number input. The "blur commit, no per-keystroke
 * history" pattern is implemented here:
 *
 *   1. onFocus  → snapshot the pre-edit value into a ref (we don't push
 *                 history yet — that happens on blur if the value changed)
 *   2. onChange → update local string state; do NOT call setAssetCollider
 *   3. onBlur   → parse + clamp the string, build the new spec, and
 *                 if the new value differs from the captured pre-edit
 *                 value, setAssetCollider (which pushes one history entry)
 *
 * If the parse fails (NaN) or the value is unchanged, no history entry
 * is created and the local string state snaps back to the last good
 * value (so the display doesn't lie).
 */
function NumberField({ assetId, spec, field, label, initial }: FieldProps) {
  // Local string state for the input. Stored as a string so the
  // browser can show typing-in-progress values (e.g. "-" mid-edit)
  // without flicker. Sanitized back to a number on blur.
  const [text, setText] = useState(() => initial.toString());
  // Pre-edit snapshot for history. Stored in a ref so re-renders
  // (e.g. when the active asset's collider changes from outside)
  // don't clobber it. We use the underlying number, not the string,
  // so the comparison on blur is exact.
  const preEditValueRef = useRef(initial);

  // If the spec changes from OUTSIDE this input (e.g. user picks a
  // different collider type, or undo/redo overwrites), re-sync the
  // displayed text. The dependency is `initial` so we don't fight
  // the user's in-progress typing (which only changes `text`).
  useEffect(() => {
    setText(initial.toString());
  }, [initial]);

  const onFocus = useCallback(() => {
    preEditValueRef.current = initial;
  }, [initial]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  const onBlur = useCallback(() => {
    const parsed = parseClamped(text);
    if (parsed === null) {
      // NaN / empty / garbage — restore the displayed text to the
      // last known-good value and don't push history.
      setText(initial.toString());
      return;
    }
    // If the new value equals the pre-edit value, no history entry.
    // (The user might have focused and blurred without changing.)
    if (parsed === preEditValueRef.current) {
      // Snap displayed text back to the canonical representation
      // (clamps may have happened at write time and we want the
      // input to show the same thing the next time it focuses).
      setText(parsed.toString());
      return;
    }
    // Build the new spec and commit. setAssetCollider pushes one
    // history entry per call.
    const next = applyEdit(spec, field, parsed);
    useEditor.getState().setAssetCollider(assetId, next);
    // The useEffect above will re-sync `text` from the new `initial`
    // (which re-renders from the store on the next tick). No need
    // to setText here.
  }, [text, initial, spec, field, assetId]);

  return (
    <label className="collider-field">
      <span className="collider-field-label">{label}</span>
      <input
        className="collider-field-input"
        type="number"
        inputMode="decimal"
        step={0.05}
        min={0.01}
        max={100}
        value={text}
        onFocus={onFocus}
        onChange={onChange}
        onBlur={onBlur}
        aria-label={`${label} dimension`}
      />
    </label>
  );
}
