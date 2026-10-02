<template>
  <section class="merge-center">
    <div class="merge-toolbar">
      <div class="offline-control">
        <span class="net-dot" :class="offline ? 'off' : 'on'"></span>
        <span>{{ offline ? '当前离线（合并会中断在当前步骤）' : '当前在线' }}</span>
        <button class="btn" type="button" @click="toggleOffline">
          {{ offline ? '恢复在线' : '模拟断线' }}
        </button>
      </div>
      <p class="muted small">
        合并为整批事务：全部步骤成功后一次性写入，中断不会留下半并数据；重试从失败那一步接着走，已并好的层位沿用冻结结论。
      </p>
    </div>

    <div v-if="!groups.length" class="empty-panel">
      <p class="empty-title">暂无可合并的层位</p>
      <p class="muted">
        规则：同一探方下至少有两条「已复核」、且尚未合并/未被并掉的层位，才会出现在这里。
      </p>
      <ul class="muted small">
        <li>若层位还在「待编录 / 编录中」，请先在编录清单里提交编录、送交复核；</li>
        <li>若探方下只剩一条已复核层位，说明本探方暂不需要合并。</li>
      </ul>
      <button class="btn" type="button" @click="emit('go-catalog')">去编录清单看看</button>
    </div>

    <div v-else class="group-list">
      <article v-for="group in groups" :key="group.trench" class="group-card">
        <header class="group-head">
          <h4>探方 {{ group.trench }}（{{ group.members.length }} 条已复核层位）</h4>
          <div class="target-pick">
            <label>
              保留层位：
              <select v-model="targetByTrench[group.trench]">
                <option v-for="member in group.members" :key="member.id" :value="Number(member.id)">
                  {{ member['层位编号'] }}
                </option>
              </select>
            </label>
            <button class="btn primary" type="button" @click="startBatch(group)">发起整批合并</button>
          </div>
        </header>

        <table class="data-table compact">
          <thead>
            <tr>
              <th>层位编号</th>
              <th>编录来源</th>
              <th>土质</th>
              <th>土色</th>
              <th>包含物</th>
              <th>堆积厚度</th>
              <th>判定年代</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in group.members" :key="member.id">
              <td>{{ member['层位编号'] }}</td>
              <td>{{ member['编录来源'] }}</td>
              <td>{{ member['土质'] }}</td>
              <td>{{ member['土色'] }}</td>
              <td>{{ member['包含物'] }}</td>
              <td>{{ member['堆积厚度'] }}</td>
              <td>{{ member['判定年代'] }}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted small rule-note">
          土质、土色两处填得不一致时，以「现场编录原单」为准；包含物去重合并，厚度可累加时累加。
        </p>
      </article>
    </div>

    <h3 class="batch-title">合并批次</h3>
    <div v-if="!batches.length" class="empty-panel subtle">
      <p class="muted">还没有合并批次。上方选定保留层位后发起整批合并，办结结论会落到探方清单。</p>
    </div>
    <article v-for="batch in batches" :key="batch.id" class="batch-card" :class="batch.status">
      <header class="batch-head">
        <div>
          <strong>批次 {{ batch.id }}</strong>
          <span class="batch-tag">{{ batch.status }}</span>
        </div>
        <div class="muted small">
          探方 {{ batch.trench }} ｜ 保留 {{ batch.targetCode }} ｜ 建立 {{ batch.createdAt }}
          <template v-if="batch.committedAt"> ｜ 办结 {{ batch.committedAt }}</template>
        </div>
      </header>

      <ol class="step-list">
        <li v-for="step in batch.steps" :key="step.absorbedCode" class="step" :class="step.status">
          <span class="step-state">{{ step.status }}</span>
          <span class="step-body">
            {{ step.absorbedCode }} → {{ batch.targetCode }}
            <span v-if="step.message" class="muted small">（{{ step.message }}）</span>
          </span>
        </li>
      </ol>

      <p v-if="batch.status === '中断'" class="error-text">{{ batch.lastError }}</p>

      <footer v-if="batch.status !== '已办结'" class="batch-actions">
        <button class="btn primary" type="button" @click="continueBatch(batch)">
          {{ hasFailure(batch) ? '从失败步骤继续合并' : '继续合并并办结' }}
        </button>
        <button class="btn ghost" type="button" @click="abandon(batch)">放弃批次（不动正式数据）</button>
      </footer>
      <footer v-else class="batch-actions">
        <span class="muted small">已一次性办结：层位清单已更新，结论已写入探方 {{ batch.trench }}。</span>
      </footer>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import {
  createMergeBatch,
  discardMergeBatch,
  isOffline,
  listCandidateGroups,
  listMergeBatches,
  runMergeBatch,
  setForceOffline,
} from '@/api/merge-service'
import type { MergeBatch, MergeGroup } from '@/data/types'

const emit = defineEmits<{
  (event: 'go-catalog'): void
  (event: 'notice', payload: { ok: boolean; message: string }): void
}>()

const groups = ref<MergeGroup[]>([])
const batches = ref<MergeBatch[]>([])
const offline = ref(isOffline())
const targetByTrench = reactive<Record<string, number>>({})

function refresh() {
  groups.value = listCandidateGroups()
  batches.value = listMergeBatches()
  for (const group of groups.value) {
    if (targetByTrench[group.trench] === undefined) {
      targetByTrench[group.trench] = Number(group.members[0].id)
    }
  }
}

function startBatch(group: MergeGroup) {
  const targetId = targetByTrench[group.trench] ?? Number(group.members[0].id)
  const created = createMergeBatch(group, targetId)
  emit('notice', { ok: created.ok, message: created.message })
  if (created.ok && created.batchId) {
    const run = runMergeBatch(created.batchId)
    emit('notice', { ok: run.ok, message: run.message })
  }
  refresh()
}

function hasFailure(batch: MergeBatch): boolean {
  return batch.steps.some((step) => step.status === '失败')
}

function continueBatch(batch: MergeBatch) {
  const result = runMergeBatch(batch.id)
  emit('notice', { ok: result.ok, message: result.message })
  refresh()
}

function abandon(batch: MergeBatch) {
  const result = discardMergeBatch(batch.id)
  emit('notice', { ok: result.ok, message: result.message })
  refresh()
}

function toggleOffline() {
  const next = !offline.value
  setForceOffline(next)
  offline.value = isOffline()
}

function handleOnline() {
  offline.value = isOffline()
}

onMounted(() => {
  refresh()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOnline)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOnline)
})
</script>
