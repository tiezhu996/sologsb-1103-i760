<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NInput, NInputNumber, NSlider, NSwitch, NTag, useMessage } from 'naive-ui'
import BlankHint from '@/components/common/BlankHint.vue'
import ChannelChip from '@/components/common/ChannelChip.vue'
import CueNoInput from '@/components/common/CueNoInput.vue'
import FadeBar from '@/components/common/FadeBar.vue'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { Fixture, FixturePosition } from '@/types/fixture'
import { COLOR_TEMP_MAX, COLOR_TEMP_MIN, COLOR_TEMP_STEP, TURN_ON_DELAY_STEP } from '@/types/level'
import {
  checkTurnOnDelay,
  checkColorTempConsistency,
  cueDurationSeconds,
  cueTotalSeconds,
  formatSeconds,
  formatTransition,
  maxTurnOnDelay,
  normalizeDelaySec,
  turnOnDelayLimit
} from '@/utils/fade'
import { normalizeCueNo } from '@/utils/cueOrder'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const cueStore = useCueStore()
const fixtureStore = useFixtureStore()
const levelStore = useLevelStore()
const sessionStore = useSessionStore()

const cueId = computed(() => String(route.params.id ?? ''))
const cue = computed(() => cueStore.cueById(cueId.value))
const sessionId = computed(() => cue.value?.sessionId ?? '')
const session = computed(() => (sessionId.value ? sessionStore.sessionById(sessionId.value) : null))

const fixtures = computed(() => (sessionId.value ? fixtureStore.sortedFixturesOfSession(sessionId.value) : []))
const levels = computed(() => levelStore.levelsOfCue(cueId.value))

const siblingNos = computed(() =>
  cue.value
    ? cueStore
        .cuesOfSession(sessionId.value)
        .map((item) => item.cueNo)
        .filter((no) => no !== cue.value?.cueNo)
    : []
)

/** 已设定电平的通道（用于色温一致性判定） */
const tempItems = computed(() => {
  const items: Array<{ fixtureId: string; channel: number; position: FixturePosition; colorTempK: number }> = []
  levels.value.forEach((level) => {
    const fixture = fixtureStore.fixtureById(level.fixtureId)
    if (!fixture) return
    items.push({
      fixtureId: level.fixtureId,
      channel: fixture.channel,
      position: fixture.position,
      colorTempK: level.colorTempK
    })
  })
  return items.sort((a, b) => a.channel - b.channel)
})

const tempCheck = computed(() => checkColorTempConsistency(tempItems.value))

const defaultTempK = computed(() => (tempCheck.value.dominantK > 0 ? tempCheck.value.dominantK : 3200))

const siblingCues = computed(() => (sessionId.value ? cueStore.sortedCuesOfSession(sessionId.value) : []))

/** 当前 Cue 是否后面还有 Cue（末条不设延迟上限） */
const hasNextCue = computed(() => {
  const index = siblingCues.value.findIndex((item) => item.id === cueId.value)
  return index >= 0 && index < siblingCues.value.length - 1
})

/** 本 Cue 各通道开灯延迟的最大值（秒），决定最晚结束通道 */
const maxDelaySec = computed(() => maxTurnOnDelay(levels.value))

/** 延迟上限（秒），末条 Cue 为 null */
const delayLimitSec = computed(() => (cue.value ? turnOnDelayLimit(cue.value, hasNextCue.value) : null))

/** 延迟相关的总体提示条文案 */
const delayHint = computed(() => {
  if (!cue.value) return null
  if (!hasNextCue.value) {
    return { type: 'info' as const, text: '末条 Cue 无后续触发点，开灯延迟不设上限。' }
  }
  const limit = delayLimitSec.value ?? 0
  return {
    type: 'info' as const,
    text: `开灯延迟从 Cue 触发后开始计时；最晚通道不得越过下一条 Cue 触发点，上限为本条渐暗时长 ${formatSeconds(
      limit
    )}（基础过渡共 ${formatSeconds(cueTotalSeconds(cue.value))}）。`
  }
})

function isEnabled(fixtureId: string): boolean {
  return levelStore.levelOf(cueId.value, fixtureId) !== null
}

function intensityOf(fixtureId: string): number {
  return levelStore.levelOf(cueId.value, fixtureId)?.intensity ?? 0
}

