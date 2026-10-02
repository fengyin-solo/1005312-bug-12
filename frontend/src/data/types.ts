/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ── 层位合并 ────────────────────────────────────────────────────────────────

/** 单步合并要落到保留层位上的字段结论；结论在步骤建立时冻结，重试只沿用、不改写。 */
export type MergePatch = {
  [field: string]: string
}

export type MergeStepStatus = '待执行' | '已合并' | '失败'

/** 一次合并中的一个步骤：把 absorbedId 这条层位并入 targetId。 */
export type MergeStep = {
  absorbedId: number
  absorbedCode: string
  status: MergeStepStatus
  /** 步骤建立时冻结的结论；重试成功后只承认这份，不重新计算，避免“反悔”。 */
  patch: MergePatch
  message: string
}

export type MergeBatchStatus = '进行中' | '中断' | '已办结'

/**
 * 一次层位合并批次：要么全部步骤办结后一次性提交（全成），
 * 要么一条都不落到正式清单（全不成）。中断后按步骤顺序从失败处续跑。
 */
export type MergeBatch = {
  id: string
  trench: string
  targetId: number
  targetCode: string
  status: MergeBatchStatus
  steps: MergeStep[]
  createdAt: string
  committedAt: string
  lastError: string
}

/** 可发起合并的候选组：同一探方下、已复核且尚未合并的层位至少两条。 */
export type MergeGroup = {
  trench: string
  members: EntryRow[]
}

/** 层位编号目录条目：多个入口（编录清单、探方清单、合并办理）读的是同一份。 */
export type StratumDirectoryEntry = {
  code: string
  trench: string
  status: string
  merged: boolean
  absorbed: boolean
  mergedInto: string
  mergedIntoCode: string
}
