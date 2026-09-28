import type { Cue, CueOrderSummary, AdjacentTransition } from '@/types/cue'
import type { FixturePosition } from '@/types/fixture'
import type { ColorTempCheck, ColorTempItem } from '@/types/level'
import { COLOR_TEMP_TOLERANCE_K } from '@/types/level'
import type { RehearsalSheet, SheetCueLine } from '@/types/sheet'
import type { Session } from '@/types/session'
import { sortCues } from '@/utils/cueOrder'

/** 过渡比例：渐亮 / 保持 / 渐暗 各占的比例（0-1） */
export interface FadeRatio {
  fadeIn: number
  hold: number
  fadeOut: number
}

/** 保留一位小数 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 秒数格式化：`3s` / `3.5s` / `1m20s` */
export function formatSeconds(sec: number): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const rounded = round1(safe)
  if (rounded >= 60) {
    const minutes = Math.floor(rounded / 60)
    const rest = round1(rounded - minutes * 60)
    return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`
  }
  return `${rounded}s`
}

/** 时间戳 / ISO 字符串 → `YYYY-MM-DD HH:mm:ss` */
export function formatDateTime(value: string | number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`
}

/** 单条 Cue 的总时长（渐亮 + 保持 + 渐暗） */
export function cueTotalSeconds(cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>): number {
  return round1(cue.fadeInSec + cue.holdSec + cue.fadeOutSec)
}

/** 某条 Cue 已设定电平通道里最大的开灯延迟（秒）；未设定通道时为 0 */
export function maxDelayOfCue(levels: ReadonlyArray<{ delaySec?: number }>): number {
  return levels.reduce((max, level) => Math.max(max, normalizedDelay(level.delaySec)), 0)
}

/** 归一化开灯延迟：旧数据没有该字段时按 0 秒处理，保留一位小数且不小于 0 */
export function normalizedDelay(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return round1(Math.max(0, value))
}

/**
 * 一条 Cue 的实际总时长：最晚结束通道的开灯延迟把渐亮段整体后移，
 * 保持 / 渐暗仍沿 Cue 统一时间轴，因此为「基础时长 + 最晚通道延迟」。
 */
export function cueEffectiveSeconds(
  cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>,
  levels: ReadonlyArray<{ delaySec?: number }>
): number {
  return round1(cueTotalSeconds(cue) + maxDelayOfCue(levels))
}

/**
 * 非末条 Cue 的允许开灯延迟上限：
 * 下一条 Cue 在本条「渐亮 + 保持 + 渐暗」结束时触发，
 * 通道须在下一条触发前完成渐亮（延迟 + 渐亮 ≤ 下一条触发时刻），
 * 故上限为「保持 + 渐暗」。末条 Cue 没有下一条触发点，返回 null（不限制）。
 */
export function delayLimitOfCue(
  cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>,
  nextCue: Pick<Cue, 'id'> | null | undefined
): number | null {
  if (!nextCue) return null
  return round1(cue.holdSec + cue.fadeOutSec)
}

/** 开灯延迟校验输入 */
export interface DelayViolationInput {
  cue: Pick<Cue, 'id' | 'cueNo' | 'fadeInSec' | 'fadeOutSec' | 'holdSec'>
  /** 时间轴上的下一条 Cue；末条传 null / undefined 表示无上限 */
  nextCue?: Pick<Cue, 'id' | 'cueNo'> | null
  /** 该 Cue 下的通道电平（含待保存通道的拟设延迟） */
  levels: ReadonlyArray<{ fixtureId: string; channel?: number; delaySec?: number }>
  /** 待保存通道；传入时以其覆盖 levels 中的同通道延迟 */
  pending?: { fixtureId: string; channel: number; delaySec?: number }
}

/** 开灯延迟越界的单个通道 */
export interface DelayViolation {
  fixtureId: string
  channel: number
  delaySec: number
  /** 允许上限（秒）；末条 Cue 不会产生越界 */
  limitSec: number
}

/**
 * 校验一组通道延迟是否会把开灯结束时刻（延迟 + 渐亮）推过下一条 Cue 触发点。
 * 返回越界通道列表；末条 Cue 恒为空（无下一条触发约束）。
 */
