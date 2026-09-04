import { useEditor, DEFAULT_TRANSFORM } from '@/store/editor';
import {
  detectFormat,
  classifyKind,
  MESH_FORMATS,
  type AssetFormat,
} from '@/lib/formats';

/**
 * Ingest a FileList (from <input type="file"> or a drop event).
 *
 * - Unknown extensions are rejected with a single error message.
 * - Formats deferred to phase 5 (splat/ply/spz) are rejected with an
 *   explicit "not yet supported" message — they are NOT queued.
 * - Mesh formats (glb/gltf/obj) get an object URL and are added to the store.
 *
 * The `loading` flag is set true at the start so the toolbar shows
 * "Loading…". It is cleared either:
 *   - by `MeshRenderer` once it has mounted with the new asset (i.e. after
 *     Suspense resolves the loader), OR
 *   - by us here if no asset was added (everything was rejected).
 */
export async function handleFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;

  const { addAsset, setError, setLoading } = useEditor.getState();
  setError(null);
  setLoading(true);

  let added = 0;
  for (const file of Array.from(files)) {
    const format = detectFormat(file.name);
    const verdict = judgeFormat(format, file.name);
    if (verdict) {
      setError(verdict);
      continue;
    }
    const url = URL.createObjectURL(file);
    const accepted = addAsset({
      id: crypto.randomUUID(),
      name: file.name,
      url,
      format,
      kind: classifyKind(format),
      source: 'file',
      size: file.size,
      loadedAt: Date.now(),
      transform: { ...DEFAULT_TRANSFORM },
      collider: null,
      vertexOffsets: null,
      geometrySnapshot: null,
      geometryMutationNonce: 0,
    });
    if (!accepted) {
      // The store rejected the add (e.g. the phase-4d play-mode guard).
      // Don't count it: leaving `added` at 0 lets the `added === 0`
      // branch below clear `loading`, so the UI doesn't stick on
      // "loading…". The asset never entered the store, so removeAsset
      // (the only other revoker) would never run — revoke here to avoid
      // leaking the blob URL until tab close.
      URL.revokeObjectURL(url);
      continue;
    }
    added++;
  }

  if (added === 0) {
    setLoading(false);
  }
}

/**
 * Returns an error string if the format should be rejected, or null if OK.
 */
function judgeFormat(format: AssetFormat, fileName: string): string | null {
  if (format === 'unknown') {
    return `Unsupported file type: ${fileName}`;
  }
  if (!MESH_FORMATS.has(format)) {
    return `${format.toUpperCase()} support ships in phase 5 — not yet rendered.`;
  }
  return null;
}