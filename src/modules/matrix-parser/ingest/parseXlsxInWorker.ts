import type {
  XlsxIngestPayload,
  XlsxIngestRequest,
  XlsxIngestResponse,
} from '../workers/xlsxIngest.worker'

export type ParseXlsxSuccess = {
  readonly ok: true
  readonly payload: XlsxIngestPayload
}

export type ParseXlsxResult = ParseXlsxSuccess

export function parseXlsxInWorker(
  buffer: ArrayBuffer,
  targetSheets: readonly string[],
): Promise<ParseXlsxResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/xlsxIngest.worker.ts', import.meta.url), {
      type: 'module',
    })
    const onMessage = (ev: MessageEvent<XlsxIngestResponse>) => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.terminate()
      const msg = ev.data
      if (msg.kind === 'error') {
        reject(new Error(msg.message))
        return
      }
      resolve({ ok: true, payload: msg.payload })
    }
    const onError = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.terminate()
      reject(new Error('Excel worker failed to start'))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ kind: 'parse', buffer, targetSheets } satisfies XlsxIngestRequest, [buffer])
  })
}
