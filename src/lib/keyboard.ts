import { useEffect } from 'react';
import { useEditor } from '@/store/editor';

interface ShortcutHandlers {
  onRefit?: () => void;
}

/**
 * Editor keyboard shortcuts.
 *
 *   W / E / R               — translate / rotate / scale gizmo mode
 *   X / Y / Z               — toggle axis lock (per-mode, Blender-style)
 *   F                       — refit camera to current scene (caller-provided)
 *   Esc                     — deselect active asset
 *   Cmd/Ctrl + Z            — undo
 *   Cmd/Ctrl + Shift + Z    — redo
 *   Cmd/Ctrl + Y            — redo (Windows convention)
 *
 * Ignored when the user is typing in an input / textarea / contenteditable.
 * Modifier keys alone do nothing — only the Cmd/Ctrl variants trigger undo.
 */
export function useEditorShortcuts(handlers: ShortcutHandlers = {}): void {
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const setActiveAsset = useEditor((s) => s.setActiveAsset);
  const toggleAxisLock = useEditor((s) => s.toggleAxisLock);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      const cmd = e.metaKey || e.ctrlKey;

      // Undo / redo — these are the only shortcuts that require a modifier.
      if (cmd && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          redo();
          return;
        }
      }

      // Plain shortcuts — ignored if any modifier is held.
      if (cmd || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'w':
          setTransformMode('translate');
          break;
        case 'e':
          setTransformMode('rotate');
          break;
        case 'r':
          setTransformMode('scale');
          break;
        case 'x':
          toggleAxisLock('x');
          break;
        case 'y':
          toggleAxisLock('y');
          break;
        case 'z':
          toggleAxisLock('z');
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
  }, [setTransformMode, setActiveAsset, toggleAxisLock, undo, redo, handlers]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}