function tempOf(fixtureId: string): number {
  return levelStore.levelOf(cueId.value, fixtureId)?.colorTempK ?? defaultTempK.value
}

function delayOf(fixtureId: string): number {
  return normalizeDelaySec(levelStore.levelOf(cueId.value, fixtureId)?.turnOnDelaySec)
}

/** 单个通道的延迟上限校验（用于行内提示） */
function delayCheckOf(fixtureId: string) {
  if (!cue.value) return null
  return checkTurnOnDelay(delayOf(fixtureId), cue.value, hasNextCue.value)
}

/** 设置开灯延迟：越过下一条 Cue 触发点时当场提示并拒绝保存 */
async function setTurnOnDelay(fixtureId: string, value: number | null): Promise<void> {
  if (!cue.value || value === null) return
  const check = checkTurnOnDelay(value, cue.value, hasNextCue.value)
  if (!check.ok) {
    message.error(check.message)
    return
  }
  await levelStore.upsertLevel(cueId.value, fixtureId, { turnOnDelaySec: normalizeDelaySec(value) })
}

const focusDrafts = ref<Record<string, string>>({})

function focusValue(fixtureId: string): string {
  return focusDrafts.value[fixtureId] ?? levelStore.levelOf(cueId.value, fixtureId)?.focusNote ?? ''
}

function onFocusInput(fixtureId: string, value: string): void {
  focusDrafts.value = { ...focusDrafts.value, [fixtureId]: value }
}

async function commitFocus(fixtureId: string): Promise<void> {
  const draft = focusDrafts.value[fixtureId]
  if (draft === undefined) return
  const next = { ...focusDrafts.value }
  delete next[fixtureId]
  focusDrafts.value = next
  if (!isEnabled(fixtureId)) return
  await levelStore.upsertLevel(cueId.value, fixtureId, { focusNote: draft })
}

async function toggleFixture(fixture: Fixture, enabled: boolean): Promise<void> {
  if (enabled) {
    await levelStore.upsertLevel(cueId.value, fixture.id, {
      intensity: 70,
      colorTempK: defaultTempK.value,
      focusNote: focusValue(fixture.id)
    })
    return
  }
  await levelStore.removeLevel(cueId.value, fixture.id)
}

async function setIntensity(fixtureId: string, value: number): Promise<void> {
  await levelStore.upsertLevel(cueId.value, fixtureId, { intensity: value })
}

async function setColorTemp(fixtureId: string, value: number | null): Promise<void> {
  if (value === null) return
  await levelStore.upsertLevel(cueId.value, fixtureId, { colorTempK: value })
}

async function alignToDominant(): Promise<void> {
  if (levels.value.length === 0) return
  const target = tempCheck.value.dominantK
  await Promise.all(levels.value.map((level) => levelStore.upsertLevel(cueId.value, level.fixtureId, { colorTempK: target })))
  message.success(`已将 ${levels.value.length} 个通道对齐到 ${target}K`)
}

async function clearAll(): Promise<void> {
  const count = levels.value.length
  await levelStore.removeByCue(cueId.value)
  message.success(`已清空 ${count} 个通道电平`)
}

async function commitCueNo(value: string): Promise<void> {
  if (!cue.value) return
  const normalized = normalizeCueNo(value)
  if (normalized === cue.value.cueNo) return
  if (cueStore.isCueNoTaken(sessionId.value, normalized, cue.value.id)) {
    message.error(`${normalized} 已被占用`)
    return
  }
  await cueStore.updateCue(cue.value.id, { cueNo: normalized })
  message.success(`编号已改为 ${normalized}`)
}

function goSiblingCue(direction: -1 | 1): void {
  if (!cue.value) return
  const index = siblingCues.value.findIndex((item) => item.id === cue.value?.id)
  const next = siblingCues.value[index + direction]
  if (!next) {
    message.warning(direction === -1 ? '已经是第一条 Cue' : '已经是最后一条 Cue')
    return
  }
  void router.push(`/cues/${next.id}/levels`)
}

function goTimeline(): void {
  void router.push(`/sessions/${sessionId.value}/cues`)
}

function goFixtures(): void {
  void router.push(`/sessions/${sessionId.value}/fixtures`)
}

