import { MODULE_BY_KEY } from '@/data/modules'
import { loadBatches, saveBatches } from '@/data/merge-journal'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  MergeBatch,
  MergePlanInput,
  MergeResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === 'stratum') {
    // 编录清单回到示例数据时，合并台账一并清掉，避免旧批次压着新层位。
    saveBatches([])
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 层位合并 ——
// 整批要么办结、要么不办结：编录清单只在全部步骤走完时一次性提交；
// 每一步的进度先落在合并台账里，断线后从失败那条接着走，
// 已并好的层位沿用台账里的既有结论，重试不会反悔改写。

const MERGEABLE_STATUSES = ['编录中', '已复核']

function mergeSignature(targetId: number, sourceIds: number[]): string {
  return `${targetId}<-${[...sourceIds].sort((a, b) => a - b).join(',')}`
}

/** 被未办结批次占用的层位：不能再进合并候选，避免两批交叉并同一条。 */
function busyLayerIds(): Set<number> {
  const busy = new Set<number>()
  for (const batch of loadBatches()) {
    if (batch.state === '已办结') continue
    busy.add(batch.targetId)
    for (const step of batch.steps) busy.add(step.sourceId)
  }
  return busy
}

/** 可合并层位的唯一口径：地层堆积页合并面板、探方登记页合并结论区都从这里读同一份。 */
export function listMergeableLayers(): EntryRow[] {
  const busy = busyLayerIds()
  return listRows('stratum').filter(
    (row) => MERGEABLE_STATUSES.includes(String(row.status)) && !busy.has(Number(row.id)),
  )
}

/** 未办结（含中断待续办）的合并批次。 */
export function listPendingMerges(): MergeBatch[] {
  return loadBatches().filter((batch) => batch.state !== '已办结')
}

/** 已办结的合并结论：落到探方登记页的清单里。 */
export function listMergeConclusions(): MergeBatch[] {
  return loadBatches().filter((batch) => batch.state === '已办结')
}

function persistBatch(batch: MergeBatch): void {
  const batches = loadBatches()
  const index = batches.findIndex((item) => item.id === batch.id)
  saveBatches(index >= 0 ? batches.map((item) => (item.id === batch.id ? batch : item)) : [...batches, batch])
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function mergeStrata(input: MergePlanInput): MergeResult {
  const signature = mergeSignature(input.targetId, input.sourceIds)
  const existing = loadBatches().find((batch) => batch.signature === signature && batch.state !== '已办结')
  if (existing) {
    // 同一批的重试：接着台账里的断点走，已并好的层位沿用既有结论，不按新填的单子反悔。
    return runMergeBatch(existing, true)
  }
  if (input.sourceIds.length === 0) {
    return { ok: false, message: '请先勾选要并入的层位' }
  }
  if (input.sourceIds.includes(input.targetId)) {
    return { ok: false, message: '保留层位不能并入自身' }
  }
  const rows = listRows('stratum')
  const target = rows.find((row) => Number(row.id) === input.targetId)
  if (!target) {
    return { ok: false, message: '没有找到要保留的层位，可能已被合并' }
  }
  const busy = busyLayerIds()
  if (busy.has(input.targetId)) {
    return { ok: false, message: `层位 ${target['层位编号']} 已挂在未办结的合并批次里，请先续办该批次` }
  }
  const sources: EntryRow[] = []
  for (const sourceId of input.sourceIds) {
    const row = rows.find((item) => Number(item.id) === sourceId)
    if (!row) {
      return { ok: false, message: `编号 ${sourceId} 的层位不在编录清单中，可能已被合并` }
    }
    if (!MERGEABLE_STATUSES.includes(String(row.status))) {
      return { ok: false, message: `层位 ${row['层位编号']} 当前状态为「${row.status}」，不在可合并范围` }
    }
    if (String(row['所属探方']) !== String(target['所属探方'])) {
      return { ok: false, message: `层位 ${row['层位编号']} 与保留层位不在同一探方，不能合并` }
    }
    if (busy.has(sourceId)) {
      return { ok: false, message: `层位 ${row['层位编号']} 已挂在未办结的合并批次里，请先续办该批次` }
    }
    sources.push(row)
  }
  // 土质、土色以现场编录原单为准：合并单里填得不一致的，按原单保留并记一笔说明。
  const originalTexture = String(target['土质'] ?? '')
  const originalColor = String(target['土色'] ?? '')
  const conflicts: string[] = []
  if (input.fields.土质?.trim() && input.fields.土质.trim() !== originalTexture) {
    conflicts.push(`土质合并单填「${input.fields.土质.trim()}」，与原单不一致，已按现场编录原单保留「${originalTexture}」`)
  }
  if (input.fields.土色?.trim() && input.fields.土色.trim() !== originalColor) {
    conflicts.push(`土色合并单填「${input.fields.土色.trim()}」，与原单不一致，已按现场编录原单保留「${originalColor}」`)
  }
  const batch: MergeBatch = {
    id: `MERGE-${Date.now()}`,
    signature,
    trenchNo: String(target['所属探方'] ?? ''),
    targetId: Number(target.id),
    targetLayerNo: String(target['层位编号']),
    fields: {
      土质: originalTexture,
      土色: originalColor,
      包含物: input.fields.包含物?.trim() || String(target['包含物'] ?? ''),
      堆积厚度: input.fields.堆积厚度?.trim() || String(target['堆积厚度'] ?? ''),
      判定年代: input.fields.判定年代?.trim() || String(target['判定年代'] ?? ''),
    },
    conflicts,
    steps: sources.map((row) => ({
      sourceId: Number(row.id),
      layerNo: String(row['层位编号']),
      state: '待合并',
      snapshot: { 土质: String(row['土质'] ?? ''), 土色: String(row['土色'] ?? '') },
      conclusion: '',
    })),
    state: '进行中',
    createdAt: nowText(),
    finishedAt: '',
    conclusion: '',
  }
  return runMergeBatch(batch, false)
}

export function resumeMerge(batchId: string): MergeResult {
  const batch = loadBatches().find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: '没有找到这个合并批次，可能已被清理' }
  }
  if (batch.state === '已办结') {
    return { ok: true, message: `批次 ${batch.id} 已办结，无需重复办理`, batch }
  }
  return runMergeBatch(batch, true)
}

