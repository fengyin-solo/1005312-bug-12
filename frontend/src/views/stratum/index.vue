<template>
  <section class="page" data-module="stratum">
    <header class="page-head">
      <div>
        <h2>地层堆积管理</h2>
        <p class="page-desc">维护地层堆积，围绕层位编号、所属探方、土质、土色做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地层堆积</button>
        <button class="btn" type="button" @click="exportRows">导出地层堆积清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无地层堆积数据，可先登记地层堆积</td>
        </tr>
      </tbody>
    </table>

    <section class="merge-panel">
      <h3>层位合并</h3>
      <p class="merge-hint">
        以一条层位为保留层位，同探方的其余层位并入；合并要么整批办结、要么整体不办结，
        中断后可从断点继续办理，已并好的层位沿用既有结论。土质、土色以现场编录原单为准。
      </p>

      <div v-if="!mergeable.length" class="empty-state merge-empty">
        暂无可合并的层位：只有「编录中」或「已复核」状态的层位才能参与合并，
        可先在上方清单提交编录或送交复核；被未办结批次占用的层位也不会出现在候选里。
      </div>

      <template v-else>
        <div class="merge-form">
          <label class="filter-item">
            <span>保留层位（合并后留存）</span>
            <select v-model.number="mergeTargetId">
              <option v-for="row in mergeable" :key="String(row.id)" :value="Number(row.id)">
                {{ row['层位编号'] }}（{{ row['所属探方'] }}）
              </option>
            </select>
          </label>
          <div class="merge-sources">
            <span>并入层位（限同探方，办结后从编录清单移除）</span>
            <label v-for="row in mergeSources" :key="String(row.id)" class="merge-source-item">
              <input v-model="mergeSourceIds" type="checkbox" :value="Number(row.id)" />
              {{ row['层位编号'] }}（土质 {{ row['土质'] }}／土色 {{ row['土色'] }}）
            </label>
            <p v-if="!mergeSources.length" class="merge-hint">
              保留层位所在探方下没有其他可并入的层位，可换一条保留层位。
            </p>
          </div>
          <label v-for="field in mergeFieldNames" :key="field" class="filter-item">
            <span>
              {{ field }}
              <em v-if="field === '土质' || field === '土色'" class="merge-note">（以现场编录原单为准）</em>
            </span>
            <input v-model="mergeForm[field]" :placeholder="`默认为保留层位的${field}`" />
          </label>
          <button class="btn primary" type="button" :disabled="!mergeSourceIds.length" @click="submitMerge">
            提交合并
          </button>
        </div>
      </template>

      <div v-if="pendingBatches.length" class="merge-pending">
        <h4>待续办的合并批次</h4>
        <ul>
          <li v-for="batch in pendingBatches" :key="batch.id">
            {{ batch.id }}（{{ batch.trenchNo }}）：保留 {{ batch.targetLayerNo }}，
            待并入 {{ remainingLayers(batch) }}
            <button class="link" type="button" @click="resumeBatch(batch.id)">继续办理</button>
          </li>
        </ul>
      </div>

      <p v-if="mergeMessage" class="merge-message">{{ mergeMessage }}</p>
      <p class="merge-hint">已办结的合并结论汇总在「探方登记」页的层位合并结论清单。</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条地层堆积记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  listMergeableLayers,
  listPendingMerges,
  mergeStrata,
  moduleMeta,
  resumeMerge,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, MergeBatch } from '@/data/types'

const meta = moduleMeta('stratum')
const columns = ["层位编号", "所属探方", "土质", "土色", "包含物", "堆积厚度", "判定年代", "堆积状态"]
const actions = ["提交编录", "送交复核", "合并层位"]
const statuses = ["待编录", "编录中", "已复核"]
const stats = [{"label": "待编录层位", "value": 0}, {"label": "编录中层位", "value": 0}, {"label": "已复核层位", "value": 0}]
const MERGEABLE_STATUSES = ['编录中', '已复核']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 层位合并面板：候选层位与探方登记页读的是同一份 listMergeableLayers()。
const mergeable = ref<EntryRow[]>([])
const mergeTargetId = ref<number | null>(null)
const mergeSourceIds = ref<number[]>([])
const mergeFieldNames = ['土质', '土色', '包含物', '堆积厚度', '判定年代']
const mergeForm = ref<Record<string, string>>({ 土质: '', 土色: '', 包含物: '', 堆积厚度: '', 判定年代: '' })
const pendingBatches = ref<MergeBatch[]>([])
const mergeMessage = ref('')

const mergeSources = computed(() => {
  const target = mergeable.value.find((row) => Number(row.id) === mergeTargetId.value)
  if (!target) {
    return []
  }
  return mergeable.value.filter(
    (row) => Number(row.id) !== mergeTargetId.value && String(row['所属探方']) === String(target['所属探方']),
  )
})

watch(mergeTargetId, () => {
  mergeSourceIds.value = []
  const target = mergeable.value.find((row) => Number(row.id) === mergeTargetId.value)
  mergeForm.value = {
    土质: String(target?.['土质'] ?? ''),
    土色: String(target?.['土色'] ?? ''),
    包含物: String(target?.['包含物'] ?? ''),
    堆积厚度: String(target?.['堆积厚度'] ?? ''),
    判定年代: String(target?.['判定年代'] ?? ''),
  }
})

function remainingLayers(batch: MergeBatch): string {
  return batch.steps
    .filter((step) => step.state !== '已合并')
    .map((step) => step.layerNo)
    .join('、')
}

function refreshMergePanel() {
  mergeable.value = listMergeableLayers()
  pendingBatches.value = listPendingMerges()
  if (!mergeable.value.some((row) => Number(row.id) === mergeTargetId.value)) {
    mergeTargetId.value = mergeable.value.length > 0 ? Number(mergeable.value[0].id) : null
  }
}

function submitMerge() {
  mergeMessage.value = ''
  if (mergeTargetId.value === null) {
    mergeMessage.value = '请先选择保留层位'
    return
  }
  const result = mergeStrata({
    targetId: mergeTargetId.value,
    sourceIds: [...mergeSourceIds.value],
    fields: { ...mergeForm.value },
  })
  mergeMessage.value = result.message
  reload()
}

function resumeBatch(batchId: string) {
  mergeMessage.value = ''
  const result = resumeMerge(batchId)
  mergeMessage.value = result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '地层堆积登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '合并层位') {
    // 合并走下方合并面板的整批流程，不再做单条状态翻转。
    if (!MERGEABLE_STATUSES.includes(String(row.status))) {
      errorMessage.value = `层位 ${row['层位编号']} 当前状态为「${row.status}」，不能参与合并`
      return
    }
    mergeTargetId.value = Number(row.id)
    mergeMessage.value = `已把 ${row['层位编号']} 设为保留层位，请在下方合并面板勾选要并入的层位`
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshMergePanel()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地层堆积列表读取失败'
  }
}

onMounted(reload)
</script>
