import type { BrandMirrorSnapshot } from '../models/brandMirrorModels'

interface HistoryPanelProps {
  snapshot: BrandMirrorSnapshot
  onUndo: () => void
  onRedo: () => void
  onJump: (index: number) => void
}

function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function HistoryPanel({ snapshot, onUndo, onRedo, onJump }: HistoryPanelProps) {
  // 最新的步骤排在最上面，当前步及其之前的步骤都可以点击跳回
  const steps = [...snapshot.historySteps].reverse()
  return (
    <section className="control-section history-panel">
      <div className="section-label"><span>编辑历史</span><span className="muted">{snapshot.canUndo ? `${snapshot.historySteps.findIndex((step) => step.current) + 1} / ${snapshot.historySteps.length} 步` : '暂无编辑'}</span></div>
      <div className="history-toolbar">
        <button type="button" className="history-button" disabled={!snapshot.canUndo} onClick={onUndo} title={snapshot.undoLabel ? `撤销到「${snapshot.undoLabel}」(⌘/Ctrl+Z)` : '没有可撤销的步骤'}>
          ↶ 撤销{snapshot.undoLabel ? <small>{snapshot.undoLabel}</small> : null}
        </button>
        <button type="button" className="history-button" disabled={!snapshot.canRedo} onClick={onRedo} title={snapshot.redoLabel ? `重做「${snapshot.redoLabel}」(⌘/Ctrl+Shift+Z)` : '没有可重做的步骤'}>
          ↷ 重做{snapshot.redoLabel ? <small>{snapshot.redoLabel}</small> : null}
        </button>
      </div>
      <ol className="history-list">
        {steps.map((step) => (
          <li key={step.index}>
            <button
              type="button"
              className={`history-step ${step.current ? 'current' : ''} ${step.undone ? 'undone' : ''}`}
              disabled={step.current}
              onClick={() => onJump(step.index)}
              title={step.current ? '当前所在步骤' : `回到「${step.label}」`}
            >
              <span className="history-step-marker">{step.current ? '●' : step.undone ? '○' : '◌'}</span>
              <span className="history-step-label">{step.label}</span>
              <span className="history-step-time">{formatTime(step.timestamp)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="history-note">撤销 / 重做会立即写入本地保存；保存的版本不受撤销影响。</p>
    </section>
  )
}
