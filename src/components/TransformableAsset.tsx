import { forwardRef, useImperativeHandle, useRef, useLayoutEffect } from 'react';
import type { Group } from 'three';
import type { AssetRef } from '@/store/editor';
import { useEditor } from '@/store/editor';
import { EditableMesh } from './EditableMesh';
import { ColliderMarker } from './ColliderMarker';

interface Props {
  asset: AssetRef;
  /** Click handler — wires mesh click to set this asset as active. */
  onSelect?: () => void;
  /** When true, the asset is the active one being edited. Gates the
   *  INTERACTIVE layer in EditableMesh (vertex handles, wireframe,
   *  DoubleSide). The geometry + vertexOffsets application ALWAYS
   *  runs, regardless of this flag, so vertex edits persist when
   *  switching to another asset. */
  editable?: boolean;
}

/**
 * Wraps MeshRenderer in a <group> that owns the world transform.
 *
 * Splitting the transform onto the group (instead of the mesh) means:
 *  - TransformControls can attach to this group via the forwarded ref
 *    and read/move position/rotation/scale directly.
 *  - MeshRenderer doesn't need to know about transforms.
 *  - Loading effect inside MeshRenderer fires on mount, regardless of
 *    whether the mesh is a primitive or a loaded file.
 *
 * The collider marker is a sibling of the mesh inside the same group,
 * so it inherits the asset's transform automatically. Toggling the
 * collider on/off in the sidebar just adds or removes this child.
 *
 * Rotation handling: the store stores `[x, y, z, order]` so the body
 * can rebuild a quaternion without assuming XYZ. R3F's `rotation`
 * prop only accepts a 3-tuple, and three's `Euler` defaults `order`
 * to 'XYZ' — if we passed `[x, y, z]` directly, R3F would call
 * `g.rotation.set(x, y, z, g.rotation.order)` and the group would be
 * reinterpreted under whatever order the group happens to have.
 * To make the order authoritative we drive position / scale via
 * props (R3F handles them fine) and drive rotation through a
 * useLayoutEffect that sets Euler + order on the ref BEFORE the
 * next paint, so the very first frame is correct.
 */
export const TransformableAsset = forwardRef<Group, Props>(
  ({ asset, onSelect, editable }, ref) => {
    const groupRef = useRef<Group>(null);
    const mode = useEditor((s) => s.mode);
    const isEditMode = mode === 'edit';
    useImperativeHandle(ref, () => groupRef.current as Group);

    useLayoutEffect(() => {
      const g = groupRef.current;
      if (!g) return;
      g.rotation.set(
        asset.transform.rotation[0],
        asset.transform.rotation[1],
        asset.transform.rotation[2],
        asset.transform.rotation[3],
      );
    });

    // The interactive layer (vertex handles, wireframe, DoubleSide
    // material) only makes sense when the asset is BOTH the active
    // one AND the editor is in edit mode. The geometry + per-frame
    // vertexOffsets application ALWAYS runs — that is the whole
    // point of always rendering <EditableMesh>: vertex edits are
    // part of the asset's persistent visual state, not an
    // interactive affordance of "currently selected".
    //
    // Bug fixed (2026-07-01 session #4): previously we swapped
    // <EditableMesh> for <MeshRenderer> when useEditable was
    // false. MeshRenderer created a brand-new BufferGeometry
    // (or pulled a cached GLB scene) on mount and never applied
    // vertexOffsets, so the moment the user clicked another
    // asset the original cube's edits vanished — they were
    // sitting in the previous (now-disposed) BufferGeometry
    // that <EditableMesh>'s useFrame had been mutating. The
    // only way to see the edits again was to click back to the
    // edited asset so <EditableMesh> remounted and re-snapshotted
    // the (pristine) base — but the offsets WERE in vertexOffsets
    // all along; they just had no mesh to render against.
    const interactive = editable === true && isEditMode;

    return (
      <group
        ref={groupRef}
        position={asset.transform.position}
        scale={asset.transform.scale}
      >
        <EditableMesh
          asset={asset}
          onSelect={onSelect ? () => onSelect() : undefined}
          interactive={interactive}
        />
        {asset.collider && <ColliderMarker spec={asset.collider} />}
      </group>
    );
  },
);

TransformableAsset.displayName = 'TransformableAsset';
