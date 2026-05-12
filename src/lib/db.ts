import { rateMergeKey, type Rate } from '@/types/market-data'

const DB_NAME = 'PowerToolsDB'
const DB_VERSION = 4
const RATES_STORE = 'rates'
const METADATA_STORE = 'metadata'
const WRITE_BATCH_SIZE = 5000
type GlobalWithSetImmediate = typeof globalThis & {
  setImmediate?: (callback: () => void) => void
}

type StoredRate = Rate & { readonly rateKey: string }
type PersistenceStatusListener = (isSyncing: boolean) => void

let dbPromise: Promise<IDBDatabase> | null = null
let activeDb: IDBDatabase | null = null
let pendingWriteCount = 0
const persistenceStatusListeners = new Set<PersistenceStatusListener>()
const globalWithSetImmediate = globalThis as GlobalWithSetImmediate
const scheduleImmediate =
  typeof globalWithSetImmediate.setImmediate === 'function'
    ? globalWithSetImmediate.setImmediate.bind(globalThis)
    : (callback: () => void) => {
        globalThis.setTimeout(callback, 0)
      }

function toStoredRate(rate: Rate): StoredRate {
  return { ...rate, rateKey: rateMergeKey(rate) }
}

function fromStoredRate(row: StoredRate): Rate {
  const rate = { ...row }
  delete (rate as { rateKey?: string }).rateKey
  return rate
}

export function initDB(): Promise<IDBDatabase> {
  if (activeDb) {
    return Promise.resolve(activeDb)
  }

  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result
      const oldVersion = event.oldVersion

      if (!db.objectStoreNames.contains(RATES_STORE)) {
        const store = db.createObjectStore(RATES_STORE, { keyPath: 'rateKey' })
        store.createIndex('effectiveDate', 'effectiveDate', { unique: false })
        console.log('✅ Database: created rates store (v3 keyPath rateKey)')
      }

      if (oldVersion < 3) {
        db.deleteObjectStore(RATES_STORE)
        const store = db.createObjectStore(RATES_STORE, { keyPath: 'rateKey' })
        store.createIndex('effectiveDate', 'effectiveDate', { unique: false })
        console.log('✅ Database Upgrade v3: recreated rates store with rateKey + effectiveDate index')
      }

      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE)
        console.log('✅ Database Upgrade v4: created metadata store')
      }
    }

    request.onsuccess = () => {
      const openedDb = request.result
      activeDb = openedDb
      openedDb.onversionchange = () => {
        openedDb.close()
        activeDb = null
        dbPromise = null
      }
      openedDb.onclose = () => {
        if (activeDb === openedDb) {
          activeDb = null
        }
        dbPromise = null
      }
      resolve(openedDb)
    }
    request.onerror = () => {
      dbPromise = null
      reject(request.error ?? new Error('Failed to open IndexedDB'))
    }
    request.onblocked = () => {
      dbPromise = null
      reject(new Error('IndexedDB open blocked by another tab or stale connection'))
    }
  })

  return dbPromise
}

export function isDatabaseReady(): boolean {
  return activeDb !== null
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.storage === undefined) {
    return false
  }
  try {
    const isPersisted = await navigator.storage.persisted()
    if (isPersisted) {
      return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function isPersistenceSyncing(): boolean {
  return pendingWriteCount > 0
}

export function subscribePersistenceStatus(listener: PersistenceStatusListener): () => void {
  persistenceStatusListeners.add(listener)
  listener(isPersistenceSyncing())
  return () => {
    persistenceStatusListeners.delete(listener)
  }
}

function emitPersistenceStatus(): void {
  const syncing = isPersistenceSyncing()
  persistenceStatusListeners.forEach((listener) => listener(syncing))
}

function beginPendingWrite(): void {
  pendingWriteCount += 1
  emitPersistenceStatus()
}

function endPendingWrite(): void {
  pendingWriteCount = Math.max(0, pendingWriteCount - 1)
  emitPersistenceStatus()
}

function scheduleWrite(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => callback())
    return
  }
  scheduleImmediate(callback)
}

function chunkRates(rates: Rate[]): Rate[][] {
  const chunks: Rate[][] = []
  for (let index = 0; index < rates.length; index += WRITE_BATCH_SIZE) {
    chunks.push(rates.slice(index, index + WRITE_BATCH_SIZE))
  }
  return chunks
}

export async function saveRatesToDisk(rates: Rate[]): Promise<void> {
  console.log(`DB: Starting save of ${rates.length} rates`)
  await appendRatesChunk(rates)

  console.log(`✅ Persisted ${rates.length} rates to IndexedDB`)
}

