export type BrandTheme = 'studio' | 'editorial' | 'night'
export type MirrorStatus = 'loading' | 'ready' | 'editing' | 'error'

export interface BrandTokens {
  primary: string
  secondary: string
  radiusScale: number[]
  spacingScale: number[]
  typeScale: number[]
}

export interface SavedVersion {
  id: string
  label: string
  tokens: BrandTokens
  createdAt: string
}

/**
 * 编辑历史中的一个检查点。检查点记录“该步完成之后”的完整文档状态，
 * 撤销/重做/跳转都通过检查点恢复，避免反向操作带来的误差累积。
 */
export interface HistoryCheckpoint {
  /** 该步操作完成后所处的主题 */
  theme: BrandTheme
  /** 该步操作完成后的令牌快照 */
  tokens: BrandTokens
  /** 该步的可读名称，如「主色调整」「切换主题 · Night signal」 */
  label: string
  /** 首次提交时间 */
  createdAt: number
  /** 最后一次合并进来的时间，用于连续微调合并判断 */
  updatedAt: number
  /** 合并键：相同键的连续编辑在时间窗内合并为一步（初始检查点没有键） */
  coalesceKey?: string
}

export interface EditHistory {
  /** 完整检查点栈（含初始检查点） */
  entries: HistoryCheckpoint[]
  /** 当前指向的检查点下标；撤销会前移，重做/新提交会后移 */
  pointer: number
}

export interface BrandDocument {
  version: 1
  tokens: BrandTokens
  theme: BrandTheme
  versions: SavedVersion[]
  /**
   * 编辑历史随文档一起持久化，页面重开后仍可撤销/重做。
   * 旧数据没有该字段时按当前状态重建为单步历史。
   */
  history?: EditHistory
}

export interface HistoryStepView {
  /** 与 EditHistory.entries 一致的下标 */
  index: number
  label: string
  timestamp: number
  /** 当前文档正停在这一步 */
  current: boolean
  /** 在当前步之后，会被新编辑覆盖掉的步骤 */
  undone: boolean
}

export interface BrandMirrorSnapshot {
  status: MirrorStatus
  tokens: BrandTokens
  theme: BrandTheme
  versions: SavedVersion[]
  compareMode: boolean
  activeVersionId: string | null
  contrastRatio: number
  contrastWarning: boolean
  message: string
  /** 撤销/重做/跳转用的历史步骤视图，按时间从旧到新排列 */
  historySteps: HistoryStepView[]
  canUndo: boolean
  canRedo: boolean
  /** 撤销时将回到的步骤名称（按钮提示用） */
  undoLabel: string | null
  /** 重做时将恢复的步骤名称（按钮提示用） */
  redoLabel: string | null
}

export const INITIAL_TOKENS: BrandTokens = {
  primary: '#F15A47',
  secondary: '#24324A',
  radiusScale: [8, 12, 18, 28],
  spacingScale: [4, 8, 12, 20, 32],
  typeScale: [12, 14, 16, 20, 28, 40],
}

export const THEME_PRESETS: Record<BrandTheme, { label: string; tokens: BrandTokens }> = {
  studio: {
    label: 'Studio warm',
    tokens: INITIAL_TOKENS,
  },
  editorial: {
    label: 'Editorial green',
    tokens: {
      primary: '#238B73', secondary: '#173C35', radiusScale: [4, 8, 12, 18], spacingScale: [4, 8, 16, 24, 40], typeScale: [12, 14, 16, 22, 30, 44],
    },
  },
  night: {
    label: 'Night signal',
    tokens: {
      primary: '#A98BFF', secondary: '#191829', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38],
    },
  },
}
