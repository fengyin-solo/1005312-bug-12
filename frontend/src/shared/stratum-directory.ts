import { listRows } from '@/data/local-store'
import type { EntryRow, MergeGroup, StratumDirectoryEntry } from '@/data/types'

// 层位编号目录：编录清单、合并办理、探方登记多处入口都从这里读同一份层位编号数据，
// 不再各查各的，避免编号对不上、状态各说各话。

const CODE_FIELD = '层位编号'
const TRENCH_FIELD = '所属探方'

export function stratumCode(row: EntryRow): string {
  return String(row[CODE_FIELD] ?? '')
}

export function isAbsorbed(row: EntryRow): boolean {
  return Boolean(row.absorbed)
}

/** 全部层位的目录视图（含已被并掉的，被并条目带并入去向）。 */
export function readStratumDirectory(): StratumDirectoryEntry[] {
  return listRows('stratum')
    .slice()
    .sort((a, b) => stratumCode(a).localeCompare(stratumCode(b), 'zh-Hans-CN'))
    .map((row) => ({
      code: stratumCode(row),
      trench: String(row[TRENCH_FIELD] ?? ''),
      status: String(row.status ?? ''),
      merged: String(row.status) === '已合并',
      absorbed: isAbsorbed(row),
      mergedInto: String(row.mergedInto ?? ''),
      mergedIntoCode: String(row.mergedIntoCode ?? ''),
    }))
}

/** 正式编录清单：被并掉的层位不在此处出现（只留在「已并层位」档案里，且档案详情不留空白）。 */
export function activeStrata(): EntryRow[] {
  return listRows('stratum').filter((row) => !isAbsorbed(row))
}

/** 可参与合并的层位：已复核、未合并、未被并掉。 */
export function mergeableStrata(): EntryRow[] {
  return listRows('stratum').filter(
    (row) => String(row.status) === '已复核' && !isAbsorbed(row),
  )
}

/** 可发起合并的候选组：同一探方下可合并层位至少两条。 */
export function mergeableGroups(): MergeGroup[] {
  const byTrench = new Map<string, EntryRow[]>()
  for (const row of mergeableStrata()) {
    const trench = String(row[TRENCH_FIELD] ?? '')
    const members = byTrench.get(trench) ?? []
    members.push(row)
    byTrench.set(trench, members)
  }
  return [...byTrench.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([trench, members]) => ({
      trench,
      members: members.sort((a, b) => stratumCode(a).localeCompare(stratumCode(b), 'zh-Hans-CN')),
    }))
}