function runMergeBatch(batch: MergeBatch, resumed: boolean): MergeResult {
  batch.state = '进行中'
  persistBatch(batch)
  for (const step of batch.steps) {
    if (step.state === '已合并') {
      // 已并好的层位沿用台账里的既有结论，重试不反悔改写。
      continue
    }
    try {
      const row = listRows('stratum').find((item) => Number(item.id) === step.sourceId)
      if (!row) {
        throw new Error(`层位 ${step.layerNo} 已不在编录清单中`)
      }
      step.conclusion = `层位 ${step.layerNo} 并入 ${batch.targetLayerNo}，土质「${step.snapshot.土质}」、土色「${step.snapshot.土色}」以现场编录原单为准`
      step.state = '已合并'
    } catch (error) {
      step.state = '失败'
      batch.state = '待续办'
      persistBatch(batch)
      const reason = error instanceof Error ? error.message : '合并请求中断'
      return {
        ok: false,
        message: `合并到层位 ${step.layerNo} 时中断：${reason}。断点已记在这一条，继续办理时从这里接着走，已并好的层位不受影响。`,
        batch,
      }
    }
    // 每走一步就落一次账，断线重连后从失败那条续办，而不是从第一条重来。
    persistBatch(batch)
  }
  // 全部步骤走完才一次性提交编录清单：保留层位更新字段、被并层位移出清单。
  // 在此之前中断，清单一条不动，整批不办结。
  const rows = listRows('stratum')
  const target = rows.find((row) => Number(row.id) === batch.targetId)
  if (!target) {
    batch.state = '待续办'
    persistBatch(batch)
    return { ok: false, message: `保留层位 ${batch.targetLayerNo} 不在编录清单中，批次已挂起，待核实后续办`, batch }
  }
  const mergedAway = new Set(batch.steps.map((step) => step.sourceId))
  const nextRows = rows
    .filter((row) => !mergedAway.has(Number(row.id)))
    .map((row) => (Number(row.id) === batch.targetId ? { ...row, ...batch.fields } : row))
  saveRows('stratum', nextRows)
  batch.state = '已办结'
  batch.finishedAt = nowText()
  batch.conclusion = `${batch.trenchNo}：层位 ${batch.steps.map((step) => step.layerNo).join('、')} 并入 ${batch.targetLayerNo}；土质「${batch.fields.土质}」、土色「${batch.fields.土色}」以现场编录原单为准`
  persistBatch(batch)
  const resumedNote = resumed ? '（自断点续办）' : ''
  const conflictNote = batch.conflicts.length > 0 ? `；${batch.conflicts.join('；')}` : ''
  return { ok: true, message: `层位合并已办结${resumedNote}：${batch.conclusion}${conflictNote}`, batch }
}
