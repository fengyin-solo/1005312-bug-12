<template>
  <div v-if="open" class="drawer-mask" @click.self="emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <h3>层位详情</h3>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <div v-if="!row" class="drawer-empty">
        <p>该层位编号在目录里查不到记录。</p>
        <p class="muted">
          它可能已在一次合并中被并掉；被并层位不留在编录清单，请改到「已并层位」档案按编号查看并入去向。
        </p>
      </div>

      <template v-else>
        <p v-if="absorbed" class="drawer-notice">
          本层位（{{ row['层位编号'] }}）已在层位合并中并入
          <strong>{{ row.mergedIntoCode }}</strong
          >，编录清单不再单列；以下为归档留痕，不是缺失数据。
        </p>

        <table class="data-table detail-table">
          <tbody>
            <tr v-for="field in fields" :key="field">
              <th>{{ field }}</th>
              <td>{{ row[field] || '—' }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ row.status }}</td>
            </tr>
          </tbody>
        </table>

        <section v-if="absorbed && batch" class="drawer-trace">
          <h4>合并留痕（批次 {{ batch.id }}）</h4>
          <p class="muted">所属探方：{{ batch.trench }} ｜ 办结时间：{{ batch.committedAt }}</p>
          <p v-for="step in traceSteps" :key="step.absorbedCode" class="trace-line">
            · {{ step.absorbedCode }} → {{ batch.targetCode
            }}<span v-if="step.message">：{{ step.message }}</span>
          </p>
        </section>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { moduleMeta } from '@/api/local-service'
import { listMergeBatches } from '@/api/merge-service'
import type { EntryRow, MergeBatch } from '@/data/types'
import { isAbsorbed } from '@/shared/stratum-directory'

const props = defineProps<{ open: boolean; row: EntryRow | null }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const meta = moduleMeta('stratum')
const fields = meta.fields

const absorbed = computed(() => (props.row ? isAbsorbed(props.row) : false))

const batch = computed<MergeBatch | undefined>(() => {
  if (!props.row || !absorbed.value) {
    return undefined
  }
  const targetId = String(props.row.mergedInto ?? '')
  return listMergeBatches().find(
    (item) =>
      item.status === '已办结' &&
      String(item.targetId) === targetId &&
      item.steps.some((step) => step.absorbedId === Number(props.row?.id)),
  )
})

const traceSteps = computed(() => batch.value?.steps ?? [])
</script>
