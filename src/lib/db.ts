import type { Rate } from '../types/market-data'
import { rateMergeKey } from '../types/market-data'

const DB_NAME = 'PowerToolsDB'
const DB_VERSION = 3
const RATES_STORE = 'rates'

type StoredRate = Rate & { readonly rateKey: string }

let dbPromise: Promise<IDBDatabase> | null = null

function toStoredRate(rate: Rate): StoredRate {
  return { ...rate, rateKey: rateMergeKey(rate) }
}

function fromStoredRate(row: StoredRate): Rate {
  const { rateKey: _rateKey, ...rate } = row
  return rate
}

export function initDB(): Promise<IDBDatabase> {
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
        return
      }

      if (oldVersion < 3) {
        db.deleteObjectStore(RATES_STORE)
        const store = db.createObjectStore(RATES_STORE, { keyPath: 'rateKey' })
        store.createIndex('effectiveDate', 'effectiveDate', { unique: false })
        console.log('✅ Database Upgrade v3: recreated rates store with rateKey + effectiveDate index')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })

  return dbPromise
}

export async function saveRatesToDisk(rates: Rate[]): Promise<void> {
  const db = await initDB()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(RATES_STORE, 'readwrite')
    const store = transaction.objectStore(RATES_STORE)

    rates.forEach((rate) => {
      store.put(toStoredRate(rate))
    })

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Failed to persist rates to IndexedDB'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Rates persistence transaction was aborted'))
  })

  console.log(`✅ Persisted ${rates.length} rates to IndexedDB`)
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
