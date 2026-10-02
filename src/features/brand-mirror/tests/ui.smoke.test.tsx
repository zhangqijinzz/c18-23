import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import type { BrandDocument } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { BrandMirrorPage } from '../views/BrandMirrorPage'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void { this.document = document }
}

function setNumberValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('BrandMirrorPage history UI', () => {
  it('renders undo/redo controls, coalesces rapid edits and undoes them', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const clock = vi.fn(() => 1_000_000)
    const viewModel = new BrandMirrorViewModel(new MemoryRepository(), undefined, clock)
    const root = createRoot(container)

    await act(async () => { root.render(<BrandMirrorPage viewModel={viewModel} />) })

    const toolbarButtons = container.querySelectorAll('.history-button')
    expect(toolbarButtons).toHaveLength(2)
    const undoButton = toolbarButtons[0] as HTMLButtonElement
    const redoButton = toolbarButtons[1] as HTMLButtonElement
    expect(undoButton.disabled).toBe(true)
    expect(redoButton.disabled).toBe(true)

    const allScaleInputs = container.querySelectorAll<HTMLInputElement>('.scale-inputs input')
    // 三组尺度：圆角 4 + 间距 5 + 字体 6，字体比例第 1 个即下标 9
    const firstTypeInput = allScaleInputs[9]
    expect(firstTypeInput.getAttribute('aria-label')).toContain('字体比例1')

    clock.mockReturnValue(2_000_000)
    await act(async () => { setNumberValue(firstTypeInput, '13') })
    clock.mockReturnValue(2_000_300)
    await act(async () => { setNumberValue(firstTypeInput, '14') })

    // 连续微调合并：初始步 + 一个编辑步
    expect(container.querySelectorAll('.history-step')).toHaveLength(2)
    expect(undoButton.disabled).toBe(false)
    expect(redoButton.disabled).toBe(true)
    expect(undoButton.title).toContain('初始状态')
    expect(container.querySelector('.feedback-toast strong')?.textContent).toContain('合并')

    await act(async () => { undoButton.click() })
    const restored = container.querySelectorAll<HTMLInputElement>('.scale-inputs input')[9]
    expect(restored.value).toBe('12')
    expect(redoButton.disabled).toBe(false)

    // 撤销后立即写盘：仓储内容与界面一致
    expect(viewModel.getSnapshot().tokens.typeScale[0]).toBe(12)
  })
})
