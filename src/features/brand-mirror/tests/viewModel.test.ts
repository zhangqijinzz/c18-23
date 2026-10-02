import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import { COALESCE_WINDOW_MS, type BrandDocument, type EditHistory } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { buildBrandGuidelinesMarkdown, type BrandGuidelinesExporter } from '../services/exportService'

/** 模拟存储层；document 允许缺少 history，用来兼容旧版本数据 */
class MemoryRepository implements BrandRepository {
  document: (Omit<BrandDocument, 'history'> & { history?: EditHistory }) | null = null
  shouldFail = false
  load(): BrandDocument | null {
    return this.document as BrandDocument | null
  }
  save(document: BrandDocument): void {
    if (this.shouldFail) throw new Error('offline')
    this.document = document
  }
}

class MemoryExporter implements BrandGuidelinesExporter {
  received: string | null = null
  export(snapshot: Parameters<BrandGuidelinesExporter['export']>[0]): void { this.received = buildBrandGuidelinesMarkdown(snapshot) }
}

class FakeClock {
  now = 1_000_000
  current(): number { return this.now }
  advance(ms: number): void { this.now += ms }
}

function createViewModel(repository = new MemoryRepository()) {
  const clock = new FakeClock()
  const viewModel = new BrandMirrorViewModel(repository, undefined, () => clock.current())
  viewModel.initialize()
  return { repository, clock, viewModel }
}

