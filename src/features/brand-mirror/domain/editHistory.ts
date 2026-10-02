import { cloneTokens, isHexColor, validateTokens } from './brandRules'
import type { BrandTheme, BrandTokens, EditHistory, HistoryCheckpoint } from '../models/brandMirrorModels'

/** 最多保留的检查点数量（含初始检查点），超出后丢弃最早的编辑步 */
export const HISTORY_LIMIT = 50
/** 同目标的连续微调在此毫秒数内合并为一步 */
export const COALESCE_WINDOW_MS = 1000

export function createHistory(theme: BrandTheme, tokens: BrandTokens, label: string, now: number): EditHistory {
  const checkpoint: HistoryCheckpoint = { theme, tokens: cloneTokens(tokens), label, createdAt: now, updatedAt: now }
  return { entries: [checkpoint], pointer: 0 }
}

export interface CommitResult {
  history: EditHistory
  /** 本次提交是否合并进了上一步（而不是新增一步） */
  coalesced: boolean
}

/**
 * 提交一次编辑。
 * - coalesceKey 相同且在合并时间窗内（取当前步 updatedAt 判断）时，覆盖当前步；
 * - 否则压入新的检查点，并丢弃当前步之后已被撤销的步骤。
 */
export function commitEdit(
  history: EditHistory,
  edit: { theme: BrandTheme; tokens: BrandTokens; label: string; coalesceKey?: string },
  now: number,
): CommitResult {
  const current = history.entries[history.pointer]
  if (
    edit.coalesceKey !== undefined &&
    current.coalesceKey === edit.coalesceKey &&
    now - current.updatedAt <= COALESCE_WINDOW_MS
  ) {
    const merged: HistoryCheckpoint = {
      ...current,
      theme: edit.theme,
      tokens: cloneTokens(edit.tokens),
      label: edit.label,
      updatedAt: now,
    }
    const entries = history.entries.slice(0, history.pointer + 1)
    entries[history.pointer] = merged
    return { history: { ...history, entries }, coalesced: true }
  }

  const checkpoint: HistoryCheckpoint = {
    theme: edit.theme,
    tokens: cloneTokens(edit.tokens),
    label: edit.label,
    createdAt: now,
    updatedAt: now,
    coalesceKey: edit.coalesceKey,
  }
  const entries = [...history.entries.slice(0, history.pointer + 1), checkpoint]
  const trimmed = entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries
  return { history: { entries: trimmed, pointer: trimmed.length - 1 }, coalesced: false }
}

export function canUndo(history: EditHistory): boolean {
  return history.pointer > 0
}

export function canRedo(history: EditHistory): boolean {
  return history.pointer < history.entries.length - 1
}

/** 撤销一步：指针前移到上一个检查点，检查点本身保留以便重做 */
export function undo(history: EditHistory): EditHistory {
  return canUndo(history) ? { ...history, pointer: history.pointer - 1 } : history
}

/** 重做一步：指针后移，恢复之前撤销掉的检查点 */
export function redo(history: EditHistory): EditHistory {
  return canRedo(history) ? { ...history, pointer: history.pointer + 1 } : history
}

/** 跳转到任意检查点（点击历史列表中的某一步） */
export function jumpTo(history: EditHistory, index: number): EditHistory {
  if (index < 0 || index >= history.entries.length || index === history.pointer) return history
  return { ...history, pointer: index }
}

export function currentCheckpoint(history: EditHistory): HistoryCheckpoint {
  return history.entries[history.pointer]
}

/** 撤销后将“回到”的检查点（即当前步的前一步） */
export function undoTarget(history: EditHistory): HistoryCheckpoint | null {
  return canUndo(history) ? history.entries[history.pointer - 1] : null
}

/** 重做后将“恢复”的检查点（即当前步的后一步） */
export function redoTarget(history: EditHistory): HistoryCheckpoint | null {
  return canRedo(history) ? history.entries[history.pointer + 1] : null
}

const THEMES: BrandTheme[] = ['studio', 'editorial', 'night']

function sanitizeCheckpoint(value: unknown): HistoryCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<HistoryCheckpoint>
  if (!candidate.theme || !THEMES.includes(candidate.theme)) return null
  if (!candidate.tokens || validateTokens(candidate.tokens)) return null
  if (typeof candidate.label !== 'string' || typeof candidate.createdAt !== 'number' || typeof candidate.updatedAt !== 'number') return null
  if (candidate.coalesceKey !== undefined && typeof candidate.coalesceKey !== 'string') return null
  return {
    theme: candidate.theme,
    tokens: cloneTokens(candidate.tokens),
    label: candidate.label,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    ...(candidate.coalesceKey !== undefined ? { coalesceKey: candidate.coalesceKey } : {}),
  }
}

/**
 * 清洗从本地存储读出的历史。结构损坏、令牌不合法时返回 null，
 * 由上层按当前文档状态重建单步历史，保证不会因为坏数据丢失整个文档。
 */
export function sanitizeHistory(value: unknown): EditHistory | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<EditHistory>
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) return null
  const entries = candidate.entries.map(sanitizeCheckpoint)
  if (entries.some((entry) => entry === null)) return null
  const validEntries = entries as HistoryCheckpoint[]
  if (validEntries.length > HISTORY_LIMIT) return null
  const pointer = candidate.pointer
  if (typeof pointer !== 'number' || !Number.isInteger(pointer) || pointer < 0 || pointer >= validEntries.length) return null
  return { entries: validEntries, pointer }
}

/** 判断历史当前步是否与文档当前状态一致（加载后用于决定指针是否可用） */
export function historyMatches(history: EditHistory, theme: BrandTheme, tokens: BrandTokens): boolean {
  const checkpoint = currentCheckpoint(history)
  if (checkpoint.theme !== theme) return false
  if (!isHexColor(tokens.primary) || !isHexColor(tokens.secondary)) return false
  return JSON.stringify(checkpoint.tokens) === JSON.stringify(tokens)
}
