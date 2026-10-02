import { SEED_BATCHES, SEED_ROWS } from './seed'
import type { EntryRow, MergeBatch } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都在。
// v2：层位数据与合并批次放在同一根对象，合并提交一次性整根写入，天然要么全成、要么全不成。
const STORAGE_KEY = 'archaeology-field:entries:v2'

export type StoreRoot = {
  rows: Record<string, EntryRow[]>
  batches: MergeBatch[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedRoot(): StoreRoot {
  return { rows: clone(SEED_ROWS), batches: clone(SEED_BATCHES) }
}

function readStorage(): StoreRoot {
  const fallback = seedRoot()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreRoot>
    return {
      rows: { ...fallback.rows, ...(parsed.rows ?? {}) },
      batches: Array.isArray(parsed.batches) ? parsed.batches : fallback.batches,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoreRoot | null = null

export function storeRoot(): StoreRoot {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 整根写回：一次提交内对层位、探方、批次的所有改动同时落盘，不会出现半成品。 */
export function commitRoot(root: StoreRoot): void {
  cache = root
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(root))
  }
}

export function mutateRoot(mutate: (draft: StoreRoot) => void): StoreRoot {
  const next = clone(storeRoot())
  mutate(next)
  commitRoot(next)
  return next
}

export function allRows(): Record<string, EntryRow[]> {
  return storeRoot().rows
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  mutateRoot((draft) => {
    draft.rows[key] = rows
  })
}

export function listBatches(): MergeBatch[] {
  return storeRoot().batches
}

export function saveBatches(batches: MergeBatch[]): void {
  mutateRoot((draft) => {
    draft.batches = batches
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
