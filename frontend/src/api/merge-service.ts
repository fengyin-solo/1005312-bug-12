import { listBatches, mutateRoot } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  MergeBatch,
  MergeGroup,
  MergePatch,
  MergeStep,
} from '@/data/types'
import { isAbsorbed, mergeableGroups, stratumCode } from '@/shared/stratum-directory'

// 层位合并服务。
// 约束：
// 1. 一次批次要么全部步骤办结后一次性提交（全成），要么一条都不落到正式清单（全不成）；
// 2. 步骤结论在建批时当场冻结，重试只从第一条未成功的步骤续跑，已并好的步骤沿用既有结论，绝不反悔改写；
// 3. 提交是对 localStorage 整根数据的单次写入，层位、被并留痕、探方结论同生同灭；
// 4. 土质、土色各处填得不一致时，以「现场编录原单」为准。

const FIELD_SOURCE = '编录来源'
const FIELD_TEXTURE = '土质'
const FIELD_COLOR = '土色'
const FIELD_INCLUSIONS = '包含物'
const FIELD_THICKNESS = '堆积厚度'
const ORIGINAL_SOURCE = '现场编录原单'
const MERGED_STATUS = '已合并'
const OFFLINE_KEY = 'archaeology-field:merge:force-offline'

export type BatchActionResult = ActionResult & { batchId?: string }

function isOriginal(row: EntryRow): boolean {
  return String(row[FIELD_SOURCE] ?? '') === ORIGINAL_SOURCE
}

/** 土质/土色：以现场编录原单为准；都不是原单或取值相同则沿用保留层位。 */
function resolveAuthoritative(
  target: EntryRow,
  absorbed: EntryRow,
  field: string,
): { value: string; note: string } {
  const keep = String(target[field] ?? '')
  const other = String(absorbed[field] ?? '')
  if (keep === other) {
    return { value: keep, note: '' }
  }
  if (isOriginal(absorbed) && !isOriginal(target)) {
    return { value: other, note: `本层${field}为转抄值，按现场编录原单改记「${other}」` }
  }
  if (isOriginal(target)) {
    return {
      value: keep,
      note: `两处${field}填法不一致（原单「${keep}」/ 转抄「${other}」），以现场编录原单「${keep}」为准`,
    }
  }
  // 两边都不是原单时，仍以保留层位为准，并提示补核对。
  return { value: keep, note: `两处${field}不一致且均非原单，暂沿用保留层位「${keep}」，请补核对` }
}

/** 包含物按顿号/逗号拆分去重合并，保持出现顺序。 */
function mergeInclusions(keep: string, incoming: string): string {
  const parts = [keep, incoming]
    .flatMap((value) => String(value).split(/[、,，]/))
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(parts)].join('、')
}

