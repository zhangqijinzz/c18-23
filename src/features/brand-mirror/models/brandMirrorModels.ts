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

/** 历史中的一个检查点：只记录可撤销的工作区内容（令牌 + 主题），版本列表是追加式里程碑，不参与撤销 */
export interface HistoryCheckpoint {
  tokens: BrandTokens
  theme: BrandTheme
}

/** 一条历史步骤；label 是该步骤进入的状态描述，如「主色 · #123456」 */
export interface HistoryEntry {
  label: string
  at: number
  checkpoint: HistoryCheckpoint
}

export interface EditHistory {
  past: HistoryEntry[]
  present: HistoryEntry
  future: HistoryEntry[]
}

export interface BrandDocument {
  version: 1
  tokens: BrandTokens
  theme: BrandTheme
  versions: SavedVersion[]
  history: EditHistory
}

export interface HistoryStep {
  id: string
  label: string
  at: number
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
  canUndo: boolean
  canRedo: boolean
  /** 按时间顺序排列的全部历史步骤（past → 当前 → future） */
  historySteps: HistoryStep[]
  currentHistoryId: string | null
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

export const HISTORY_LIMIT = 50
export const COALESCE_WINDOW_MS = 800