export async function appendRatesChunk(rates: Rate[]): Promise<void> {
  if (rates.length === 0) {
    return
  }
  const db = activeDb ?? (await initDB())
  if (!db) {
    throw new Error('IndexedDB is not initialized. Cannot append rates chunk.')
  }

  const chunks = chunkRates(rates)
  for (const chunk of chunks) {
    await new Promise<void>((resolve, reject) => {
      beginPendingWrite()
      scheduleWrite(() => {
        let transaction: IDBTransaction
        try {
          transaction = db.transaction([RATES_STORE], 'readwrite', { durability: 'relaxed' })
        } catch (error) {
          endPendingWrite()
          reject(
            error instanceof Error
              ? error
              : new Error('IndexedDB transaction failed. Database may be unavailable.'),
          )
          return
        }
        const store = transaction.objectStore(RATES_STORE)

        chunk.forEach((rate) => {
          store.put(toStoredRate(rate))
        })

        transaction.oncomplete = () => {
          endPendingWrite()
          resolve()
        }
        transaction.onerror = () => {
          endPendingWrite()
          const message = transaction.error?.message ?? 'Failed to append rates chunk to IndexedDB'
          reject(transaction.error ?? new Error(message))
        }
        transaction.onabort = () => {
          endPendingWrite()
          reject(transaction.error ?? new Error('Rates chunk append transaction was aborted'))
        }
      })
    })
  }
}

export async function getAllRates(): Promise<Rate[]> {
  const db = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RATES_STORE, 'readonly')
    const store = transaction.objectStore(RATES_STORE)
    const request = store.getAll()

    request.onsuccess = () => {
      const rows = (request.result ?? []) as StoredRate[]
      resolve(rows.map(fromStoredRate))
    }
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to read rates from IndexedDB'))
  })
}

export async function countRates(): Promise<number> {
  const db = await initDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RATES_STORE, 'readonly')
    const store = transaction.objectStore(RATES_STORE)
    const request = store.count()

    request.onsuccess = () => resolve(request.result ?? 0)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to count rates in IndexedDB'))
  })
}

export async function* iterateRatesInChunks(batchSize = 1000): AsyncGenerator<Rate[], void, void> {
  if (batchSize <= 0) {
    throw new Error('batchSize must be greater than zero')
  }

  const db = await initDB()
  let lastKey: string | null = null

  while (true) {
    let result = await new Promise<{ rows: Rate[]; nextKey: string | null }>((resolve, reject) => {
      const transaction = db.transaction(RATES_STORE, 'readonly')
      const store = transaction.objectStore(RATES_STORE)
      const range = lastKey ? IDBKeyRange.lowerBound(lastKey, true) : undefined
      const request = store.openCursor(range)
      const rows: Rate[] = []
      let nextKey: string | null = null

      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || rows.length >= batchSize) {
          resolve({ rows, nextKey })
          return
        }

        const current = cursor.value as StoredRate
        rows.push(fromStoredRate(current))
        nextKey = current.rateKey
        cursor.continue()
      }

      request.onerror = () =>
        reject(request.error ?? new Error('Failed to stream rates from IndexedDB'))
    })

    if (result.rows.length === 0) {
      return
    }

    yield result.rows
    result.rows = []
    await new Promise((resolve) => setTimeout(resolve, 0))
    lastKey = result.nextKey
  }
}

export async function clearAllRates(): Promise<void> {
  const db = await initDB()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(RATES_STORE, 'readwrite')
    const store = transaction.objectStore(RATES_STORE)
    store.clear()

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Failed to clear rates from IndexedDB'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Rates clear transaction was aborted'))
  })
}

export async function getMetadata<T = unknown>(key: string): Promise<T | null> {
  const db = await initDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE, 'readonly')
    const store = transaction.objectStore(METADATA_STORE)
    const request = store.get(key)

    request.onsuccess = () => {
      const value = request.result as T | undefined
      resolve(value ?? null)
    }
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to read metadata key "${key}"`))
  })
}

export async function setMetadata<T>(key: string, value: T): Promise<void> {
  const db = await initDB()
  await new Promise<void>((resolve, reject) => {
    beginPendingWrite()
    scheduleWrite(() => {
      let transaction: IDBTransaction
      try {
        transaction = db.transaction([METADATA_STORE], 'readwrite', { durability: 'relaxed' })
      } catch (error) {
        endPendingWrite()
        reject(
          error instanceof Error
            ? error
            : new Error('IndexedDB metadata transaction failed. Database may be unavailable.'),
        )
        return
      }
      const store = transaction.objectStore(METADATA_STORE)
      store.put(value, key)

      transaction.oncomplete = () => {
        endPendingWrite()
        resolve()
      }
      transaction.onerror = () => {
        endPendingWrite()
        reject(transaction.error ?? new Error(`Failed to write metadata key "${key}"`))
      }
      transaction.onabort = () => {
        endPendingWrite()
        reject(transaction.error ?? new Error(`Metadata write for "${key}" was aborted`))
      }
    })
  })
}

export async function waitForSync(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (pendingWriteCount === 0) resolve()
      else setTimeout(check, 100)
    }
    check()
  })
}
