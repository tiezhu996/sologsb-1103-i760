import type { FixturePosition } from '@/types/fixture'

/** 通道电平（CueLevel）：某条 Cue 下某个灯位通道的亮度与色温设定 */
export interface CueLevel {
  /** 主键 */
  id: string
  /** 所属 Cue */
  cueId: string
  /** 对应灯位通道 */
  fixtureId: string
  /** 亮度 0-100（%） */
  intensity: number
  /** 色温（K） */
  colorTempK: number
  /**
   * 开灯延迟（秒）：Cue 触发后先等待该时长，通道才开始渐亮，
   * 用于技术合成时按通道依次亮起。旧数据缺省按 0 秒处理。
   */
  turnOnDelaySec: number
  /** 对焦说明 */
  focusNote: string
  updatedAt: number
}

/** 色温校验的单通道结果 */
export interface ColorTempItem {
  fixtureId: string
  channel: number
  position: FixturePosition
  colorTempK: number
  /** 相对基准色温的偏移量（K） */
  driftK: number
  consistent: boolean
}

/** 色温一致性校验结果 */
export interface ColorTempCheck {
  /** 出现次数最多的色温，作为基准 */
  dominantK: number
  /** 允许容差（K） */
  toleranceK: number
  items: ColorTempItem[]
  consistent: boolean
  message: string
}

/** 色温取值范围与容差 */
export const COLOR_TEMP_MIN = 2700
export const COLOR_TEMP_MAX = 6500
export const COLOR_TEMP_STEP = 100
export const COLOR_TEMP_TOLERANCE_K = 400

/** 亮度取值范围 */
export const INTENSITY_MIN = 0
export const INTENSITY_MAX = 100

/** 开灯延迟取值范围（秒） */
export const TURN_ON_DELAY_MIN = 0
export const TURN_ON_DELAY_MAX = 3600
export const TURN_ON_DELAY_STEP = 0.5
