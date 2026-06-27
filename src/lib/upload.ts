import { useEditor, detectFormat, classifyKind } from '@/store/editor';

/** Files currently NOT rendered by mesh path; queued for phase 5 (gaussian). */
const PHASE5_FORMATS = new Set(['splat', 'spz', 'ply']);

export async function handleFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const { addAsset, setLoading, setError } = useEditor.getState();
  setError(null);
  setLoading(true);
  try {
    for (const file of Array.from(files)) {
      const format = detectFormat(file.name);
      if (format === 'unknown') {
        setError(`Unsupported file type: ${file.name}`);
        continue;
      }
      if (PHASE5_FORMATS.has(format)) {
        setError(`${format.toUpperCase()} renderer ships in phase 5 — queued.`);
        continue;
      }
      const url = URL.createObjectURL(file);
      addAsset({
        id: crypto.randomUUID(),
        name: file.name,
        url,
        format,
        kind: classifyKind(format),
        size: file.size,
        loadedAt: Date.now(),
      });
    }
  } finally {
    setLoading(false);
  }
}