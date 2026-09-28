import type { Cue, CueOrderSummary, AdjacentTransition } from '@/types/cue'
import type { FixturePosition } from '@/types/fixture'
import type { ColorTempCheck, ColorTempItem, CueLevel } from '@/types/level'
import { COLOR_TEMP_TOLERANCE_K } from '@/types/level'
import type { RehearsalSheet, SheetCueLine } from '@/types/sheet'
import type { Session } from '@/types/session'
import { sortCues } from '@/utils/cueOrder'

/** 过渡比例：开灯延迟 / 渐亮 / 保持 / 渐暗 各占的比例（0-1） */
export interface FadeRatio {
  turnOn: number
  fadeIn: number
  hold: number
  fadeOut: number
}

/** 参与延迟计算的通道电平最小结构 */
type DelayLevel = Pick<CueLevel, 'cueId' | 'fixtureId' | 'turnOnDelaySec'>

/** 保留一位小数 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 旧数据可能没有开灯延迟字段，统一归一化为不小于 0 的一位小数秒数 */
export function normalizeDelaySec(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? round1(value) : 0
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

/** 单条 Cue 的基础总时长（渐亮 + 保持 + 渐暗，不含开灯延迟） */
export function cueTotalSeconds(cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>): number {
  return round1(cue.fadeInSec + cue.holdSec + cue.fadeOutSec)
}

/**
 * 单条 Cue 的总时长：基础过渡 + 该条最晚结束通道的开灯延迟。
 * 开灯等待不缩短任何过渡段，且最晚结束通道以延迟最大者为准。
 */
export function cueDurationSeconds(
  cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>,
  maxTurnOnDelaySec = 0
): number {
  return round1(cueTotalSeconds(cue) + normalizeDelaySec(maxTurnOnDelaySec))
}

/** 一组通道电平里最大的开灯延迟（秒），无电平时为 0 */
export function maxTurnOnDelay(levels: ReadonlyArray<DelayLevel> | null | undefined): number {
  if (!levels || levels.length === 0) return 0
  return round1(Math.max(0, ...levels.map((level) => normalizeDelaySec(level.turnOnDelaySec))))
}

/** 单条 Cue 的过渡描述文本 */
export function formatTransition(
  cue: Pick<Cue, 'fadeInSec' | 'fadeOutSec' | 'holdSec'>,
  maxTurnOnDelaySec = 0
): string {
  const delay = normalizeDelaySec(maxTurnOnDelaySec)
  const base = `渐亮 ${formatSeconds(cue.fadeInSec)} → 保持 ${formatSeconds(cue.holdSec)} → 渐暗 ${formatSeconds(cue.fadeOutSec)}`
  return delay > 0 ? `开灯等待 ${formatSeconds(delay)} → ${base}` : base
}

/** 渐变条比例：总时长为 0 时各段均为 0 */
export function fadeRatio(
  input: Pick<Cue, 'fadeInSec' | 'holdSec' | 'fadeOutSec'>,
  turnOnDelaySec = 0
): FadeRatio {
  const total = cueDurationSeconds(input, turnOnDelaySec)
  if (total <= 0) return { turnOn: 0, fadeIn: 0, hold: 0, fadeOut: 0 }
  return {
    turnOn: normalizeDelaySec(turnOnDelaySec) / total,
    fadeIn: input.fadeInSec / total,
    hold: input.holdSec / total,
    fadeOut: input.fadeOutSec / total
  }
}

/**
 * 通道开灯延迟上限校验所需的 Cue 结构。
 * 下一条 Cue 的触发时刻 = 本条触发后（渐亮 + 保持 + 渐暗）；
 * 通道开灯（渐亮 + 保持）结束时刻 = 延迟 + 渐亮 + 保持，
 * 因此非末条 Cue 的延迟不得超过本条渐暗时长；末条 Cue 无下一条，不设上限。
 */
export type DelayLimitCue = Pick<Cue, 'id' | 'fadeInSec' | 'fadeOutSec' | 'holdSec'>

/** 某条 Cue 的开灯延迟上限；末条 Cue（或无后续）返回 null 表示不限制 */
export function turnOnDelayLimit(cue: DelayLimitCue, hasNext: boolean): number | null {
  return hasNext ? round1(Math.max(0, cue.fadeOutSec)) : null
}

/** 通道开灯（渐亮 + 保持）结束、即将渐暗的时刻（相对 Cue 触发，秒） */
export function channelHoldEndSeconds(
  cue: Pick<Cue, 'fadeInSec' | 'holdSec'>,
  delaySec: number
): number {
  return round1(normalizeDelaySec(delaySec) + cue.fadeInSec + cue.holdSec)
}

/** 单条延迟校验结果 */
export interface TurnOnDelayCheck {
  /** 是否可以保存 */
  ok: boolean
  /** 允许的延迟上限（秒），null 表示末条 Cue 不设上限 */
  limitSec: number | null
  /** 现场提示文案 */
  message: string
}

/** 校验单个通道的开灯延迟是否会越过下一条 Cue 的触发时刻 */
export function checkTurnOnDelay(
  delaySec: number,
  cue: DelayLimitCue,
  hasNext: boolean
): TurnOnDelayCheck {
  const delay = normalizeDelaySec(delaySec)
  if (delay < 0 || !Number.isFinite(delay)) {
    return { ok: false, limitSec: null, message: '开灯延迟需为不小于 0 的秒数' }
  }
  const limit = turnOnDelayLimit(cue, hasNext)
  if (limit === null) {
    return { ok: true, limitSec: null, message: '末条 Cue 无后续触发点，延迟不设上限' }
  }
  // 预留 0.05s 容差，避免浮点误差误伤临界值
  if (delay > limit + 0.05) {
    return {
      ok: false,
      limitSec: limit,
      message: `开灯延迟 ${formatSeconds(delay)} 会让该通道在触发后 ${formatSeconds(
        channelHoldEndSeconds(cue, delay)
      )} 才结束开灯（渐亮+保持），而 ${formatSeconds(
        cueTotalSeconds(cue)
      )} 后下一条 Cue 就会触发；延迟上限为本条渐暗 ${formatSeconds(
        limit
      )}。请缩短延迟或加大本条渐暗`
    }
  }
  return {
    ok: true,
    limitSec: limit,
    message: `延迟上限为本条渐暗时长 ${formatSeconds(limit)}（不得越过下一条 Cue 触发点）`
  }
}

/** 一条越限的开灯延迟（用于场次/时间轴统一体检） */
export interface TurnOnDelayViolation {
  cueId: string
  cueNo: string
  fixtureId: string
  channel: number
  delaySec: number
  limitSec: number
  message: string
}

/**
 * 汇总一组按时间轴排好的 Cue 中所有越限的通道延迟。
 * @param cues 按时间轴顺序排好的 Cue
 * @param levelsOfCue 返回某条 Cue 下的通道电平
 * @param channelOf 由 fixtureId 取 DMX 通道号（找不到返回 null 时行内通道号留空）
 */
export function collectDelayViolations(
  cues: readonly Cue[],
  levelsOfCue: (cueId: string) => ReadonlyArray<DelayLevel>,
  channelOf?: (fixtureId: string) => number | null
): TurnOnDelayViolation[] {
  const ordered = sortCues(cues)
  const violations: TurnOnDelayViolation[] = []
  ordered.forEach((cue, index) => {
    const hasNext = index < ordered.length - 1
    const limit = turnOnDelayLimit(cue, hasNext)
    if (limit === null) return
    levelsOfCue(cue.id).forEach((level) => {
      const delay = normalizeDelaySec(level.turnOnDelaySec)
      if (delay > limit + 0.05) {
        violations.push({
          cueId: cue.id,
          cueNo: cue.cueNo,
          fixtureId: level.fixtureId,
          channel: channelOf?.(level.fixtureId) ?? 0,
          delaySec: delay,
          limitSec: limit,
          message: `${cue.cueNo} CH${channelOf?.(level.fixtureId) ?? '?'}：延迟 ${formatSeconds(
            delay
          )} 越过下一条触发点（上限 ${formatSeconds(limit)}）`
        })
      }
    })
  })
  return violations
}

/** 汇总一组 Cue 的过渡时长，并给出相邻衔接关系 */
export function sumCues(input: readonly Cue[], levelsByCue?: Readonly<Record<string, ReadonlyArray<DelayLevel>>>): CueOrderSummary {
  const cues = sortCues(input)
  let totalFadeInSec = 0
  let totalFadeOutSec = 0
  let totalHoldSec = 0
  let totalTurnOnDelaySec = 0
  const adjacent: AdjacentTransition[] = []

  cues.forEach((cue, index) => {
    totalFadeInSec += cue.fadeInSec
    totalFadeOutSec += cue.fadeOutSec
    totalHoldSec += cue.holdSec
    totalTurnOnDelaySec += maxTurnOnDelay(levelsByCue?.[cue.id])
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
    totalTurnOnDelaySec: round1(totalTurnOnDelaySec),
    totalSec: round1(totalFadeInSec + totalFadeOutSec + totalHoldSec + totalTurnOnDelaySec),
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
  const maxDelay = normalizeDelaySec(line.maxTurnOnDelaySec)
  const totalBase = round1(line.fadeInSec + line.holdSec + line.fadeOutSec)
  const total = round1(totalBase + maxDelay)
  const rows: string[] = []
  rows.push(`${String(index + 1).padStart(2, '0')}. ${line.cueNo}  ${line.label || '（无提示语）'}  [${line.trigger}]`)
  rows.push(`    过渡：渐亮 ${formatSeconds(line.fadeInSec)} / 保持 ${formatSeconds(line.holdSec)} / 渐暗 ${formatSeconds(
    line.fadeOutSec
  )}（合计 ${formatSeconds(totalBase)}）`)
  rows.push(
    maxDelay > 0
      ? `    开灯延迟：最晚通道在触发后等待 ${formatSeconds(maxDelay)} 才开始渐亮，本 Cue 实际占用 ${formatSeconds(total)}`
      : '    开灯延迟：0s（触发即渐亮）'
  )
  if (line.note) rows.push(`    备注：${line.note}`)
  if (line.channels.length === 0) {
    rows.push('    通道电平：未设定')
  } else {
    line.channels.forEach((channel) => {
      rows.push(
        `    CH${String(channel.channel).padStart(3, ' ')} ${channel.position}/${channel.fixtureType}` +
          ` 亮度 ${channel.intensity}%  色温 ${channel.colorTempK}K  色纸 ${channel.gel || '—'}` +
          ` 开灯延迟 ${formatSeconds(normalizeDelaySec(channel.turnOnDelaySec))}` +
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
    const totalFadeIn = round1(sheet.cueLines.reduce((sum, line) => sum + line.fadeInSec, 0))
    const totalHold = round1(sheet.cueLines.reduce((sum, line) => sum + line.holdSec, 0))
    const totalFadeOut = round1(sheet.cueLines.reduce((sum, line) => sum + line.fadeOutSec, 0))
    const totalDelay = round1(
      sheet.cueLines.reduce((sum, line) => sum + normalizeDelaySec(line.maxTurnOnDelaySec), 0)
    )
    sheet.cueLines.forEach((line, index) => {
      lines.push(...formatCueLineText(line, index))
    })
    lines.push('')
    lines.push(
      `合计过渡：渐亮 ${formatSeconds(totalFadeIn)} / 保持 ${formatSeconds(totalHold)} / 渐暗 ${formatSeconds(
        totalFadeOut
      )} / 开灯延迟 ${formatSeconds(totalDelay)}（总计 ${formatSeconds(
        round1(totalFadeIn + totalHold + totalFadeOut + totalDelay)
      )}）`
    )
  }

  lines.push('')
  lines.push('—— 由剧场灯光 Cue 表编排器（gbcuesheet）生成 ——')
  return lines.join('\n')
}
