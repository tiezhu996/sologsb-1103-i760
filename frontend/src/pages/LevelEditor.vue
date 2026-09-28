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
import { COLOR_TEMP_MAX, COLOR_TEMP_MIN, COLOR_TEMP_STEP, DELAY_MIN_SEC, DELAY_STEP_SEC } from '@/types/level'
import {
  cueEffectiveSeconds,
  checkColorTempConsistency,
  delayLimitOfCue,
  findDelayViolations,
  formatSeconds,
  formatTransition,
  maxDelayOfCue,
  normalizedDelay
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

function isEnabled(fixtureId: string): boolean {
  return levelStore.levelOf(cueId.value, fixtureId) !== null
}

function intensityOf(fixtureId: string): number {
  return levelStore.levelOf(cueId.value, fixtureId)?.intensity ?? 0
}

function tempOf(fixtureId: string): number {
  return levelStore.levelOf(cueId.value, fixtureId)?.colorTempK ?? defaultTempK.value
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

const siblingCues = computed(() => (sessionId.value ? cueStore.sortedCuesOfSession(sessionId.value) : []))

/** 时间轴上的下一条 Cue：它在本条基础时长结束时触发；末条为 null */
const nextCue = computed(() => {
  if (!cue.value) return null
  const ordered = siblingCues.value
  const index = ordered.findIndex((item) => item.id === cue.value?.id)
  return index >= 0 && index + 1 < ordered.length ? ordered[index + 1] : null
})

/** 非末条 Cue 的开灯延迟上限（保持 + 渐暗）；末条无上限 */
const delayLimit = computed<number | null>(() => (cue.value ? delayLimitOfCue(cue.value, nextCue.value) : null))

/** 本 Cue 最晚结束通道的开灯延迟，决定总时长与过渡条 */
const maxDelay = computed(() => maxDelayOfCue(levels.value))

const effectiveTotal = computed(() =>
  cue.value ? cueEffectiveSeconds(cue.value, levels.value) : 0
)

/** 当前已存在的越界通道（例如改过过渡时间后历史延迟超了新上限） */
const existingViolations = computed(() => {
  if (!cue.value) return []
  return findDelayViolations({
    cue: cue.value,
    nextCue: nextCue.value,
    levels: levels.value.map((level) => {
      const fixture = fixtureStore.fixtureById(level.fixtureId)
      return { fixtureId: level.fixtureId, channel: fixture?.channel, delaySec: level.delaySec }
    })
  })
})

const violatingFixtureIds = computed(() => new Set(existingViolations.value.map((item) => item.fixtureId)))

function delayOf(fixtureId: string): number {
  return normalizedDelay(levelStore.levelOf(cueId.value, fixtureId)?.delaySec)
}

function isDelayOver(fixtureId: string): boolean {
  return violatingFixtureIds.value.has(fixtureId)
}

async function setDelay(fixture: Fixture, value: number | null): Promise<void> {
  if (!cue.value) return
  const next = Math.max(DELAY_MIN_SEC, normalizedDelay(value ?? 0))
  const violations = findDelayViolations({
    cue: cue.value,
    nextCue: nextCue.value,
    levels: levels.value.map((level) => {
      const matched = fixtureStore.fixtureById(level.fixtureId)
      return { fixtureId: level.fixtureId, channel: matched?.channel, delaySec: level.delaySec }
    }),
    pending: { fixtureId: fixture.id, channel: fixture.channel, delaySec: next }
  })
  if (violations.length > 0) {
    const item = violations[0]
    message.error(
      nextCue.value
        ? `CH${fixture.channel} 延迟 ${formatSeconds(item.delaySec)} + 渐亮 ${formatSeconds(
            cue.value.fadeInSec
          )} 会越过下一条 ${nextCue.value.cueNo} 的触发时刻，延迟最多 ${formatSeconds(item.limitSec)}，已拒绝保存`
        : `CH${fixture.channel} 开灯延迟不合法，已拒绝保存`
    )
    return
  }
  await levelStore.upsertLevel(cueId.value, fixture.id, { delaySec: next })
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
              {{ formatTransition(cue) }} · 合计 {{ formatSeconds(effectiveTotal)
              }}<template v-if="maxDelay > 0">（含最晚开灯延迟 {{ formatSeconds(maxDelay) }}）</template>
            </p>
          </div>
          <NTag size="small" :bordered="false" type="warning">{{ cue.trigger }}</NTag>
          <span class="toolbar__spacer" />
          <NButton size="small" quaternary @click="goSiblingCue(-1)">上一条 Cue</NButton>
          <NButton size="small" quaternary @click="goSiblingCue(1)">下一条 Cue</NButton>
        </div>

        <div class="cue-head__bar">
          <FadeBar
            :delay-sec="maxDelay"
            :fade-in-sec="cue.fadeInSec"
            :hold-sec="cue.holdSec"
            :fade-out-sec="cue.fadeOutSec"
            :height="14"
          />
        </div>

        <p class="cue-head__delay-tip">
          <template v-if="delayLimit !== null">
            开灯延迟上限 {{ formatSeconds(delayLimit) }}：通道须在下一条 {{ nextCue?.cueNo }}
            触发前完成渐亮（延迟 + 渐亮 ≤ {{ formatSeconds(delayLimit) }}）；超限将拒绝保存。
          </template>
          <template v-else>末条 Cue 没有下一条触发点，延迟不设上限。</template>
        </p>
      </section>

      <NAlert :type="tempCheck.consistent ? 'success' : 'warning'" :bordered="false">
        {{ tempCheck.message }}
      </NAlert>

      <NAlert v-if="existingViolations.length > 0" type="error" :bordered="false">
        {{ existingViolations.length }} 个通道的开灯延迟会越过下一条 {{ nextCue?.cueNo }}
        的触发时刻（上限 {{ formatSeconds(delayLimit ?? 0) }}）：
        {{ existingViolations.map((item) => `CH${item.channel}（延迟 ${formatSeconds(item.delaySec)}）`).join('、') }}
        ，请调小延迟或加大保持 / 渐暗时长。
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
            <span>开灯延迟</span>
            <span>色温</span>
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

            <div class="level-row__delay" :class="{ 'level-row__delay--over': isEnabled(fixture.id) && isDelayOver(fixture.id) }">
              <NInputNumber
                :value="delayOf(fixture.id)"
                size="small"
                :min="DELAY_MIN_SEC"
                :max="delayLimit ?? undefined"
                :step="DELAY_STEP_SEC"
                :show-button="false"
                :disabled="!isEnabled(fixture.id)"
                style="width: 82px"
                @update:value="(value) => setDelay(fixture, value)"
              />
              <span class="level-row__delay-hint mono">
                <template v-if="!isEnabled(fixture.id)">未参与</template>
                <template v-else-if="isDelayOver(fixture.id)">越过 {{ nextCue?.cueNo }}</template>
                <template v-else-if="delayLimit !== null">≤ {{ formatSeconds(delayLimit) }}</template>
                <template v-else>不限</template>
              </span>
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

.cue-head__delay-tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.level-row__delay {
  display: flex;
  align-items: center;
  gap: 8px;
}

.level-row__delay--over {
  color: #ff9a9a;
}

.level-row__delay-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
  white-space: nowrap;
}

.level-row__delay--over .level-row__delay-hint {
  color: #ff9a9a;
}

.toolbar__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.level-table__head,
.level-row {
  display: grid;
  grid-template-columns: 58px 220px 210px 170px 200px 1fr;
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
