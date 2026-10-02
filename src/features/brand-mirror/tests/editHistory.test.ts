import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commitEdit, createHistory, currentCheckpoint, jumpTo, redo, redoTarget, sanitizeHistory, undo, undoTarget, COALESCE_WINDOW_MS, HISTORY_LIMIT } from '../domain/editHistory'
import { INITIAL_TOKENS } from '../models/brandMirrorModels'
import type { BrandTokens, EditHistory } from '../models/brandMirrorModels'

const t0 = 1_000_000

function tokensWith(primary: string): BrandTokens {
  return { ...INITIAL_TOKENS, primary }
}

describe('edit history', () => {
  it('starts with a single checkpoint and cannot undo or redo', () => {
    const history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    expect(history.entries).toHaveLength(1)
    expect(history.pointer).toBe(0)
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(false)
  })

  it('moves the pointer back and forth across undo and redo', () => {
    let history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#111111'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 100).history
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#222222'), label: '辅助色调整', coalesceKey: 'color:secondary' }, t0 + 200).history
    expect(history.entries).toHaveLength(3)

    expect(currentCheckpoint(history).tokens.primary).toBe('#222222')
    history = undo(history)
    expect(currentCheckpoint(history).tokens.primary).toBe('#111111')
    expect(undoTarget(history)?.label).toBe('初始状态')
    history = undo(history)
    expect(currentCheckpoint(history).tokens.primary).toBe(INITIAL_TOKENS.primary)
    expect(canUndo(history)).toBe(false)

    history = redo(history)
    expect(currentCheckpoint(history).tokens.primary).toBe('#111111')
    expect(redoTarget(history)?.tokens.primary).toBe('#222222')
  })

  it('coalesces repeated edits of the same target inside the time window', () => {
    let history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    const first = commitEdit(history, { theme: 'studio', tokens: tokensWith('#111111'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 10)
    history = first.history
    expect(first.coalesced).toBe(false)
    expect(history.entries).toHaveLength(2)

    const second = commitEdit(history, { theme: 'studio', tokens: tokensWith('#222222'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 500)
    history = second.history
    expect(second.coalesced).toBe(true)
    expect(history.entries).toHaveLength(2)
    expect(currentCheckpoint(history).tokens.primary).toBe('#222222')
  })

  it('starts a new step after the coalescing window or when the target changes', () => {
    let history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#111111'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 10).history
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#222222'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 10 + COALESCE_WINDOW_MS + 50).history
    expect(history.entries).toHaveLength(3)

    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#333333'), label: '辅助色调整', coalesceKey: 'color:secondary' }, t0 + 3000).history
    expect(history.entries).toHaveLength(4)
  })

  it('never coalesces discrete actions like theme switch and reset', () => {
    let history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    history = commitEdit(history, { theme: 'night', tokens: tokensWith('#A98BFF'), label: '切换主题 · Night signal' }, t0 + 5).history
    history = commitEdit(history, { theme: 'studio', tokens: INITIAL_TOKENS, label: '恢复默认令牌' }, t0 + 10).history
    expect(history.entries.map((entry) => entry.label)).toEqual(['初始状态', '切换主题 · Night signal', '恢复默认令牌'])
    expect(history.entries.slice(1).every((entry) => entry.coalesceKey === undefined)).toBe(true)
  })

  it('drops redoable steps when a new edit follows an undo', () => {
    let history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#111111'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 100).history
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#222222'), label: '辅助色调整', coalesceKey: 'color:secondary' }, t0 + 200).history
    history = undo(history)
    expect(canRedo(history)).toBe(true)

    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#333333'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 5_000).history
    expect(canRedo(history)).toBe(false)
    expect(history.entries.map((entry) => entry.tokens.primary)).toEqual([INITIAL_TOKENS.primary, '#111111', '#333333'])
  })

  it('jumps directly to any step and clamps the stack to the limit', () => {
    let history = createHistory('studio', INITIAL_TOKENS, '初始状态', t0)
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#111111'), label: '主色调整', coalesceKey: 'color:primary' }, t0 + 100).history
    history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#222222'), label: '辅助色调整', coalesceKey: 'color:secondary' }, t0 + 200).history

    history = jumpTo(history, 0)
    expect(history.pointer).toBe(0)
    history = jumpTo(history, 1)
    expect(currentCheckpoint(history).tokens.primary).toBe('#111111')

    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      history = commitEdit(history, { theme: 'studio', tokens: tokensWith('#222222'), label: `独立步 ${i}` }, t0 + 10_000 + i * 100).history
    }
    expect(history.entries.length).toBeLessThanOrEqual(HISTORY_LIMIT)
    expect(history.pointer).toBe(history.entries.length - 1)
  })

  it('restores valid persisted history and rejects corrupted payloads', () => {
    const history: EditHistory = createHistory('night', tokensWith('#A98BFF'), '切换主题 · Night signal', t0)
    expect(sanitizeHistory(JSON.parse(JSON.stringify(history)))).toEqual(history)

    expect(sanitizeHistory(null)).toBeNull()
    expect(sanitizeHistory({ entries: [], pointer: 0 })).toBeNull()
    expect(sanitizeHistory({ entries: history.entries, pointer: 5 })).toBeNull()
    const broken = JSON.parse(JSON.stringify(history)) as EditHistory
    broken.entries[0].tokens.primary = 'not-a-color'
    expect(sanitizeHistory(broken)).toBeNull()
  })
})
