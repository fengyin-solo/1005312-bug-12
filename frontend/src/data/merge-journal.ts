import type { MergeBatch } from './types'

// 合并批次台账：与编录清单分开落账。断线中断、断点续办、办结结论都以这份台账为准，
// 刷新或重开浏览器后仍在，重试时凭它接着走而不是从头再并。
const MERGE_STORAGE_KEY = 'archaeology-field:merge-batches'

let cache: MergeBatch[] | null = null

export function loadBatches(): MergeBatch[] {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = []
    return cache
  }
  const raw = window.localStorage.getItem(MERGE_STORAGE_KEY)
  if (!raw) {
    cache = []
    return cache
  }
  try {
    cache = JSON.parse(raw) as MergeBatch[]
  } catch {
    cache = []
  }
  return cache
}

export function saveBatches(batches: MergeBatch[]): void {
  cache = batches
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MERGE_STORAGE_KEY, JSON.stringify(batches))
  }
}

export function mergeStorageKey(): string {
  return MERGE_STORAGE_KEY
}
