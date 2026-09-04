// @vitest-environment happy-dom
/**
 * R3F reconciler test for the Paint-mode "Reset all colors" bug.
 *
 * Drives the REAL `PaintPart` (exported from ./PaintMesh) through the
 * production @react-three/fiber reconciler via @react-three/test-renderer,
 * which exercises the real createInstance / commitMount / prepareUpdate /
 * commitUpdate / switchInstance path — no body is copied, so a future
 * edit to PaintPart changes this test's result.
 *
 * The bug: R3F `<primitive object={material} attach="material" />` mutates
 * `source.material = material` on attach and restores the original only on
 * detach/unmount. The reset branch `return src.material` returned the live
 * (already-mutated) clone, so R3F saw an unchanged object reference, skipped
 * reconstruction (no detach), and the part stayed colored until unmount.
 *
 * Because `attach="material"` writes to `source.material` in place, the
 * assertions read `source.material` directly — the field the viewport's
 * renderer reads each frame.
 */
import { describe, it, expect } from 'vitest';
import { StrictMode } from 'react';
import { create, act } from '@react-three/test-renderer';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import type { Object3D } from 'three';
import { PaintPart } from './PaintMesh';

function makeMesh(initial = '#ffffff'): { source: Mesh; imported: MeshStandardMaterial } {
  const imported = new MeshStandardMaterial({ color: initial });
  const source = new Mesh(new BoxGeometry(1, 1, 1), imported);
  return { source, imported };
}

const noop = () => {};

function part(props: {
  source: Object3D;
  overrideColor: string | undefined;
  key?: string;
}) {
  return (
    <PaintPart
      key={props.key}
      source={props.source}
      name={props.key ?? 'm'}
      overrideColor={props.overrideColor}
      isSelected={false}
      interactive={false}
      onPick={noop}
    />
  );
}

describe('PaintPart material reset (R3F reconciler)', () => {
  it('1. never painted keeps the imported color', async () => {
    const { source, imported } = makeMesh('#ffffff');
    const r = await create(part({ source, overrideColor: undefined }));
    expect(source.material).toBe(imported);
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    await r.unmount();
  });

  it('2. applies an override to the part', async () => {
    const { source } = makeMesh('#ffffff');
    const r = await create(part({ source, overrideColor: '#ff0000' }));
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    await r.unmount();
  });

  it('3. reset restores the imported color in-session (the bug)', async () => {
    const { source, imported } = makeMesh('#ffffff');
    const r = await create(part({ source, overrideColor: '#ff0000' }));
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    await r.update(part({ source, overrideColor: undefined }));
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    expect(source.material).toBe(imported);
    await r.unmount();
  });

  it('4. repaint A→B updates to the new color', async () => {
    const { source } = makeMesh('#ffffff');
    const r = await create(part({ source, overrideColor: '#ff0000' }));
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    await r.update(part({ source, overrideColor: '#0000ff' }));
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('0000ff');
    await r.unmount();
  });

  it('5. reset restores the imported material INSTANCE (identity)', async () => {
    const { source, imported } = makeMesh('#ffffff');
    const r = await create(part({ source, overrideColor: '#ff0000' }));
    const attachedClone = source.material;
    expect(attachedClone).not.toBe(imported);
    await r.update(part({ source, overrideColor: undefined }));
    expect(source.material).toBe(imported);
    expect(source.material).not.toBe(attachedClone);
    await r.unmount();
  });

  it('6. sibling-material isolation: painting a mesh whose sibling shares the imported material does not recolor the sibling, and reset restores only the painted mesh', async () => {
    const shared = new MeshStandardMaterial({ color: '#ffffff' });
    const meshA = new Mesh(new BoxGeometry(1, 1, 1), shared);
    const meshB = new Mesh(new BoxGeometry(1, 1, 1), shared);

    // Mount with A ALREADY painted so the shared import lives under only one
    // `<primitive>` (B's) at the assertion points. Mounting both unpainted
    // would put the SAME three object under two primitives simultaneously,
    // which collides on R3F's single-valued `__r3f` metadata (the clone would
    // attach to the last-mounted sibling). That collision is a pre-existing
    // R3F limitation for same-object-under-multiple-primitives and is out of
    // scope for the reported reset bug — which lives in the no-override
    // branch this fix changes — so we avoid it by painting A up front.
    const tree = (paintA?: string) => (
      <group>
        {part({ source: meshA, overrideColor: paintA, key: 'a' })}
        {part({ source: meshB, overrideColor: undefined, key: 'b' })}
      </group>
    );
    const r = await create(tree('#ff0000'));
    await act(async () => {});

    // Isolation: A is the red clone; B is untouched on the shared import.
    expect((meshA.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    expect(meshA.material).not.toBe(shared);
    expect(meshB.material).toBe(shared);
    expect((meshB.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');

    // Reset A; both must be back on the shared import (only A changed).
    await r.update(tree(undefined));
    await act(async () => {});
    expect(meshA.material).toBe(shared);
    expect(meshB.material).toBe(shared);
    expect((meshA.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    expect((meshB.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    await r.unmount();
  });

  it('7. StrictMode: reset still restores the imported color after a double-render mount', async () => {
    const { source, imported } = makeMesh('#ffffff');
    const r = await create(
      <StrictMode>{part({ source, overrideColor: '#ff0000' })}</StrictMode>,
    );
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    await r.update(
      <StrictMode>{part({ source, overrideColor: undefined })}</StrictMode>,
    );
    expect((source.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    expect(source.material).toBe(imported);
    await r.unmount();
  });
});