function goSheets(): void {
  void router.push('/sheets')
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">通道电平编辑</h1>
        <p class="page__subtitle">
          {{ session ? `${session.order}. ${session.title}` : '所属场次不存在' }} ·
          逐通道设定亮度与色温，超出容差的色温漂移会被提示。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goTimeline">返回 Cue 时间轴</NButton>
        <NButton @click="goFixtures">灯位通道</NButton>
        <NButton @click="goSheets">排演表</NButton>
      </div>
    </header>

    <NAlert v-if="!cue" type="warning" :bordered="false">
      该 Cue 不存在，可能已被删除。请返回 Cue 编排时间轴重新选择。
    </NAlert>

    <template v-else>
      <section class="panel">
        <div class="cue-head">
          <CueNoInput :model-value="cue.cueNo" :existing-nos="siblingNos" width="130px" @commit="commitCueNo" />
          <div class="cue-head__titles">
            <p class="cue-head__label">{{ cue.label || '（未填写提示语）' }}</p>
            <p class="cue-head__meta mono">
              {{ formatTransition(cue, maxDelaySec) }} · 最晚通道结束合计
              {{ formatSeconds(cueDurationSeconds(cue, maxDelaySec)) }}
            </p>
          </div>
          <NTag size="small" :bordered="false" type="warning">{{ cue.trigger }}</NTag>
          <span class="toolbar__spacer" />
          <NButton size="small" quaternary @click="goSiblingCue(-1)">上一条 Cue</NButton>
          <NButton size="small" quaternary @click="goSiblingCue(1)">下一条 Cue</NButton>
        </div>

        <div class="cue-head__bar">
          <FadeBar
            :fade-in-sec="cue.fadeInSec"
            :hold-sec="cue.holdSec"
            :fade-out-sec="cue.fadeOutSec"
            :turn-on-delay-sec="maxDelaySec"
            :height="14"
          />
        </div>
      </section>

      <NAlert v-if="delayHint" :type="delayHint.type" :bordered="false">
        {{ delayHint.text }}
      </NAlert>

      <NAlert :type="tempCheck.consistent ? 'success' : 'warning'" :bordered="false">
        {{ tempCheck.message }}
      </NAlert>

      <div class="toolbar">
        <span class="toolbar__label">已设定 {{ levels.length }} / {{ fixtures.length }} 个通道</span>
        <span class="toolbar__spacer" />
        <NButton size="small" :disabled="levels.length === 0" @click="alignToDominant">
          全部对齐到 {{ defaultTempK }}K
        </NButton>
        <NButton size="small" quaternary type="error" :disabled="levels.length === 0" @click="clearAll">
          清空本 Cue 电平
        </NButton>
      </div>

      <BlankHint
        v-if="fixtures.length === 0"
        title="该场次还没有灯位通道"
        description="通道电平需要先有灯位通道。请到灯位通道配置台完成配接后回来设定亮度与色温。"
        action-text="去配置灯位通道"
        @action="goFixtures"
      />

      <section v-else class="panel">
        <h2 class="panel__title">
          通道电平<span class="panel__title-tag">开关控制该通道是否参与本 Cue</span>
        </h2>

        <div class="level-table">
          <div class="level-table__head">
            <span>参与</span>
            <span>通道</span>
            <span>亮度</span>
            <span>色温</span>
            <span>开灯延迟</span>
            <span>对焦说明</span>
          </div>

          <div
            v-for="fixture in fixtures"
            :key="fixture.id"
            class="level-row"
            :class="{ 'level-row--off': !isEnabled(fixture.id) }"
          >
            <NSwitch
              :value="isEnabled(fixture.id)"
              size="small"
              @update:value="(value) => toggleFixture(fixture, value === true)"
            />

            <div class="level-row__chip">
              <ChannelChip
                :channel="fixture.channel"
                :position="fixture.position"
                :intensity="isEnabled(fixture.id) ? intensityOf(fixture.id) : null"
                :gel="fixture.gel"
                :fixture-type="fixture.fixtureType"
                size="small"
              />
              <span class="level-row__type">{{ fixture.fixtureType }}</span>
            </div>

            <div class="level-row__control">
              <NSlider
                :value="intensityOf(fixture.id)"
                :min="0"
                :max="100"
                :step="1"
                :disabled="!isEnabled(fixture.id)"
                @update:value="(value) => setIntensity(fixture.id, value)"
              />
              <NInputNumber
                :value="intensityOf(fixture.id)"
                size="small"
                :min="0"
                :max="100"
                :show-button="false"
                :disabled="!isEnabled(fixture.id)"
                style="width: 82px"
                @update:value="(value) => setIntensity(fixture.id, value ?? 0)"
              />
            </div>

            <div class="level-row__control">
              <NInputNumber
                :value="tempOf(fixture.id)"
                size="small"
                :min="COLOR_TEMP_MIN"
                :max="COLOR_TEMP_MAX"
                :step="COLOR_TEMP_STEP"
                :disabled="!isEnabled(fixture.id)"
                style="width: 108px"
                @update:value="(value) => setColorTemp(fixture.id, value)"
              />
              <span class="level-row__drift mono">
                {{
                  isEnabled(fixture.id)
                    ? `偏移 ${Math.abs(tempOf(fixture.id) - defaultTempK)}K`
                    : '未参与'
                }}
              </span>
            </div>

            <div class="level-row__control level-row__delay">
              <NInputNumber
                :value="delayOf(fixture.id)"
                size="small"
                :min="0"
                :step="TURN_ON_DELAY_STEP"
                :show-button="false"
                :disabled="!isEnabled(fixture.id)"
                :status="isEnabled(fixture.id) && delayCheckOf(fixture.id) && !delayCheckOf(fixture.id)?.ok ? 'error' : undefined"
                style="width: 86px"
                @update:value="(value) => setTurnOnDelay(fixture.id, value)"
              />
              <span class="level-row__delay-suffix mono">秒</span>
              <span
                v-if="isEnabled(fixture.id)"
                class="level-row__drift mono"
                :class="{ 'level-row__drift--bad': !delayCheckOf(fixture.id)?.ok }"
              >
                {{ hasNextCue ? `上限 ${formatSeconds(delayLimitSec ?? 0)}` : '末条不限' }}
              </span>
            </div>

            <NInput
              :value="focusValue(fixture.id)"
              size="small"
              :disabled="!isEnabled(fixture.id)"
              placeholder="对焦说明（失焦保存）"
              @update:value="(value) => onFocusInput(fixture.id, value)"
              @blur="commitFocus(fixture.id)"
              @keyup.enter="commitFocus(fixture.id)"
            />
          </div>

          <p
            v-for="fixture in fixtures.filter((item) => isEnabled(item.id) && !delayCheckOf(item.id)?.ok)"
            :key="`${fixture.id}-delay-error`"
            class="level-row__delay-error"
          >
            CH{{ fixture.channel }}：{{ delayCheckOf(fixture.id)?.message }}
          </p>
        </div>
      </section>

      <section v-if="levels.length > 0" class="panel">
        <h2 class="panel__title">色温一致性检查<span class="panel__title-tag">容差 ±{{ tempCheck.toleranceK }}K</span></h2>
        <div class="temp-grid">
          <div
            v-for="item in tempCheck.items"
            :key="item.fixtureId"
            class="temp-item"
            :class="{ 'temp-item--drift': !item.consistent }"
          >
            <ChannelChip :channel="item.channel" :position="item.position" :intensity="null" size="small" />
            <span class="mono">{{ item.colorTempK }}K</span>
            <span class="temp-item__drift mono">偏移 {{ item.driftK }}K</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cue-head {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.cue-head__titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}

.cue-head__label {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cue-head__meta {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.cue-head__bar {
  margin-top: 14px;
  max-width: 620px;
}

.toolbar__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.level-table__head,
.level-row {
  display: grid;
  grid-template-columns: 58px 220px 220px 210px 180px 1fr;
  align-items: center;
  gap: 12px;
  padding: 9px 4px;
}

.level-table__head {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.level-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: opacity 0.16s ease;
}

.level-row__delay {
  flex-wrap: nowrap;
}

.level-row__delay-suffix {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.level-row__delay-error {
  margin: 2px 4px 6px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #ff9a9a;
  background: rgba(232, 84, 84, 0.1);
  border: 1px solid rgba(232, 84, 84, 0.32);
}

.level-row__drift--bad {
  color: #ff9a9a;
}

.level-row--off {
  opacity: 0.5;
}

.level-row__chip {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-row__type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.level-row__control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.level-row__drift {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
}

.temp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.temp-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.temp-item--drift {
  border-color: rgba(232, 168, 84, 0.65);
  background: rgba(232, 168, 84, 0.1);
}

.temp-item__drift {
  color: rgba(255, 255, 255, 0.5);
}
</style>
