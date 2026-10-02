<template>
  <section class="page" data-module="stratum">
    <header class="page-head">
      <div>
        <h2>地层堆积管理</h2>
        <p class="page-desc">
          维护地层堆积与层位合并：编录清单只列有效层位，合并整批提交、中断可续跑，被并层位在档案里留痕，办结结论落到探方清单。
        </p>
      </div>
      <div class="page-actions">
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

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </nav>

    <!-- 编录清单：被并掉的层位不在此处，避免点进去一片空白 -->
    <div v-show="activeTab === 'catalog'">
      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
        <button class="btn primary" type="button" @click="activeTab = 'merge'">去合并办理</button>
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
            <td v-for="column in columns" :key="column">
              <button class="link" type="button" @click="openDetail(row)">{{ row[column] ?? '—' }}</button>
            </td>
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
              <button class="link" type="button" @click="openDetail(row)">详情</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">
              <template v-if="hasFilters">没有符合检索条件的地层堆积，换个关键词或重置条件再试。</template>
              <template v-else>编录清单暂无可显示的层位；可先登记地层堆积，或到「已并层位」查看归档。</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 合并办理 -->
    <MergeCenter
      v-show="activeTab === 'merge'"
      @go-catalog="activeTab = 'catalog'"
      @notice="showNotice"
    />

    <!-- 已并层位档案 -->
    <div v-show="activeTab === 'archive'">
      <table class="data-table">
        <thead>
          <tr>
            <th>层位编号</th>
            <th>所属探方</th>
            <th>并入层位</th>
            <th>原土质</th>
            <th>原土色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in archivedRows" :key="String(row.id)">
            <td>{{ row['层位编号'] }}</td>
            <td>{{ row['所属探方'] }}</td>
            <td>{{ row.mergedIntoCode }}</td>
            <td>{{ row['土质'] }}</td>
            <td>{{ row['土色'] }}</td>
            <td>{{ row.status }}</td>
            <td><button class="link" type="button" @click="openDetail(row)">查看留痕</button></td>
          </tr>
          <tr v-if="!archivedRows.length">
            <td colspan="7" class="empty-state">
              还没有被合并的层位。合并办结后，被并层位会归档到这里，并标明并入了哪条层位。
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>
        编录清单 {{ total }} 条有效层位 ｜ 已并归档 {{ archivedRows.length }} 条 ｜ 层位编号与各入口共用同一份目录数据
      </span>
      <span v-if="noticeMessage" :class="noticeOk ? 'ok-text' : 'error-text'">{{ noticeMessage }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <StratumDetailDrawer :open="detailOpen" :row="detailRow" @close="detailOpen = false" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listMergeBatches } from '@/api/merge-service'
import type { EntryRow } from '@/data/types'
import { activeStrata, isAbsorbed } from '@/shared/stratum-directory'

import MergeCenter from './MergeCenter.vue'
import StratumDetailDrawer from './StratumDetailDrawer.vue'

const meta = moduleMeta('stratum')
const columns = ['层位编号', '所属探方', '编录来源', '土质', '土色', '包含物', '堆积厚度', '判定年代', '堆积状态']
const actions = ['提交编录', '送交复核']
const statuses = ['待编录', '编录中', '已复核', '已合并']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const noticeOk = ref(true)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const activeTab = ref<'catalog' | 'merge' | 'archive'>('catalog')

// 数据存在模块级缓存里（非响应式），合并办理改动数据后 bump 一下，驱动各清单重算。
const refreshTick = ref(0)

const detailOpen = ref(false)
const detailRow = ref<EntryRow | null>(null)

// 编录清单只取有效层位（被并层位退出清单），但筛选条件仍然作用在这份数据上。
const activeRows = computed(() => {
  void refreshTick.value
  return filterRows(activeStrata(), filters.value)
})
const archivedRows = computed(() => {
  void refreshTick.value
  return listEntries(meta.key).items
    .filter((row) => isAbsorbed(row))
    .sort((a, b) => String(a['层位编号']).localeCompare(String(b['层位编号']), 'zh-Hans-CN'))
})

const stats = computed(() => [
  { label: '待编录层位', value: activeRows.value.filter((row) => row.status === '待编录').length },
  { label: '编录中层位', value: activeRows.value.filter((row) => row.status === '编录中').length },
  { label: '已复核层位', value: activeRows.value.filter((row) => row.status === '已复核').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: activeRows.value.filter((row) => String(row.status) === status).length,
  })),
)

const hasFilters = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)

const tabs = computed(() => {
  void refreshTick.value
  const pendingBatches = listMergeBatches().filter((b) => b.status !== '已办结').length
  return [
    { key: 'catalog' as const, label: '编录清单', badge: '' },
    { key: 'merge' as const, label: '合并办理', badge: pendingBatches ? String(pendingBatches) : '' },
    { key: 'archive' as const, label: '已并层位', badge: archivedRows.value.length ? String(archivedRows.value.length) : '' },
  ]
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function showNotice(payload: { ok: boolean; message: string }) {
  noticeOk.value = payload.ok
  noticeMessage.value = payload.message
  refreshTick.value += 1
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
  detailOpen.value = true
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  showNotice({ ok: result.ok, message: result.message })
  if (result.ok) {
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = activeRows.value
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地层堆积列表读取失败'
  }
}

onMounted(reload)
</script>