function parseThickness(value: string): number | null {
  const matched = value.match(/-?\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

function thicknessUnit(value: string): string {
  const matched = value.match(/[a-zA-Z一-龥]+$/)
  return matched ? matched[0] : 'm'
}

/** 堆积厚度：可解析则累加，解析不出来就把两段原文并列保留，绝不丢数。 */
function mergeThickness(keep: string, incoming: string): string {
  const a = parseThickness(keep)
  const b = parseThickness(incoming)
  if (a === null || b === null) {
    return `${keep}+${incoming}`
  }
  const sum = Math.round((a + b) * 100) / 100
  return `${sum}${thicknessUnit(keep) || thicknessUnit(incoming)}`
}

/**
 * 建步骤时把结论冻结进 patch：后续重试只认这份。
 * 返回的 patch 只含真正会变的字段（土质/土色/包含物/堆积厚度）。
 */
function freezeStepPatch(target: EntryRow, absorbed: EntryRow): { patch: MergePatch; notes: string[] } {
  const patch: MergePatch = {}
  const notes: string[] = []

  for (const field of [FIELD_TEXTURE, FIELD_COLOR]) {
    const { value, note } = resolveAuthoritative(target, absorbed, field)
    if (value !== String(target[field] ?? '')) {
      patch[field] = value
    }
    if (note) {
      notes.push(note)
    }
  }

  const inclusions = mergeInclusions(
    String(target[FIELD_INCLUSIONS] ?? ''),
    String(absorbed[FIELD_INCLUSIONS] ?? ''),
  )
  if (inclusions !== String(target[FIELD_INCLUSIONS] ?? '')) {
    patch[FIELD_INCLUSIONS] = inclusions
  }

  const thickness = mergeThickness(
    String(target[FIELD_THICKNESS] ?? ''),
    String(absorbed[FIELD_THICKNESS] ?? ''),
  )
  if (thickness !== String(target[FIELD_THICKNESS] ?? '')) {
    patch[FIELD_THICKNESS] = thickness
  }

  return { patch, notes }
}

/** 沿步骤顺序把冻结补丁依次叠到保留层位上，得到提交时的最终字段值。 */
export function projectedTarget(batch: MergeBatch): MergePatch {
  const result: MergePatch = {}
  for (const step of batch.steps) {
    Object.assign(result, step.patch)
  }
  return result
}

export function listMergeBatches(): MergeBatch[] {
  return listBatches().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getMergeBatch(id: string): MergeBatch | undefined {
  return listBatches().find((batch) => batch.id === id)
}

export function listCandidateGroups(): MergeGroup[] {
  return mergeableGroups()
}

function unfinishedExists(trench: string, excludeId?: string): MergeBatch | undefined {
  return listBatches().find(
    (batch) =>
      batch.trench === trench &&
      batch.status !== '已办结' &&
      batch.id !== excludeId,
  )
}

function newBatchId(): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const serial = String(listBatches().length + 1).padStart(4, '0')
  return `MB-${stamp}-${serial}`
}

function timestamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * 建立合并批次：结论当场冻结，不动任何正式数据。
 * targetId 为保留层位，其余成员按编号顺序逐条并入。
 */
export function createMergeBatch(group: MergeGroup, targetId: number): BatchActionResult {
  if (group.members.length < 2) {
    return { ok: false, message: '至少要选两条已复核层位才能合并' }
  }
  const target = group.members.find((row) => Number(row.id) === targetId)
  if (!target) {
    return { ok: false, message: '没有选到保留层位，无法建批' }
  }
  const blocked = unfinishedExists(group.trench)
  if (blocked) {
    return {
      ok: false,
      message: `探方 ${group.trench} 已有进行中/中断的合并批次（保留层位 ${blocked.targetCode}），请先办结或放弃后再发起`,
    }
  }

  const absorbed = group.members
    .filter((row) => Number(row.id) !== targetId)
    .sort((a, b) => stratumCode(a).localeCompare(stratumCode(b), 'zh-Hans-CN'))

  // 以保留层位为基线，逐条冻结结论（后一条看到的是前一条并入后的结果）。
  const baseline: EntryRow = { ...target }
  const steps: MergeStep[] = absorbed.map((row) => {
    const { patch, notes } = freezeStepPatch(baseline, row)
    for (const [field, value] of Object.entries(patch)) {
      baseline[field] = value
    }
    return {
      absorbedId: Number(row.id),
      absorbedCode: stratumCode(row),
      status: '待执行',
      patch,
      message: notes.join('；'),
    }
  })

  const batch: MergeBatch = {
    id: newBatchId(),
    trench: group.trench,
    targetId: Number(target.id),
    targetCode: stratumCode(target),
    status: '进行中',
    steps,
    createdAt: timestamp(),
    committedAt: '',
    lastError: '',
  }

  mutateRoot((draft) => {
    draft.batches.push(batch)
  })
  return { ok: true, message: `合并批次 ${batch.id} 已建立，共 ${steps.length} 步，结论已冻结，尚未改动正式清单`, batchId: batch.id }
}

// ── 断线模拟：纯前端演示用。真实环境里 navigator.onLine 由浏览器给出。 ────────

export function isOffline(): boolean {
  const forced =
    typeof window !== 'undefined' &&
    window.localStorage &&
    window.localStorage.getItem(OFFLINE_KEY) === '1'
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  return forced || browserOffline
}

export function setForceOffline(offline: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  if (offline) {
    window.localStorage.setItem(OFFLINE_KEY, '1')
  } else {
    window.localStorage.removeItem(OFFLINE_KEY)
  }
}

/**
 * 续跑批次：从第一条未成功的步骤开始逐条执行。
 * 已「已合并」的步骤原样跳过，冻结结论不重算，所以重试不会反悔改写。
 * 断线时当前步骤记为「失败」并停下，批次标「中断」；正式数据仍不动（只有全步骤成功才提交）。
 */
export function runMergeBatch(id: string): BatchActionResult {
  const found = listBatches().find((item) => item.id === id)
  if (!found) {
    return { ok: false, message: `没有找到合并批次 ${id}` }
  }
  if (found.status === '已办结') {
    return { ok: false, message: `批次 ${id} 已办结，无需重复执行` }
  }
  // 在副本上推进，结论只经 persistBatch/commit 落盘。
  const batch: MergeBatch = JSON.parse(JSON.stringify(found)) as MergeBatch

  for (const step of batch.steps) {
    if (step.status === '已合并') {
      continue // 已并好的步骤沿用既有结论，绝不重跑
    }
    if (isOffline()) {
      step.status = '失败'
      step.message = step.message
        ? `${step.message}；网络中断，该步未提交`
        : '网络中断，该步未提交'
      batch.status = '中断'
      batch.lastError = `合并 ${step.absorbedCode} 时网络中断，已停在这一步；恢复网络后点「继续合并」从本步续跑，已并好的层位不会重并`
      persistBatch(batch)
      return {
        ok: false,
        message: batch.lastError,
        batchId: batch.id,
      }
    }
    step.status = '已合并'
  }

  // 所有步骤成功 → 一次性原子提交，要么全成、要么全不成。
  const commitError = commitBatch(batch)
  if (commitError) {
    return { ok: false, message: commitError, batchId: batch.id }
  }
  return {
    ok: true,
    message: `批次 ${batch.id} 已办结：${batch.steps
      .map((step) => step.absorbedCode)
      .join('、')} 全部并入 ${batch.targetCode}，结论已落到探方 ${batch.trench} 清单`,
    batchId: batch.id,
  }
}

function persistBatch(batch: MergeBatch): void {
  mutateRoot((draft) => {
    const index = draft.batches.findIndex((item) => item.id === batch.id)
    if (index >= 0) {
      draft.batches[index] = JSON.parse(JSON.stringify(batch)) as MergeBatch
    }
  })
}

/** 整根单次写入：保留层位改字段/状态、被并层位打 absorbed 留痕、探方写结论，同时生效。 */
function commitBatch(batch: MergeBatch): string {
  if (batch.steps.some((step) => step.status !== '已合并')) {
    return '仍有步骤未合并成功，不能提交'
  }
  let error = ''
  mutateRoot((draft) => {
    const strata = draft.rows.stratum ?? []
    const trenches = draft.rows.trench ?? []
    const targetIndex = strata.findIndex((row) => Number(row.id) === batch.targetId)
    if (targetIndex < 0) {
      error = `保留层位 ${batch.targetCode} 已不在编录中，批次无法提交（本次未改动任何数据）`
      return
    }

    const finalPatch = projectedTarget(batch)
    const target: EntryRow = {
      ...strata[targetIndex],
      ...finalPatch,
      status: MERGED_STATUS,
      pending: false,
      absorbed: false,
      mergedInto: '',
      mergedIntoCode: '',
    }

    for (const step of batch.steps) {
      const index = strata.findIndex((row) => Number(row.id) === step.absorbedId)
      if (index < 0 || isAbsorbed(strata[index])) {
        error = `被并层位 ${step.absorbedCode} 已缺失或已并入其他层位，批次拒绝提交（本次未改动任何数据）`
        return
      }
    }

    const nextStrata = strata.map((row) => {
      if (Number(row.id) === batch.targetId) {
        return target
      }
      const step = batch.steps.find((item) => item.absorbedId === Number(row.id))
      if (!step) {
        return row
      }
      // 被并掉的层位：打上留痕标记并记录去向。它会退出正式编录清单，但在档案里点进去有完整去向，不是空白。
      return {
        ...row,
        status: MERGED_STATUS,
        pending: false,
        absorbed: true,
        mergedInto: String(batch.targetId),
        mergedIntoCode: batch.targetCode,
      }
    })

    const absorbedCodes = batch.steps.map((step) => step.absorbedCode).join('、')
    const conclusion = `${absorbedCodes} 已并入 ${batch.targetCode}，${timestamp().slice(0, 10)} 办结`
    let trenchTouched = false
    const nextTrenches = trenches.map((row) => {
      if (String(row['探方编号'] ?? '') !== batch.trench) {
        return row
      }
      trenchTouched = true
      return { ...row, 层位合并结论: conclusion }
    })
    if (!trenchTouched) {
      error = `探方 ${batch.trench} 不在探方清单里，办结结论无处落账，批次拒绝提交（本次未改动任何数据）`
      return
    }

    const now = timestamp()
    const nextBatch: MergeBatch = {
      ...JSON.parse(JSON.stringify(batch)) as MergeBatch,
      status: '已办结',
      committedAt: now,
      lastError: '',
    }

    draft.rows.stratum = nextStrata
    draft.rows.trench = nextTrenches
    draft.batches = draft.batches.map((item) => (item.id === batch.id ? nextBatch : item))
  })
  return error
}

/** 放弃未办结批次（不触碰任何正式层位数据）。 */
export function discardMergeBatch(id: string): ActionResult {
  const batch = listBatches().find((item) => item.id === id)
  if (!batch) {
    return { ok: false, message: `没有找到合并批次 ${id}` }
  }
  if (batch.status === '已办结') {
    return { ok: false, message: '已办结批次不能放弃，留痕需保留' }
  }
  mutateRoot((draft) => {
    draft.batches = draft.batches.filter((item) => item.id !== id)
  })
  return { ok: true, message: `批次 ${id} 已放弃，正式清单未做任何改动` }
}
