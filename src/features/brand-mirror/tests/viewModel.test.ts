import { describe, expect, it, vi } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import type { BrandDocument } from '../models/brandMirrorModels'
import { INITIAL_TOKENS } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { buildBrandGuidelinesMarkdown, type BrandGuidelinesExporter } from '../services/exportService'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  shouldFail = false
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void { if (this.shouldFail) throw new Error('offline'); this.document = document }
}

class MemoryExporter implements BrandGuidelinesExporter {
  received: string | null = null
  export(snapshot: Parameters<BrandGuidelinesExporter['export']>[0]): void { this.received = buildBrandGuidelinesMarkdown(snapshot) }
}

function createViewModel(repository = new MemoryRepository(), start = 1_000_000): { viewModel: BrandMirrorViewModel; clock: ReturnType<typeof vi.fn> } {
  const clock = vi.fn(() => start)
  const viewModel = new BrandMirrorViewModel(repository, undefined, clock)
  viewModel.initialize()
  return { viewModel, clock }
}

describe('BrandMirrorViewModel', () => {
  it('initializes, updates tokens and persists the latest state', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateScale('typeScale', 0, 18)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(18)
    expect(repository.document?.tokens.primary).toBe('#123456')
  })

  it('saves two versions and enters comparison mode', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version A', 'Version B'])
    expect(viewModel.getSnapshot().compareMode).toBe(true)
  })

  it('keeps editing usable when persistence fails', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    repository.shouldFail = true
    viewModel.updateColor('secondary', '#FFFFFF')
    expect(viewModel.getSnapshot().status).toBe('error')
    expect(viewModel.getSnapshot().tokens.secondary).toBe('#FFFFFF')
  })

  it('recovers a previously persisted document on initialization', () => {
    const repository = new MemoryRepository()
    repository.document = { version: 1, theme: 'night', tokens: { primary: '#A98BFF', secondary: '#191829', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38] }, versions: [] }
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    expect(viewModel.getSnapshot().theme).toBe('night')
    expect(viewModel.getSnapshot().message).toContain('恢复')
  })

  it('exports the current token system as brand guidelines', () => {
    const repository = new MemoryRepository()
    const exporter = new MemoryExporter()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.exportBrandGuidelines()
    expect(exporter.received).toContain('# BrandMirror 品牌规范')
    expect(exporter.received).toContain('`primary`')
    expect(viewModel.getSnapshot().message).toContain('导出')
  })

  it('undoes color and scale edits one checkpoint at a time and keeps storage in sync', () => {
    const repository = new MemoryRepository()
    const { viewModel, clock } = createViewModel(repository)
    clock.mockReturnValue(2_000_000)
    viewModel.updateColor('primary', '#123456')
    clock.mockReturnValue(3_000_000)
    viewModel.updateScale('typeScale', 0, 18)

    const snapshot = viewModel.getSnapshot()
    expect(snapshot.canUndo).toBe(true)
    expect(snapshot.undoLabel).toBe('主色调整')
    expect(snapshot.historySteps.map((step) => step.label)).toEqual(['初始状态', '主色调整', '字体比例调整'])

    viewModel.undoEdit()
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(INITIAL_TOKENS.typeScale[0])
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    // 撤销结果立即写盘，页面内容与本地保存不会对不上
    expect(repository.document?.tokens.typeScale[0]).toBe(INITIAL_TOKENS.typeScale[0])
    expect(repository.document?.history?.pointer).toBe(1)

    viewModel.undoEdit()
    expect(viewModel.getSnapshot().tokens.primary).toBe(INITIAL_TOKENS.primary)
    expect(viewModel.getSnapshot().canUndo).toBe(false)

    viewModel.redoEdit()
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    expect(viewModel.getSnapshot().redoLabel).toBe('字体比例调整')
  })

  it('coalesces rapid drag-like adjustments of the same scale slot into one step', () => {
    const { viewModel, clock } = createViewModel()
    clock.mockReturnValue(2_000_000)
    viewModel.updateScale('spacingScale', 2, 13)
    clock.mockReturnValue(2_000_300)
    viewModel.updateScale('spacingScale', 2, 14)
    clock.mockReturnValue(2_000_600)
    viewModel.updateScale('spacingScale', 2, 15)

    expect(viewModel.getSnapshot().historySteps).toHaveLength(2)
    expect(viewModel.getSnapshot().tokens.spacingScale[2]).toBe(15)
    expect(viewModel.getSnapshot().message).toContain('合并')

    viewModel.undoEdit()
    expect(viewModel.getSnapshot().tokens.spacingScale[2]).toBe(INITIAL_TOKENS.spacingScale[2])
  })

  it('keeps adjustments to different slots as separate steps', () => {
    const { viewModel, clock } = createViewModel()
    clock.mockReturnValue(2_000_000)
    viewModel.updateScale('spacingScale', 0, 6)
    clock.mockReturnValue(2_000_100)
    viewModel.updateScale('spacingScale', 1, 10)
    expect(viewModel.getSnapshot().historySteps).toHaveLength(3)
  })

  it('undoes theme switching and reset as their own steps', () => {
    const { viewModel, clock } = createViewModel()
    clock.mockReturnValue(2_000_000)
    viewModel.selectTheme('night')
    expect(viewModel.getSnapshot().theme).toBe('night')

    clock.mockReturnValue(3_000_000)
    viewModel.reset()
    expect(viewModel.getSnapshot().theme).toBe('studio')
    expect(viewModel.getSnapshot().tokens).toEqual(INITIAL_TOKENS)

    viewModel.undoEdit()
    expect(viewModel.getSnapshot().theme).toBe('night')
    viewModel.undoEdit()
    expect(viewModel.getSnapshot().theme).toBe('studio')
    expect(viewModel.getSnapshot().historySteps).toHaveLength(3)
  })

  it('does not undo away saved versions, and saving keeps the full history usable', () => {
    const repository = new MemoryRepository()
    const { viewModel, clock } = createViewModel(repository)
    clock.mockReturnValue(2_000_000)
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    expect(viewModel.getSnapshot().versions).toHaveLength(1)
    expect(viewModel.getSnapshot().canUndo).toBe(true)
    expect(viewModel.getSnapshot().message).toContain('撤销不受影响')

    viewModel.undoEdit()
    expect(viewModel.getSnapshot().tokens.primary).toBe(INITIAL_TOKENS.primary)
    expect(viewModel.getSnapshot().versions).toHaveLength(1)
    expect(repository.document?.versions).toHaveLength(1)
  })

  it('restores undo history after the page is reopened', () => {
    const repository = new MemoryRepository()
    const first = createViewModel(repository)
    first.clock.mockReturnValue(2_000_000)
    first.viewModel.updateColor('primary', '#123456')
    first.clock.mockReturnValue(3_000_000)
    first.viewModel.updateColor('secondary', '#FFFFFF')
    first.viewModel.undoEdit()

    // 模拟页面重开：用同一个本地仓储新建 ViewModel
    const reopened = new BrandMirrorViewModel(repository)
    reopened.initialize()
    const snapshot = reopened.getSnapshot()
    expect(snapshot.tokens.primary).toBe('#123456')
    expect(snapshot.tokens.secondary).toBe(INITIAL_TOKENS.secondary)
    expect(snapshot.canUndo).toBe(true)
    expect(snapshot.canRedo).toBe(true)
    expect(snapshot.message).toContain('编辑历史')

    reopened.redoEdit()
    expect(reopened.getSnapshot().tokens.secondary).toBe('#FFFFFF')
  })

  it('jumps to a specific history step directly', () => {
    const { viewModel, clock } = createViewModel()
    clock.mockReturnValue(2_000_000)
    viewModel.updateColor('primary', '#111111')
    clock.mockReturnValue(3_000_000)
    viewModel.updateColor('secondary', '#222222')
    clock.mockReturnValue(4_000_000)
    viewModel.reset()

    viewModel.jumpToStep(1)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#111111')
    expect(viewModel.getSnapshot().tokens.secondary).toBe(INITIAL_TOKENS.secondary)
    expect(viewModel.getSnapshot().historySteps[1].current).toBe(true)
    expect(viewModel.getSnapshot().historySteps[2].undone).toBe(true)
  })
})
