/**
 * Regression script for the "drag-and-drop upload in play mode leaves UI
 * stuck on loading" bug.
 *
 * Symptom (pre-fix): dropping a valid mesh file onto the viewport while
 * physics play mode is active set the store `loading` flag to true and
 * pinned it there. The toolbar Upload button stayed disabled
 * (`disabled={loading || ...}`) and the viewport "loading…" tag stayed
 * visible, with no in-app cue for recovery. Each such drop also leaked one
 * `URL.createObjectURL` blob until tab close.
 *
 * Root cause: the Viewport dropzone's `onDrop` forwarded dropped files to
 * `handleFiles` with no play-mode guard, while `handleFiles` (lib/upload.ts)
 * incremented its `added` counter unconditionally after calling `addAsset`
 * — even though `addAsset` silently no-op'd in play mode (store/editor.ts
 * `if (s.playMode) return s`). With `added > 0`, `handleFiles`' only
 * store-level `setLoading(false)` branch (`if (added === 0)`) was skipped,
 * and no mesh ever mounted to clear `loading` via the
 * EditableMesh / PaintMesh mount effect.
 *
 * Fix (defense in depth):
 *   1. src/store/editor.ts — `addAsset` now returns `boolean` (true if the
 *      asset was accepted, false if the play-mode safety net rejected it).
 *   2. src/lib/upload.ts — `handleFiles` uses that return value: a rejected
 *      add is not counted (so the `added === 0` branch clears `loading`) and
 *      its object URL is revoked (so no blob leaks).
 *   3. src/components/Viewport.tsx — the dropzone's `onDrop` mirrors the
 *      toolbar Upload-button guard (`loading || playMode`), setting a
 *      user-facing error for the play-mode case. (UI-layer guard; verified
 *      by code reading + build/typecheck — a pure-Node harness cannot mount
 *      the React dropzone. The pipeline tests below prove that even if
 *      `handleFiles` is reached in play mode, the UI no longer sticks.)
 *
 * Run: npx tsx --tsconfig ./tsconfig.app.json scripts/verify-loading-stuck.mts
 *      (also wired as `npm run verify:loading`)
 */
import { useEditor, DEFAULT_TRANSFORM, type AssetRef } from '@/store/editor';
import { handleFiles } from '@/lib/upload';
import { detectFormat, MESH_FORMATS, type AssetFormat } from '@/lib/formats';

const RESULTS: Array<{ name: string; pass: boolean; detail?: string }> = [];
function check(name: string, cond: boolean, detail?: string): void {
  RESULTS.push({ name, pass: cond, detail });
}

/** Build a minimal in-file asset record (mirrors what handleFiles builds,
 *  minus the live object URL — used for direct addAsset return-contract
 *  tests that don't go through handleFiles). */
function makeAsset(name: string): AssetRef {
  return {
    id: crypto.randomUUID(),
    name,
    url: undefined,
    format: 'obj',
    kind: 'mesh',
    source: 'file',
    size: 0,
    loadedAt: Date.now(),
    transform: { ...DEFAULT_TRANSFORM },
    collider: null,
    vertexOffsets: null,
    geometrySnapshot: null,
    geometryMutationNonce: 0,
  };
}

/** Node has no global FileList; handleFiles only reads `.length` and
 *  `Array.from(files)`, so a plain File[] cast as FileList is fine. */
function fileList(files: File[]): FileList {
  return files as unknown as FileList;
}

/** Install URL.createObjectURL / revokeObjectURL spies that record the
 *  minted and revoked blob URLs, restoring the originals in `finally`.
 *  Used to prove the blob-leak fix. */
async function withUrlSpy<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; created: string[]; revoked: string[] }> {
  const created: string[] = [];
  const revoked: string[] = [];
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((obj: Blob): string => {
    const u = origCreate.call(URL, obj);
    created.push(u);
    return u;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string): void => {
    revoked.push(u);
    origRevoke.call(URL, u);
  }) as typeof URL.revokeObjectURL;
  try {
    const result = await fn();
    return { result, created, revoked };
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  }
}

/** Reset the store to a clean baseline between sections. Must stop play
 *  BEFORE removing assets (removeAsset is play-mode-guarded). */
function reset(): void {
  const s = useEditor.getState();
  if (s.playMode) s.setPlayMode(false);
  for (const a of [...useEditor.getState().assets]) {
    useEditor.getState().removeAsset(a.id);
  }
  useEditor.getState().resetHistoryForTest();
  useEditor.getState().setLoading(false);
  useEditor.getState().setError(null);
}

// ─── Section 0: fixture sanity ──────────────────────────────────────
console.log('── section 0: fixture sanity ──');
{
  const fmt: AssetFormat = detectFormat('cube.obj');
  check('0. detectFormat(cube.obj) -> obj', fmt === 'obj', `fmt=${fmt}`);
  check('0. obj ∈ MESH_FORMATS', MESH_FORMATS.has('obj'));
  check('0. detectFormat(notes.txt) -> unknown', detectFormat('notes.txt') === 'unknown');
  check('0. unknown ∉ MESH_FORMATS', !MESH_FORMATS.has('unknown'));
}

