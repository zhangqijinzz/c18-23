import { useEffect, useState } from 'react'
import type { BrandMirrorSnapshot } from '../models/brandMirrorModels'

interface HistoryToolbarProps {
  snapshot: BrandMirrorSnapshot
  onUndo: () => void
  onRedo: () => void
  onJump: (stepId: string) => void
}

export function HistoryToolbar({ snapshot, onUndo, onRedo, onJump }: HistoryToolbarProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const stepCount = snapshot.historySteps.length - 1

  return (
    <div className="history-toolbar">
      <div className="history-buttons">
        <button className="history-button" type="button" onClick={onUndo} disabled={!snapshot.canUndo} title="撤销（Ctrl/⌘ + Z）" aria-label="撤销">↶</button>
        <button className="history-button" type="button" onClick={onRedo} disabled={!snapshot.canRedo} title="重做（Ctrl/⌘ + Shift + Z）" aria-label="重做">↷</button>
        <button className={`history-history-button ${open ? 'active' : ''}`} type="button" onClick={() => setOpen((value) => !value)} disabled={stepCount === 0} aria-expanded={open}>
          历史<span className="history-count">{stepCount}</span>
        </button>
      </div>
      {open && stepCount > 0 && (
        <>
          <div className="history-backdrop" onClick={() => setOpen(false)} />
          <div className="history-popover" role="dialog" aria-label="编辑历史">
            <div className="history-popover-head">
              <strong>编辑历史</strong>
              <small>点击任意步骤可直接跳转</small>
            </div>
            <ol className="history-step-list">
              {snapshot.historySteps.map((step, index) => {
                const currentIndex = snapshot.historySteps.findIndex((item) => item.id === snapshot.currentHistoryId)
                const state: 'current' | 'past' | 'future' = index === currentIndex ? 'current' : index < currentIndex ? 'past' : 'future'
                return (
                  <li key={step.id}>
                    <button type="button" className={`history-step ${state}`} onClick={() => { onJump(step.id); setOpen(false) }} disabled={state === 'current'}>
                      <span className="history-step-marker" aria-hidden />
                      <span className="history-step-label">{step.label}</span>
                      <span className="history-step-time">{formatTime(step.at)}</span>
                      {state === 'current' && <span className="history-step-now">当前</span>}
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="history-popover-foot">连续微调自动合并为一步；切换主题、恢复默认各为独立一步。保存版本后仍可撤销编辑，已保存的版本不会被删除。历史随本地工作区保存，重开页面仍可撤销。</p>
          </div>
        </>
      )}
    </div>
  )
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