export function findDelayViolations(input: DelayViolationInput): DelayViolation[] {
  const limit = delayLimitOfCue(input.cue, input.nextCue ?? null)
  if (limit === null) return []

  const pending = input.pending ?? null
  const pendingMap = new Map<string, number>()
  if (pending) pendingMap.set(pending.fixtureId, normalizedDelay(pending.delaySec))

  const violations: DelayViolation[] = []
  input.levels.forEach((level) => {
    const delay = pendingMap.has(level.fixtureId) ? pendingMap.get(level.fixtureId)! : normalizedDelay(level.delaySec)
    if (round1(delay + input.cue.fadeInSec) > limit + 1e-6) {
      const channel = pending?.fixtureId === level.fixtureId ? pending.channel : level.channel ?? 0
      violations.push({ fixtureId: level.fixtureId, channel, delaySec: delay, limitSec: limit })
    }
  })

  // 待保存通道可能是尚未建立电平记录的新通道
  if (pending && !input.levels.some((level) => level.fixtureId === pending.fixtureId)) {
    const delay = pendingMap.get(pending.fixtureId)!
    if (round1(delay + input.cue.fadeInSec) > limit + 1e-6) {
      violations.push({ fixtureId: pending.fixtureId, channel: pending.channel, delaySec: delay, limitSec: limit })
    }
  }
  return violations
}

/** 单条 Cue 的过渡描述文本 */
export function formatTransition(cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>): string {
  return `渐亮 ${formatSeconds(cue.fadeInSec)} → 保持 ${formatSeconds(cue.holdSec)} → 渐暗 ${formatSeconds(cue.fadeOutSec)}`
}

/** 渐变条比例：总时长为 0 时三段均为 0 */
export function fadeRatio(input: Pick<Cue, 'fadeInSec' | 'holdSec' | 'fadeOutSec'>): FadeRatio {
  const total = cueTotalSeconds(input)
  if (total <= 0) return { fadeIn: 0, hold: 0, fadeOut: 0 }
  return {
    fadeIn: input.fadeInSec / total,
    hold: input.holdSec / total,
    fadeOut: input.fadeOutSec / total
  }
}

/**
 * 汇总一组 Cue 的过渡时长，并给出相邻衔接关系。
 * `maxDelayByCue` 传入每条 Cue 最晚通道的开灯延迟；总时长按最晚结束的通道计。
 */
export function sumCues(input: readonly Cue[], maxDelayByCue?: ReadonlyMap<string, number>): CueOrderSummary {
  const cues = sortCues(input)
  let totalFadeInSec = 0
  let totalFadeOutSec = 0
  let totalHoldSec = 0
  let totalDelaySec = 0
  const adjacent: AdjacentTransition[] = []

  cues.forEach((cue, index) => {
    totalFadeInSec += cue.fadeInSec
    totalFadeOutSec += cue.fadeOutSec
    totalHoldSec += cue.holdSec
    totalDelaySec += normalizedDelay(maxDelayByCue?.get(cue.id))
    if (index === 0) return
    const previous = cues[index - 1]
    const gapSec = round1(previous.fadeOutSec + cue.fadeInSec)
    adjacent.push({
      fromCueId: previous.id,
      fromCueNo: previous.cueNo,
      toCueId: cue.id,
      toCueNo: cue.cueNo,
      gapSec,
      overlap: gapSec < 1
    })
  })

  return {
    totalFadeInSec: round1(totalFadeInSec),
    totalFadeOutSec: round1(totalFadeOutSec),
    totalHoldSec: round1(totalHoldSec),
    totalDelaySec: round1(totalDelaySec),
    totalSec: round1(totalFadeInSec + totalFadeOutSec + totalHoldSec + totalDelaySec),
    adjacent
  }
}

