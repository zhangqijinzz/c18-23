import type { BrandTheme, BrandTokens, HistoryCheckpoint, HistoryEntry } from '../models/brandMirrorModels'
import { INITIAL_TOKENS, THEME_PRESETS } from '../models/brandMirrorModels'

const HEX_COLOR = /^#[0-9A-F]{6}$/i

export function cloneTokens(tokens: BrandTokens): BrandTokens {
  return { ...tokens, radiusScale: [...tokens.radiusScale], spacingScale: [...tokens.spacingScale], typeScale: [...tokens.typeScale] }
}

export function makeCheckpoint(tokens: BrandTokens, theme: BrandTheme): HistoryCheckpoint {
  return { tokens: cloneTokens(tokens), theme }
}

function asFiniteNumberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const numbers = value.map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number.NaN))
  return numbers.some((item) => Number.isNaN(item)) ? null : numbers
}

function safeTokens(value: unknown): BrandTokens | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<BrandTokens>
  if (typeof candidate.primary !== 'string' || typeof candidate.secondary !== 'string') return null
  const radiusScale = asFiniteNumberList(candidate.radiusScale)
  const spacingScale = asFiniteNumberList(candidate.spacingScale)
  const typeScale = asFiniteNumberList(candidate.typeScale)
  if (!radiusScale || !spacingScale || !typeScale) return null
  const tokens: BrandTokens = {
    primary: candidate.primary,
    secondary: candidate.secondary,
    radiusScale,
    spacingScale,
    typeScale,
  }
  return validateTokens(tokens) ? null : tokens
}

/** 校验来自存储的历史条目；任何字段损坏都丢弃，避免恢复出不可信的检查点 */
export function parseHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<HistoryEntry>
  if (typeof candidate.label !== 'string' || typeof candidate.at !== 'number' || !candidate.checkpoint) return null
  if (candidate.checkpoint.theme !== 'studio' && candidate.checkpoint.theme !== 'editorial' && candidate.checkpoint.theme !== 'night') return null
  const tokens = safeTokens(candidate.checkpoint.tokens)
  if (!tokens) return null
  return { label: candidate.label, at: candidate.at, checkpoint: { tokens: clampTokenValues(tokens), theme: candidate.checkpoint.theme } }
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value)
}

export function normalizeColor(value: string): string {
  const candidate = value.trim().toUpperCase()
  return isHexColor(candidate) ? candidate : INITIAL_TOKENS.primary
}

export function clampTokenValues(tokens: BrandTokens): BrandTokens {
  const roundInto = (values: number[], min: number, max: number): number[] =>
    (Array.isArray(values) ? values : []).map((value) => Math.min(max, Math.max(min, Math.round(value))))
  return {
    primary: tokens.primary,
    secondary: tokens.secondary,
    radiusScale: roundInto(tokens.radiusScale, 0, 40),
    spacingScale: roundInto(tokens.spacingScale, 2, 64),
    typeScale: roundInto(tokens.typeScale, 10, 72),
  }
}

export function validateTokens(tokens: BrandTokens): string | null {
  if (!isHexColor(tokens.primary) || !isHexColor(tokens.secondary)) return '请输入 6 位 HEX 颜色'
  if (tokens.radiusScale.length !== 4 || tokens.spacingScale.length !== 5 || tokens.typeScale.length !== 6) return '令牌层级数量不完整'
  if (tokens.typeScale.some((value) => value < 10 || value > 72)) return '字号范围应在 10–72px'
  return null
}

function channel(value: number): number {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function luminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

export function contrastRatio(first: string, second: string): number {
  const one = luminance(first)
  const two = luminance(second)
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)
}

export function themeTokens(theme: BrandTheme): BrandTokens {
  return cloneTokens(THEME_PRESETS[theme].tokens)
}
