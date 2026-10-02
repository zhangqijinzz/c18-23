import { useEffect, useRef } from 'react'

interface UndoRedoActions {
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * 全局快捷键：⌘/Ctrl+Z 撤销，⌘/Ctrl+Shift+Z 或 ⌘/Ctrl+Y 重做。
 * 焦点在文本/数字/颜色输入框中时交给浏览器原生处理，避免与输入冲突。
 */
export function useUndoRedoShortcuts(actions: UndoRedoActions): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

      const wantRedo = key === 'y' || (key === 'z' && event.shiftKey)
      if (wantRedo) {
        if (actionsRef.current.canRedo()) {
          event.preventDefault()
          actionsRef.current.redo()
        }
      } else if (actionsRef.current.canUndo()) {
        event.preventDefault()
        actionsRef.current.undo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
