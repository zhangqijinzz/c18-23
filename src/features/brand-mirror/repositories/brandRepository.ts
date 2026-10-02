import type { BrandDocument } from '../models/brandMirrorModels'
import { clampTokenValues, validateTokens } from '../domain/brandRules'
import { createHistory, historyMatches, sanitizeHistory } from '../domain/editHistory'
import type { StorageService } from '../services/storageService'

export interface BrandRepository {
  load(): BrandDocument | null
  save(document: BrandDocument): void
}

export class LocalBrandRepository implements BrandRepository {
  constructor(private readonly storage: StorageService) {}

  load(): BrandDocument | null {
    const raw = this.storage.read()
    if (!raw) return null
    try {
      const candidate: unknown = JSON.parse(raw)
      if (!isDocument(candidate)) return null
      const tokens = clampTokenValues(candidate.tokens)
      // 历史损坏或与文档状态对不上时，从当前状态重建单步历史，
      // 避免页面重开后指针指向与本地保存内容不一致的检查点。
      const history = sanitizeHistory(candidate.history) ?? undefined
      const validHistory = history && historyMatches(history, candidate.theme, tokens)
        ? history
        : createHistory(candidate.theme, tokens, '上次保存的状态', Date.now())
      return { ...candidate, tokens, history: validHistory }
    } catch {
      return null
    }
  }

  save(document: BrandDocument): void {
    const validationError = validateTokens(document.tokens)
    if (validationError) throw new Error(validationError)
    this.storage.write(JSON.stringify(document))
  }
}

function isDocument(value: unknown): value is BrandDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrandDocument>
  return candidate.version === 1 && !!candidate.tokens && Array.isArray(candidate.versions) && typeof candidate.theme === 'string'
}
