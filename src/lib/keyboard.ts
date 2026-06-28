import { useEffect } from 'react';
import { useEditor, type TransformMode } from '@/store/editor';

interface ShortcutHandlers {
  onRefit?: () => void;
}

/**
 * Editor keyboard shortcuts (Blender-style).
 *
 *   W / E / R — translate / rotate / scale gizmo mode
 *   F         — refit camera to current scene (caller-provided)
 *   Esc       — deselect active asset
 *
 * Ignored when the user is typing in an input / textarea / contenteditable.
 */
export function useEditorShortcuts(handlers: ShortcutHandlers = {}): void {
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const setActiveAsset = useEditor((s) => s.setActiveAsset);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'w':
          setMode('translate');
          break;
        case 'e':
          setMode('rotate');
          break;
        case 'r':
          setMode('scale');
          break;
        case 'f':
          handlers.onRefit?.();
          break;
        case 'escape':
          setActiveAsset(null);
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);

    function setMode(mode: TransformMode) {
      setTransformMode(mode);
    }
  }, [setTransformMode, setActiveAsset, handlers]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}