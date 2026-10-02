import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import { canRedo, canUndo, commitEdit, createHistory, currentCheckpoint, jumpTo, redo, redoTarget, undo, undoTarget } from '../domain/editHistory'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import { INITIAL_TOKENS, THEME_PRESETS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type BrandTokens, type EditHistory, type HistoryStepView, type SavedVersion } from '../models/brandMirrorModels'

type Listener = () => void
type Clock = () => number

const SCALE_LABELS: Record<'radiusScale' | 'spacingScale' | 'typeScale', string> = {
  radiusScale: '圆角尺度',
  spacingScale: '间距体系',
  typeScale: '字体比例',
}

export class BrandMirrorViewModel {
  private history: EditHistory = createHistory('studio', INITIAL_TOKENS, '初始状态', Date.now())
  private versions: SavedVersion[] = []
  private compareMode = false
  private status: BrandMirrorSnapshot['status'] = 'ready'
  private message = ''
  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter
  private readonly clock: Clock

  constructor(repository: BrandRepository, exporter?: BrandGuidelinesExporter, clock: Clock = Date.now) {
    this.repository = repository
    this.exporter = exporter
    this.clock = clock
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): BrandMirrorSnapshot {
    return this.makeSnapshot()
  }

  initialize(): void {
    const stored = this.repository.load()
    if (stored) {
      this.history = stored.history ?? createHistory(stored.theme, stored.tokens, '上次保存的状态', this.clock())
      this.versions = stored.versions
      this.status = 'ready'
      this.message = '已恢复最近一次工作状态（含编辑历史）'
    } else {
      this.history = createHistory('studio', INITIAL_TOKENS, '初始状态', this.clock())
      this.versions = []
      this.status = 'ready'
      this.message = '从 Studio warm 开始探索'
    }
    this.compareMode = false
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    const current = currentCheckpoint(this.history)
    if (theme === current.theme && this.isSameTokens(themeTokens(theme), current.tokens)) return
    this.commit({
      theme,
      tokens: themeTokens(theme),
      label: `切换主题 · ${THEME_PRESETS[theme].label}`,
    })
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    const color = normalizeColor(value)
    const current = currentCheckpoint(this.history)
    if (color === current.tokens[field]) return
    this.commit({
      tokens: { ...current.tokens, [field]: color },
      label: field === 'primary' ? '主色调整' : '辅助色调整',
      coalesceKey: `color:${field}`,
    })
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    const current = currentCheckpoint(this.history)
    const values = [...current.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    const tokens = clampTokenValues({ ...current.tokens, [field]: values })
    if (tokens[field][index] === current.tokens[field][index]) return
    this.commit({
      tokens,
      label: `${SCALE_LABELS[field]}调整`,
      coalesceKey: `scale:${field}:${index}`,
    })
  }

  reset(): void {
    const current = currentCheckpoint(this.history)
    if (current.theme === 'studio' && this.isSameTokens(INITIAL_TOKENS, current.tokens)) return
    this.commit({
      theme: 'studio',
      tokens: cloneTokens(INITIAL_TOKENS),
      label: '恢复默认令牌',
    })
  }

  undoEdit(): void {
    const target = undoTarget(this.history)
    if (!target) return
    this.history = undo(this.history)
    this.status = 'ready'
    this.message = `已撤销，回到「${target.label}」`
    this.persistCurrent()
  }

  redoEdit(): void {
    if (!canRedo(this.history)) return
    this.history = redo(this.history)
    const target = currentCheckpoint(this.history)
    this.status = 'ready'
    this.message = `已重做「${target.label}」`
    this.persistCurrent()
  }

  jumpToStep(index: number): void {
    if (index === this.history.pointer || index < 0 || index >= this.history.entries.length) return
    const target = this.history.entries[index]
    this.history = jumpTo(this.history, index)
    this.status = 'ready'
    this.message = `已回到「${target.label}」`
    this.persistCurrent()
  }

  saveVersion(): void {
    const { tokens } = currentCheckpoint(this.history)
    const validationError = validateTokens(tokens)
    if (validationError) {
      this.status = 'error'
      this.message = validationError
      this.emit()
      return
    }
    const nextVersion: SavedVersion = {
      id: `version-${Date.now()}`,
      label: this.versions.length === 0 ? 'Version A' : `Version ${String.fromCharCode(65 + this.versions.length)}`,
      tokens: cloneTokens(tokens),
      createdAt: new Date().toISOString(),
    }
    this.versions = [...this.versions, nextVersion]
    // 保存版本是独立于编辑历史的动作：历史原样保留，保存之后仍可继续撤销。
    this.status = 'ready'
    this.persistWithMessage('版本已保存（撤销不受影响）', 'ready')
  }

  toggleCompare(): void {
    this.compareMode = !this.compareMode
    this.message = this.compareMode ? '正在对比最近两个版本' : '已退出对比模式'
    this.emit()
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.makeSnapshot())
      this.message = '品牌规范已导出'
    } catch {
      this.status = 'error'
      this.message = '导出失败，请稍后重试'
    }
    this.emit()
  }

  private commit(edit: { theme?: BrandTheme; tokens: BrandTokens; label: string; coalesceKey?: string }): void {
    const current = currentCheckpoint(this.history)
    const result = commitEdit(
      this.history,
      { theme: edit.theme ?? current.theme, tokens: edit.tokens, label: edit.label, coalesceKey: edit.coalesceKey },
      this.clock(),
    )
    this.history = result.history
    this.status = 'editing'
    this.message = result.coalesced ? `${edit.label}（连续微调已合并为一步）` : edit.label
    this.persistCurrent()
  }

  private isSameTokens(first: BrandDocument['tokens'], second: BrandDocument['tokens']): boolean {
    return JSON.stringify(first) === JSON.stringify(second)
  }

  private persistCurrent(): void {
    this.writeToRepository('本地保存失败，但当前编辑仍保留在页面中')
    this.emit()
  }

  private persistWithMessage(message: string, status: BrandMirrorSnapshot['status']): void {
    this.status = status
    this.message = message
    // 写盘失败时 writeToRepository 会把状态改写为 error 并附上失败原因
    this.writeToRepository('版本保存失败，请稍后重试')
    this.emit()
  }

  /** 返回 true 表示写入成功；失败时写入错误状态 */
  private writeToRepository(failureMessage: string): boolean {
    const checkpoint = currentCheckpoint(this.history)
    try {
      // 每次编辑/撤销/重做/跳转都立即写盘：
      // 页面显示的内容与 localStorage 中的文档始终指向同一个检查点。
      this.repository.save({
        version: 1,
        tokens: checkpoint.tokens,
        theme: checkpoint.theme,
        versions: this.versions,
        history: this.history,
      })
      return true
    } catch {
      this.status = 'error'
      this.message = failureMessage
      return false
    }
  }

  private makeSnapshot(): BrandMirrorSnapshot {
    const checkpoint = currentCheckpoint(this.history)
    const tokens = cloneTokens(checkpoint.tokens)
    const ratio = contrastRatio(tokens.primary, tokens.secondary)
    const latestVersion = this.versions[this.versions.length - 1]
    return {
      status: this.status,
      tokens,
      theme: checkpoint.theme,
      versions: this.versions,
      compareMode: this.compareMode,
      activeVersionId: latestVersion?.id ?? null,
      contrastRatio: ratio,
      contrastWarning: ratio < 3,
      message: this.message,
      historySteps: this.buildHistorySteps(),
      canUndo: canUndo(this.history),
      canRedo: canRedo(this.history),
      undoLabel: undoTarget(this.history)?.label ?? null,
      redoLabel: redoTarget(this.history)?.label ?? null,
    }
  }

  private buildHistorySteps(): HistoryStepView[] {
    return this.history.entries.map((entry, index) => ({
      index,
      label: entry.label,
      timestamp: entry.updatedAt,
      current: index === this.history.pointer,
      undone: index > this.history.pointer,
    }))
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
