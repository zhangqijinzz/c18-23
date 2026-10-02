import { clampTokenValues, cloneTokens, contrastRatio, makeCheckpoint, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import { COALESCE_WINDOW_MS, HISTORY_LIMIT, INITIAL_TOKENS, THEME_PRESETS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type EditHistory, type HistoryCheckpoint, type HistoryEntry, type HistoryStep, type SavedVersion } from '../models/brandMirrorModels'

type Listener = () => void
type Clock = () => number

const SCALE_LABELS: Record<'radiusScale' | 'spacingScale' | 'typeScale', string> = {
  radiusScale: '圆角尺度',
  spacingScale: '间距体系',
  typeScale: '字体比例',
}

export class BrandMirrorViewModel {
  private tokens: BrandDocument['tokens'] = cloneTokens(INITIAL_TOKENS)
  private theme: BrandTheme = 'studio'
  private versions: SavedVersion[] = []
  private compareMode = false
  private status: BrandMirrorSnapshot['status'] = 'loading'
  private message = ''
  private history!: EditHistory
  /** 最近一次连续微调的合并键与时间；切换主题/恢复默认/保存版本后立即断开，后续修改另起一步 */
  private openGroup: { key: string; at: number } | null = null

  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter
  private readonly clock: Clock

  constructor(repository: BrandRepository, exporter?: BrandGuidelinesExporter, clock: Clock = () => Date.now()) {
    this.repository = repository
    this.exporter = exporter
    this.clock = clock
    this.seedHistory('初始状态', makeCheckpoint(INITIAL_TOKENS, 'studio'))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): BrandMirrorSnapshot {
    const historySteps: HistoryStep[] = this.allEntries().map((entry, index) => ({ id: `history-${index}`, label: entry.label, at: entry.at }))
    const currentHistoryId = historySteps[this.history.past.length]?.id ?? null
    return {
      status: this.status,
      tokens: cloneTokens(this.tokens),
      theme: this.theme,
      versions: this.versions,
      compareMode: this.compareMode,
      activeVersionId: this.versions[this.versions.length - 1]?.id ?? null,
      contrastRatio: contrastRatio(this.tokens.primary, this.tokens.secondary),
      contrastWarning: contrastRatio(this.tokens.primary, this.tokens.secondary) < 3,
      message: this.message,
      canUndo: this.history.past.length > 0,
      canRedo: this.history.future.length > 0,
      historySteps,
      currentHistoryId,
    }
  }

  initialize(): void {
    const stored = this.repository.load()
    if (stored) {
      this.versions = stored.versions
      if (stored.history) {
        this.history = stored.history
        this.applyCheckpoint(this.history.present.checkpoint)
      } else {
        this.applyCheckpoint(makeCheckpoint(stored.tokens, stored.theme))
        this.seedHistory('恢复的工作状态', makeCheckpoint(stored.tokens, stored.theme))
      }
      this.message = '已恢复最近一次工作状态'
    } else {
      this.applyCheckpoint(makeCheckpoint(INITIAL_TOKENS, 'studio'))
      this.seedHistory('初始状态', makeCheckpoint(INITIAL_TOKENS, 'studio'))
      this.message = '从 Studio warm 开始探索'
    }
    this.openGroup = null
    this.compareMode = false
    this.status = 'ready'
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    this.commit({ tokens: themeTokens(theme), theme }, `主题 · ${THEME_PRESETS[theme].label}`, { coalesceKey: `theme:${theme}` })
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    const color = normalizeColor(value)
    this.commit({ tokens: { ...this.tokens, [field]: color } }, `${field === 'primary' ? '主色' : '辅助色'} · ${color}`, { coalesceKey: `color:${field}` })
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    const values = [...this.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    const tokens = clampTokenValues({ ...this.tokens, [field]: values })
    this.commit({ tokens }, `${SCALE_LABELS[field]} ${index + 1} · ${tokens[field][index]}px`, { coalesceKey: `scale:${field}:${index}` })
  }

  reset(): void {
    this.commit({ tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio' }, '恢复默认', { coalesceKey: 'reset' })
  }

  undo(): void {
    const previous = this.history.past[this.history.past.length - 1]
    if (!previous) return
    const undoneLabel = this.history.present.label
    this.history = {
      past: this.history.past.slice(0, -1),
      present: previous,
      future: [this.history.present, ...this.history.future],
    }
    this.applyCheckpoint(previous.checkpoint)
    this.openGroup = null
    this.persistCurrent('ready', `已撤销：${undoneLabel}`)
  }

  redo(): void {
    const next = this.history.future[0]
    if (!next) return
    this.history = {
      past: [...this.history.past, this.history.present],
      present: next,
      future: this.history.future.slice(1),
    }
    this.applyCheckpoint(next.checkpoint)
    this.openGroup = null
    this.persistCurrent('ready', `已重做：${next.label}`)
  }

  /** 跳转到历史列表中任意一步（更早的步骤等价于多次撤销，更晚的等价于多次重做） */
  jumpToHistory(stepId: string): void {
    const entries = this.allEntries()
    const targetIndex = entries.findIndex((_, index) => `history-${index}` === stepId)
    if (targetIndex < 0 || targetIndex === this.history.past.length) return
    const target = entries[targetIndex]
    const currentIndex = this.history.past.length
    // redo 栈按「下一次重做到达的步骤」在前排列：被回退掉的步骤（正序）后接原有的 redo 分支
    this.history = {
      past: entries.slice(0, targetIndex) as HistoryEntry[],
      present: target,
      future: entries.slice(targetIndex + 1, currentIndex + 1).concat(entries.slice(currentIndex + 1)) as HistoryEntry[],
    }
    this.applyCheckpoint(target.checkpoint)
    this.openGroup = null
    this.persistCurrent('ready', `已跳转到：${target.label}`)
  }

  saveVersion(): void {
    const validationError = validateTokens(this.tokens)
    if (validationError) {
      this.status = 'error'
      this.message = validationError
      this.emit()
      return
    }
    const nextVersion: SavedVersion = {
      id: `version-${this.clock()}`,
      label: this.versions.length === 0 ? 'Version A' : `Version ${String.fromCharCode(65 + this.versions.length)}`,
      tokens: cloneTokens(this.tokens),
      createdAt: new Date(this.clock()).toISOString(),
    }
    this.versions = [...this.versions, nextVersion]
    // 保存版本是里程碑：不产生撤销步骤，并切断连续微调的合并
    this.openGroup = null
    this.persistCurrent('ready', '版本已保存')
  }

  toggleCompare(): void {
    this.compareMode = !this.compareMode
    this.message = this.compareMode ? '正在对比最近两个版本' : '已退出对比模式'
    this.emit()
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.getSnapshot())
      this.message = '品牌规范已导出'
    } catch {
      this.status = 'error'
      this.message = '导出失败，请稍后重试'
    }
    this.emit()
  }

  private commit(next: Partial<Pick<BrandDocument, 'tokens' | 'theme'>>, label: string, options: { coalesceKey: string }): void {
    const checkpoint = makeCheckpoint(next.tokens ?? this.tokens, next.theme ?? this.theme)
    const now = this.clock()
    const canCoalesce = this.openGroup !== null
      && this.openGroup.key === options.coalesceKey
      && now - this.openGroup.at <= COALESCE_WINDOW_MS
    if (canCoalesce && this.openGroup) {
      this.history = {
        ...this.history,
        present: { ...this.history.present, checkpoint, label, at: now },
      }
      this.openGroup = { key: options.coalesceKey, at: now }
    } else {
      this.history = {
        past: [...this.history.past, this.history.present].slice(-HISTORY_LIMIT),
        present: { label, at: now, checkpoint },
        future: [],
      }
      this.openGroup = { key: options.coalesceKey, at: now }
    }
    this.applyCheckpoint(checkpoint)
    this.persistCurrent('editing', label)
  }

  private persistCurrent(status: BrandMirrorSnapshot['status'], message: string): void {
    try {
      this.repository.save({ version: 1, tokens: this.tokens, theme: this.theme, versions: this.versions, history: this.history })
      this.status = status
      this.message = message
    } catch {
      this.status = 'error'
      this.message = '本地保存失败，但当前编辑仍保留在页面中'
    }
    this.emit()
  }

  private applyCheckpoint(checkpoint: HistoryCheckpoint): void {
    this.tokens = cloneTokens(checkpoint.tokens)
    this.theme = checkpoint.theme
  }

  private seedHistory(label: string, checkpoint: HistoryCheckpoint): void {
    this.history = { past: [], present: { label, at: this.clock(), checkpoint }, future: [] }
  }

  private allEntries(): HistoryEntry[] {
    return [...this.history.past, this.history.present, ...this.history.future]
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
