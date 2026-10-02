import type { BrandDocument, EditHistory } from '../models/brandMirrorModels'
import { clampTokenValues, parseHistoryEntry, validateTokens } from '../domain/brandRules'
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
      if (validateTokens(tokens)) return null
      return { ...candidate, tokens, history: parseHistory(candidate.history) ?? freshHistory(tokens, candidate.theme) }
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

function freshHistory(tokens: BrandDocument['tokens'], theme: BrandDocument['theme']): EditHistory {
  return { past: [], present: { label: '恢复的工作状态', at: Date.now(), checkpoint: { tokens, theme } }, future: [] }
}

function isDocument(value: unknown): value is BrandDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrandDocument>
  return candidate.version === 1 && !!candidate.tokens && Array.isArray(candidate.versions) && typeof candidate.theme === 'string'
}

function parseHistory(value: unknown): EditHistory | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<EditHistory>
  if (!Array.isArray(candidate.past) || !Array.isArray(candidate.future)) return null
  const past = candidate.past.map(parseHistoryEntry)
  const future = candidate.future.map(parseHistoryEntry)
  const present = parseHistoryEntry(candidate.present)
  if (!present || past.some((entry) => entry === null) || future.some((entry) => entry === null)) return null
  return { past: past as EditHistory['past'], present, future: future as EditHistory['future'] }
}
