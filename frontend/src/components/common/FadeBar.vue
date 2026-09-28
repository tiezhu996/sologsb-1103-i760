<script setup lang="ts">
import { computed } from 'vue'
import { fadeRatio, formatSeconds, normalizeDelaySec, round1 } from '@/utils/fade'

/**
 * FadeBar 可视化渐变条：按开灯等待 / 渐亮 / 保持 / 渐暗时长比例绘制。
 * 被场次编排（场次汇总比例）与 Cue 时间轴（单条 Cue 比例）共同消费。
 */
const props = withDefaults(
  defineProps<{
    /** 渐亮时长（秒） */
    fadeInSec: number
    /** 保持时长（秒） */
    holdSec: number
    /** 渐暗时长（秒） */
    fadeOutSec: number
    /** 最晚结束通道的开灯延迟（秒），默认 0 */
    turnOnDelaySec?: number
    /** 条高（px） */
    height?: number
    /** 是否显示图例与合计 */
    showLegend?: boolean
    /** 紧凑模式：缩小字号与间距 */
    compact?: boolean
  }>(),
  {
    turnOnDelaySec: 0,
    height: 16,
    showLegend: true,
    compact: false
  }
)

const delaySec = computed(() => normalizeDelaySec(props.turnOnDelaySec))

const ratio = computed(() => fadeRatio(props, delaySec.value))

const totalSec = computed(() =>
  round1(delaySec.value + props.fadeInSec + props.holdSec + props.fadeOutSec)
)

const segments = computed(() =>
  [
    {
      key: 'turnOn',
      label: '等待',
      ratio: ratio.value.turnOn,
      sec: delaySec.value,
      background: 'repeating-linear-gradient(45deg, #3a3f55 0 6px, #2b2f40 6px 12px)'
    },
    { key: 'fadeIn', label: '渐亮', ratio: ratio.value.fadeIn, sec: props.fadeInSec, background: 'linear-gradient(90deg, #40341a 0%, #f2b544 100%)' },
    { key: 'hold', label: '保持', ratio: ratio.value.hold, sec: props.holdSec, background: 'linear-gradient(90deg, #f2b544 0%, #f6d38a 100%)' },
    { key: 'fadeOut', label: '渐暗', ratio: ratio.value.fadeOut, sec: props.fadeOutSec, background: 'linear-gradient(90deg, #f6d38a 0%, #2c2f3a 100%)' }
  ].filter((segment) => segment.ratio > 0)
)

const legendText = computed(() => {
  const base = `+${formatSeconds(props.fadeInSec)} / 保持 ${formatSeconds(props.holdSec)} / -${formatSeconds(props.fadeOutSec)}`
  return delaySec.value > 0 ? `等待 ${formatSeconds(delaySec.value)} → ${base}` : base
})
</script>

<template>
  <div class="fade-bar" :class="{ 'fade-bar--compact': props.compact }">
    <div class="fade-bar__track" :style="{ height: `${props.height}px` }">
      <template v-if="segments.length > 0">
        <div
          v-for="segment in segments"
          :key="segment.key"
          class="fade-bar__segment"
          :class="{ 'fade-bar__segment--wait': segment.key === 'turnOn' }"
          :style="{ width: `${segment.ratio * 100}%`, background: segment.background }"
          :title="`${segment.label} ${formatSeconds(segment.sec)}`"
        >
          <span v-if="segment.ratio > 0.18" class="fade-bar__segment-text">{{ segment.label }}</span>
        </div>
      </template>
      <div v-else class="fade-bar__empty">未设定过渡时间</div>
    </div>
    <div v-if="props.showLegend" class="fade-bar__legend">
      <span class="fade-bar__legend-main">{{ legendText }}</span>
      <span class="fade-bar__legend-total">合计 {{ formatSeconds(totalSec) }}</span>
    </div>
  </div>
</template>

<style scoped>
.fade-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
}

.fade-bar__track {
  display: flex;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.fade-bar__segment {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2px;
  transition: width 0.25s ease;
}

.fade-bar__segment--wait .fade-bar__segment-text {
  color: rgba(255, 255, 255, 0.72);
  letter-spacing: 2px;
}

.fade-bar__segment-text {
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(18, 20, 26, 0.75);
  font-weight: 600;
  white-space: nowrap;
}

.fade-bar__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.fade-bar__legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.fade-bar__legend-total {
  color: #f2b544;
  font-variant-numeric: tabular-nums;
}

.fade-bar--compact .fade-bar__legend {
  font-size: 11px;
}
</style>
