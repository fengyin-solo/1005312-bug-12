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

/** 层位合并：批次台账持久化在本地，断线后续办、办结结论都以此为凭。 */

export type MergeStepState = '待合并' | '已合并' | '失败'

export type MergeStep = {
  sourceId: number
  layerNo: string
  state: MergeStepState
  /** 被并层位的现场编录原单快照，办结后原记录移出清单，快照留在台账里备查。 */
  snapshot: { 土质: string; 土色: string }
  conclusion: string
}

export type MergeBatchState = '进行中' | '待续办' | '已办结'

/** 合并后保留层位的字段取值：土质、土色恒为现场编录原单值，其余可在合并单里调整。 */
export type MergeFields = {
  土质: string
  土色: string
  包含物: string
  堆积厚度: string
  判定年代: string
}

export type MergeBatch = {
  id: string
  /** 保留层位 + 并入层位集合的签名：同一批重试凭它找到断点，不会从头再并。 */
  signature: string
  trenchNo: string
  targetId: number
  targetLayerNo: string
  fields: MergeFields
  /** 合并单里与现场编录原单不一致、被原单驳回的说明。 */
  conflicts: string[]
  steps: MergeStep[]
  state: MergeBatchState
  createdAt: string
  finishedAt: string
  conclusion: string
}

export type MergePlanInput = {
  targetId: number
  sourceIds: number[]
  fields: Partial<MergeFields>
}

export type MergeResult = ActionResult & {
  batch?: MergeBatch
}