// ─── Section 1: addAsset return contract (store layer) ──────────────
console.log('\n── section 1: addAsset return contract ──');
{
  reset();
  // 1.1 — accepted when not in play.
  {
    const before = useEditor.getState().refitRequestNonce;
    const accepted = useEditor.getState().addAsset(makeAsset('a.obj'));
    const after = useEditor.getState();
    check('1.1 addAsset (not playing) returns true', accepted === true);
    check('1.1 addAsset (not playing) adds the asset', after.assets.length === 1, `len=${after.assets.length}`);
    check('1.1 addAsset bumps refitRequestNonce', after.refitRequestNonce - before === 1, `${before}->${after.refitRequestNonce}`);
  }
  // 1.2 — rejected in play mode, no side effects.
  {
    reset();
    useEditor.getState().setPlayMode(true);
    check('1.2 precondition playMode on', useEditor.getState().playMode);
    const beforeAssets = useEditor.getState().assets.length;
    const beforeRefit = useEditor.getState().refitRequestNonce;
    const beforePast = useEditor.getState().history.past.length;
    const accepted = useEditor.getState().addAsset(makeAsset('b.obj'));
    const after = useEditor.getState();
    check('1.2 addAsset (playing) returns false', accepted === false);
    check('1.2 addAsset (playing) does not add', after.assets.length === beforeAssets, `len=${after.assets.length}`);
    check('1.2 addAsset (playing) does not bump refitRequestNonce', after.refitRequestNonce === beforeRefit, `${beforeRefit}->${after.refitRequestNonce}`);
    check('1.2 addAsset (playing) does not push history', after.history.past.length === beforePast, `past=${after.history.past.length}`);
  }
  // 1.3 — after stopping play, addAsset accepts again (guard is state-driven).
  {
    reset();
    useEditor.getState().setPlayMode(true);
    const rejected = useEditor.getState().addAsset(makeAsset('c.obj'));
    useEditor.getState().setPlayMode(false);
    const accepted = useEditor.getState().addAsset(makeAsset('d.obj'));
    check('1.3 precondition: play-mode add rejected', rejected === false);
    check('1.3 after stop: playMode off', !useEditor.getState().playMode);
    check('1.3 after stop: addAsset returns true', accepted === true);
    check('1.3 after stop: asset added', useEditor.getState().assets.length === 1, `len=${useEditor.getState().assets.length}`);
  }
}

// ─── Section 2: handleFiles in play mode clears loading (the core bug) ─
console.log('\n── section 2: handleFiles play-mode valid drop (core fix) ──');
{
  reset();
  useEditor.getState().setPlayMode(true);
  check('2. precondition playMode on', useEditor.getState().playMode);
  check('2. precondition loading off', !useEditor.getState().loading);
  const { created, revoked } = await withUrlSpy(() =>
    handleFiles(fileList([new File([new Uint8Array([0])], 'cube.obj', { type: 'model/obj' })])),
  );
  const s = useEditor.getState();
  check('2. playMode still on (unaffected)', s.playMode);
  check('BUG FIXED: loading NOT stuck after play-mode drop', s.loading === false, `loading=${s.loading}`);
  check('2. no asset added (addAsset rejected in play)', s.assets.length === 0, `len=${s.assets.length}`);
  check('2. no false error from handleFiles on rejection', s.error === null, `error=${s.error}`);
  check('2. one object URL minted', created.length === 1, `created=${created.length}`);
  check('2. object URL revoked (no blob leak)', revoked.length === 1, `revoked=${revoked.length}`);
  check('2. revoked URL matches the minted URL', revoked[0] === created[0]);
}

// ─── Section 3: handleFiles multi valid in play mode (no leak, cleared) ─
console.log('\n── section 3: handleFiles play-mode multi valid ──');
{
  reset();
  useEditor.getState().setPlayMode(true);
  const { created, revoked } = await withUrlSpy(() =>
    handleFiles(
      fileList([
        new File([new Uint8Array([0])], 'a.obj', { type: 'model/obj' }),
        new File([new Uint8Array([0])], 'b.glb', { type: 'model/gltf-binary' }),
        new File([new Uint8Array([0])], 'c.gltf', { type: 'model/gltf+json' }),
      ]),
    ),
  );
  const s = useEditor.getState();
  check('3. loading cleared', s.loading === false, `loading=${s.loading}`);
  check('3. no assets added', s.assets.length === 0, `len=${s.assets.length}`);
  check('3. three object URLs minted', created.length === 3, `created=${created.length}`);
  check('3. every minted URL revoked (no leak)', revoked.length === 3, `revoked=${revoked.length}`);
  check(
    '3. revoked set equals created set',
    created.every((u) => revoked.includes(u)) && revoked.length === created.length,
  );
}