/** 色温一致性判定：以出现次数最多的色温为基准，超过容差即漂移 */
export function checkColorTempConsistency(
  input: ReadonlyArray<{ fixtureId: string; channel: number; position: FixturePosition; colorTempK: number }>
): ColorTempCheck {
  if (input.length === 0) {
    return {
      dominantK: 0,
      toleranceK: COLOR_TEMP_TOLERANCE_K,
      items: [],
      consistent: true,
      message: '尚未为该 Cue 设定任何通道电平'
    }
  }

  const histogram = new Map<number, number>()
  input.forEach((item) => histogram.set(item.colorTempK, (histogram.get(item.colorTempK) ?? 0) + 1))

  let dominantK = input[0].colorTempK
  let dominantCount = -1
  Array.from(histogram.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .forEach(([kelvin, count]) => {
      if (count > dominantCount) {
        dominantK = kelvin
        dominantCount = count
      }
    })

  const items: ColorTempItem[] = input.map((item) => {
    const driftK = Math.abs(item.colorTempK - dominantK)
    return { ...item, driftK, consistent: driftK <= COLOR_TEMP_TOLERANCE_K }
  })
  const drifted = items.filter((item) => !item.consistent)

  return {
    dominantK,
    toleranceK: COLOR_TEMP_TOLERANCE_K,
    items,
    consistent: drifted.length === 0,
    message:
      drifted.length === 0
        ? `色温一致：基准 ${dominantK}K，容差 ±${COLOR_TEMP_TOLERANCE_K}K`
        : `色温漂移：${drifted.map((item) => `CH${item.channel}(${item.colorTempK}K)`).join('、')} 偏离基准 ${dominantK}K`
  }
}

/** 把一条 Cue 快照渲染为多行文本 */
function formatCueLineText(line: SheetCueLine, index: number): string[] {
  const maxDelay = maxDelayOfCue(line.channels)
  const total = round1(line.fadeInSec + line.holdSec + line.fadeOutSec + maxDelay)
  const rows: string[] = []
  rows.push(`${String(index + 1).padStart(2, '0')}. ${line.cueNo}  ${line.label || '（无提示语）'}  [${line.trigger}]`)
  rows.push(`    过渡：渐亮 ${formatSeconds(line.fadeInSec)} / 保持 ${formatSeconds(line.holdSec)} / 渐暗 ${formatSeconds(
    line.fadeOutSec
  )}（合计 ${formatSeconds(total)}${maxDelay > 0 ? `，含最晚开灯延迟 ${formatSeconds(maxDelay)}` : ''}）`)
  if (line.note) rows.push(`    备注：${line.note}`)
  if (line.channels.length === 0) {
    rows.push('    通道电平：未设定')
  } else {
    line.channels.forEach((channel) => {
      rows.push(
        `    CH${String(channel.channel).padStart(3, ' ')} ${channel.position}/${channel.fixtureType}` +
          ` 亮度 ${channel.intensity}%  色温 ${channel.colorTempK}K  色纸 ${channel.gel || '—'}` +
          `  开灯延迟 ${formatSeconds(normalizedDelay(channel.delaySec))}` +
          (channel.focusNote ? `  对焦：${channel.focusNote}` : '')
      )
    })
  }
  return rows
}

/** 排演表纯文本拼装，用于预览、复制与导出 */
export function buildSheetText(sheet: RehearsalSheet, session?: Session): string {
  const lines: string[] = []
  lines.push('================ 剧场灯光排演表 ================')
  lines.push(`排演表编号：${sheet.sheetNo}`)
  lines.push(`场次：${session ? `${session.order}. ${session.title}` : '（场次已删除）'}`)
  if (session) {
    lines.push(`剧本页码：${session.scriptPage || '—'}    计划时刻：${session.plannedStart || '—'} ~ ${session.plannedEnd || '—'}`)
    if (session.stageNote) lines.push(`舞台状态：${session.stageNote}`)
  }
  lines.push(`生成时间：${formatDateTime(sheet.generatedAt)}`)
  lines.push(`Cue 数量：${sheet.cueLines.length}`)
  if (sheet.note) lines.push(`制表备注：${sheet.note}`)
  lines.push('')

  if (sheet.cueLines.length === 0) {
    lines.push('（本表未包含任何 Cue）')
  } else {
    const cueLike = sheet.cueLines.map((line) => ({ fadeInSec: line.fadeInSec, holdSec: line.holdSec, fadeOutSec: line.fadeOutSec }))
    const totalFadeIn = round1(cueLike.reduce((sum, cue) => sum + cue.fadeInSec, 0))
    const totalHold = round1(cueLike.reduce((sum, cue) => sum + cue.holdSec, 0))
    const totalFadeOut = round1(cueLike.reduce((sum, cue) => sum + cue.fadeOutSec, 0))
    const totalDelay = round1(sheet.cueLines.reduce((sum, line) => sum + maxDelayOfCue(line.channels), 0))
    sheet.cueLines.forEach((line, index) => {
      lines.push(...formatCueLineText(line, index))
    })
    lines.push('')
    lines.push(
      `合计过渡：渐亮 ${formatSeconds(totalFadeIn)} / 保持 ${formatSeconds(totalHold)} / 渐暗 ${formatSeconds(
        totalFadeOut
      )}（总计 ${formatSeconds(round1(totalFadeIn + totalHold + totalFadeOut + totalDelay))}${
        totalDelay > 0 ? `，含开灯延迟 ${formatSeconds(totalDelay)}` : ''
      }）`
    )
  }

  lines.push('')
  lines.push('—— 由剧场灯光 Cue 表编排器（gbcuesheet）生成 ——')
  return lines.join('\n')
}
