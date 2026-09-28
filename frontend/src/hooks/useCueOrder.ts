import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { Cue, CueOrderSummary } from '@/types/cue'
import { useCueStore } from '@/stores/cueStore'
import { useLevelStore } from '@/stores/levelStore'
import { sortCues, suggestNextCueNo } from '@/utils/cueOrder'
import {
  collectDelayViolations,
  cueDurationSeconds,
  formatSeconds,
  maxTurnOnDelay,
  sumCues,
  type TurnOnDelayViolation
} from '@/utils/fade'

/** `useCueOrder` 暴露的顺序视图与重排动作 */
export interface UseCueOrderReturn {
  /** 按落库位次排好序的 Cue 列表 */
  cues: ComputedRef<Cue[]>
  /** 过渡时长汇总（含相邻衔接与开灯延迟） */
  summary: ComputedRef<CueOrderSummary>
  /** 全场总时长（秒，含各条最晚结束通道的延迟） */
  totalSeconds: ComputedRef<number>
  /** 建议的下一条 Cue 编号 */
  nextCueNo: ComputedRef<string>
  /** 硬切衔接的数量 */
  hardCutCount: ComputedRef<number>
  /** 越过下一条 Cue 触发点的开灯延迟 */
  delayViolations: ComputedRef<TurnOnDelayViolation[]>
  /** 单条 Cue 总时长（含该条最晚通道延迟）的格式化文本 */
  durationTextOf: (cue: Cue) => string
  /** 拖拽重排并按顺序落库 */
  reorder: (orderedIds: readonly string[]) => Promise<void>
  /** 按 cueNo 自动排序并落库 */
  sortByCueNo: () => Promise<void>
  /** 相对移动一位并落库 */
  move: (cueId: string, direction: -1 | 1) => Promise<void>
}

/**
 * 按 cueNo 排序、重排落库与相邻过渡时长汇总。
 * 被 Cue 时间轴与场次编排共同消费。
 */
export function useCueOrder(sessionId: MaybeRefOrGetter<string>): UseCueOrderReturn {
  const cueStore = useCueStore()
  const levelStore = useLevelStore()

  const cues = computed<Cue[]>(() => sortCues(cueStore.cuesOfSession(toValue(sessionId))))

  const levelsByCue = computed<Record<string, ReturnType<typeof levelStore.levelsOfCue>>>(() => {
    const grouped: Record<string, ReturnType<typeof levelStore.levelsOfCue>> = {}
    cues.value.forEach((cue) => {
      grouped[cue.id] = levelStore.levelsOfCue(cue.id)
    })
    return grouped
  })

  const summary = computed<CueOrderSummary>(() => sumCues(cues.value, levelsByCue.value))

  const totalSeconds = computed(() => summary.value.totalSec)

  const nextCueNo = computed(() => suggestNextCueNo(cues.value.map((cue) => cue.cueNo)))

  const hardCutCount = computed(() => summary.value.adjacent.filter((item) => item.overlap).length)

  const delayViolations = computed(() =>
    collectDelayViolations(cues.value, (cueId) => levelStore.levelsOfCue(cueId))
  )

  function durationTextOf(cue: Cue): string {
    return formatSeconds(cueDurationSeconds(cue, maxTurnOnDelay(levelStore.levelsOfCue(cue.id))))
  }

  async function reorder(orderedIds: readonly string[]): Promise<void> {
    await cueStore.reorderCues(toValue(sessionId), orderedIds)
  }

  async function sortByCueNo(): Promise<void> {
    await cueStore.sortByCueNo(toValue(sessionId))
  }

  async function move(cueId: string, direction: -1 | 1): Promise<void> {
    await cueStore.moveCue(cueId, direction)
  }

  return {
    cues,
    summary,
    totalSeconds,
    nextCueNo,
    hardCutCount,
    delayViolations,
    durationTextOf,
    reorder,
    sortByCueNo,
    move
  }
}