// ─── Section 4: handleFiles mixed valid+unsupported in play mode ─────
console.log('\n── section 4: handleFiles play-mode valid+unsupported ──');
{
  reset();
  useEditor.getState().setPlayMode(true);
  const { created, revoked } = await withUrlSpy(() =>
    handleFiles(
      fileList([
        new File([new Uint8Array([0])], 'cube.obj', { type: 'model/obj' }),
        new File([new Uint8Array([0])], 'notes.txt', { type: 'text/plain' }),
      ]),
    ),
  );
  const s = useEditor.getState();
  check('4. loading cleared (both rejected -> added===0)', s.loading === false, `loading=${s.loading}`);
  check('4. no assets added', s.assets.length === 0, `len=${s.assets.length}`);
  check('4. error set by judgeFormat for unsupported', s.error !== null && /Unsupported file type/.test(s.error ?? ''), `error=${s.error}`);
  check('4. only the valid file mints an object URL', created.length === 1, `created=${created.length}`);
  check('4. rejected add URL revoked (no leak)', revoked.length === 1, `revoked=${revoked.length}`);
}

// ─── Section 5: handleFiles unsupported-only in play mode ───────────
console.log('\n── section 5: handleFiles play-mode unsupported only ──');
{
  reset();
  useEditor.getState().setPlayMode(true);
  const { created, revoked } = await withUrlSpy(() =>
    handleFiles(fileList([new File([new Uint8Array([0])], 'notes.txt', { type: 'text/plain' })])),
  );
  const s = useEditor.getState();
  check('5. loading cleared', s.loading === false, `loading=${s.loading}`);
  check('5. no assets added', s.assets.length === 0, `len=${s.assets.length}`);
  check('5. error set for unsupported file', s.error !== null && /Unsupported file type/.test(s.error ?? ''), `error=${s.error}`);
  check('5. no object URL minted (rejected before createObjectURL)', created.length === 0, `created=${created.length}`);
  check('5. nothing to revoke', revoked.length === 0, `revoked=${revoked.length}`);
}

// ─── Section 6: happy path / negative control (no regression) ────────
console.log('\n── section 6: non-play happy path (control) ──');
{
  reset();
  check('6. precondition: not playing', !useEditor.getState().playMode);
  const { created, revoked } = await withUrlSpy(() =>
    handleFiles(fileList([new File([new Uint8Array([0])], 'cube.obj', { type: 'model/obj' })])),
  );
  const s = useEditor.getState();
  check('6. addAsset accepted (asset added)', s.assets.length === 1, `len=${s.assets.length}`);
  check('6. store holds the minted object URL', s.assets[0]?.url === created[0], `url=${s.assets[0]?.url}`);
  check('6. one object URL minted', created.length === 1, `created=${created.length}`);
  check('6. accepted URL NOT revoked (removeAsset owns it)', revoked.length === 0, `revoked=${revoked.length}`);
  // Harness artifact (documented, not a failure): in the real app the
  // EditableMesh/PaintMesh mount effect clears loading once the loader
  // resolves. In this pure-Node harness no React tree mounts, so loading
  // stays true — exactly as the pre-existing verify-store/physics scripts
  // also observe. This is NOT the bug; the bug was loading stuck with
  // assets.length===0 (proven fixed in section 2).
  check('6. harness: loading stays true (no mounted mesh effect in Node) — documented', s.loading === true, `loading=${s.loading}`);
}

// ─── Section 7: recovery — play-mode drop then stop+drop succeeds ───
console.log('\n── section 7: recovery (no stick) -> stop + drop ──');
{
  reset();
  useEditor.getState().setPlayMode(true);
  // A play-mode drop no longer pins loading — it clears immediately.
  await withUrlSpy(() =>
    handleFiles(fileList([new File([new Uint8Array([0])], 'cube.obj', { type: 'model/obj' })])),
  );
  const afterPlay = useEditor.getState();
  check('7. after play-mode drop: loading cleared (no stick to recover from)', afterPlay.loading === false, `loading=${afterPlay.loading}`);
  check('7. after play-mode drop: still no asset', afterPlay.assets.length === 0);
  // Stopping play alone does not need to "rescue" loading (it's already
  // clear), and a subsequent valid drop now succeeds.
  useEditor.getState().setPlayMode(false);
  check('7. after stop: playMode off', !useEditor.getState().playMode);
  check('7. after stop: loading still off (no stick survived stop)', !useEditor.getState().loading);
  await withUrlSpy(() =>
    handleFiles(fileList([new File([new Uint8Array([0])], 'cube.obj', { type: 'model/obj' })])),
  );
  const afterDrop = useEditor.getState();
  check('7. after stop+drop: asset accepted', afterDrop.assets.length === 1, `len=${afterDrop.assets.length}`);
}

// ─── results ────────────────────────────────────────────────────────
console.log('\n── results ──');
let passed = 0;
for (const r of RESULTS) {
  if (r.pass) {
    passed++;
    if (r.detail) console.log(`  ✓ ${r.name} (${r.detail})`);
    else console.log(`  ✓ ${r.name}`);
  } else {
    console.error(`  ✗ ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  }
}
const failed = RESULTS.length - passed;
console.log(`\n${passed}/${RESULTS.length} pass`);
if (failed > 0) {
  console.error(`\n❌ ${failed} FAIL`);
  process.exit(1);
}
console.log('\n✅ ALL PASS');