describe('BrandMirrorViewModel', () => {
  it('initializes, updates tokens and persists the latest state', () => {
    const { repository, viewModel } = createViewModel()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateScale('typeScale', 0, 18)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(18)
    expect(repository.document?.tokens.primary).toBe('#123456')
  })

  it('saves two versions and enters comparison mode', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    viewModel.saveVersion()
    viewModel.toggleCompare()
    expect(viewModel.getSnapshot().versions.map((version) => version.label)).toEqual(['Version A', 'Version B'])
    expect(viewModel.getSnapshot().compareMode).toBe(true)
  })

  it('keeps editing usable when persistence fails', () => {
    const { repository, viewModel } = createViewModel()
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
    const clock = new FakeClock()
    const viewModel = new BrandMirrorViewModel(repository, exporter, () => clock.current())
    viewModel.initialize()
    viewModel.exportBrandGuidelines()
    expect(exporter.received).toContain('# BrandMirror 品牌规范')
    expect(exporter.received).toContain('`primary`')
    expect(viewModel.getSnapshot().message).toContain('导出')
  })

  it('coalesces rapid fine-grained edits to the same field into one history step', () => {
    const { clock, viewModel } = createViewModel()
    viewModel.updateScale('spacingScale', 2, 14)
    clock.advance(COALESCE_WINDOW_MS - 100)
    viewModel.updateScale('spacingScale', 2, 16)
    clock.advance(COALESCE_WINDOW_MS - 100)
    viewModel.updateScale('spacingScale', 2, 18)
    expect(viewModel.getSnapshot().tokens.spacingScale[2]).toBe(18)
    expect(viewModel.getSnapshot().historySteps).toHaveLength(2)
    expect(viewModel.getSnapshot().historySteps[1].label).toContain('18px')
  })

  it('starts a new step after the coalescing window or when a different field is edited', () => {
    const { clock, viewModel } = createViewModel()
    viewModel.updateScale('spacingScale', 2, 14)
    clock.advance(COALESCE_WINDOW_MS + 1)
    viewModel.updateScale('spacingScale', 2, 16)
    viewModel.updateColor('primary', '#ABCDEF')
    expect(viewModel.getSnapshot().historySteps).toHaveLength(4)
  })

  it('undoes and redoes color, theme switch and reset as discrete operations', () => {
    const { viewModel } = createViewModel()
    viewModel.updateColor('primary', '#123456')
    viewModel.selectTheme('night')
    viewModel.reset()

    expect(viewModel.getSnapshot().theme).toBe('studio')
    expect(viewModel.getSnapshot().canUndo).toBe(true)

    viewModel.undo()
    expect(viewModel.getSnapshot().theme).toBe('night')
    expect(viewModel.getSnapshot().tokens.primary).toBe('#A98BFF')

    viewModel.undo()
    expect(viewModel.getSnapshot().theme).toBe('studio')
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')

    viewModel.undo()
    expect(viewModel.getSnapshot().tokens.primary).toBe('#F15A47')
    expect(viewModel.getSnapshot().canUndo).toBe(false)

    viewModel.redo()
    expect(viewModel.getSnapshot().tokens.primary).toBe('#123456')
  })

  it('undoes theme and scale changes back to their original tokens', () => {
    const { viewModel } = createViewModel()
    viewModel.selectTheme('editorial')
    viewModel.updateScale('radiusScale', 0, 20)
    viewModel.undo()
    expect(viewModel.getSnapshot().tokens.radiusScale[0]).toBe(4)
    viewModel.undo()
    expect(viewModel.getSnapshot().theme).toBe('studio')
    expect(viewModel.getSnapshot().tokens.radiusScale[0]).toBe(8)
  })

  it('keeps saved versions when undoing across a save milestone', () => {
    const { viewModel } = createViewModel()
    viewModel.saveVersion()
    viewModel.updateColor('primary', '#238B73')
    expect(viewModel.getSnapshot().canUndo).toBe(true)
    viewModel.undo()
    expect(viewModel.getSnapshot().tokens.primary).toBe('#F15A47')
    expect(viewModel.getSnapshot().versions).toHaveLength(1)
    expect(viewModel.getSnapshot().message).toContain('撤销')
  })

  it('saves a new edit after undo discards the redo branch', () => {
    const { viewModel } = createViewModel()
    viewModel.updateColor('primary', '#123456')
    viewModel.updateColor('secondary', '#ABCDEF')
    viewModel.undo()
    expect(viewModel.getSnapshot().canRedo).toBe(true)
    viewModel.selectTheme('night')
    expect(viewModel.getSnapshot().canRedo).toBe(false)
    expect(viewModel.getSnapshot().theme).toBe('night')
  })

  it('jumps to any history step in one action', () => {
    const { clock, viewModel } = createViewModel()
    viewModel.updateColor('primary', '#111111')
    clock.advance(COALESCE_WINDOW_MS + 1)
    viewModel.updateColor('primary', '#222222')
    clock.advance(COALESCE_WINDOW_MS + 1)
    viewModel.updateColor('primary', '#333333')
    const steps = viewModel.getSnapshot().historySteps
    viewModel.jumpToHistory(steps[1].id)
    expect(viewModel.getSnapshot().tokens.primary).toBe('#111111')
    expect(viewModel.getSnapshot().historySteps).toHaveLength(4)
    viewModel.redo()
    expect(viewModel.getSnapshot().tokens.primary).toBe('#222222')
  })

  it('persists history with the document and restores it on reload', () => {
    const repository = new MemoryRepository()
    const first = createViewModel(repository)
    first.viewModel.updateColor('primary', '#123456')
    first.clock.advance(COALESCE_WINDOW_MS + 1)
    first.viewModel.updateScale('typeScale', 1, 22)
    first.viewModel.undo()
    const savedHistory = repository.document?.history
    expect(savedHistory?.past).toHaveLength(1)
    expect(savedHistory?.future).toHaveLength(1)

    const reloaded = new BrandMirrorViewModel(repository, undefined, () => first.clock.current())
    reloaded.initialize()
    expect(reloaded.getSnapshot().tokens.primary).toBe('#123456')
    expect(reloaded.getSnapshot().tokens.typeScale[1]).toBe(14)
    expect(reloaded.getSnapshot().canUndo).toBe(true)
    expect(reloaded.getSnapshot().canRedo).toBe(true)
    reloaded.redo()
    expect(reloaded.getSnapshot().tokens.typeScale[1]).toBe(22)
    reloaded.undo()
    reloaded.undo()
    expect(reloaded.getSnapshot().tokens.primary).toBe('#F15A47')
  })

  it('persists every undo/redo so the page matches local storage', () => {
    const { repository, viewModel } = createViewModel()
    viewModel.updateColor('primary', '#123456')
    viewModel.undo()
    expect(repository.document?.tokens.primary).toBe('#F15A47')
    viewModel.redo()
    expect(repository.document?.tokens.primary).toBe('#123456')
  })
})
