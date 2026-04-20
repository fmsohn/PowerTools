import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type NotificationTone = 'success' | 'error' | 'warning'

type NotificationItem = {
  readonly id: string
  readonly tone: NotificationTone
  readonly message: string
}

type NotificationInput = {
  readonly tone: NotificationTone
  readonly message: string
}

type NotificationContextValue = {
  readonly notify: (input: NotificationInput) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

function borderClassForTone(tone: NotificationTone): string {
  if (tone === 'success') {
    return 'border-[#00FFFF] text-cyan-100'
  }
  return 'border-[#FF00FF] text-fuchsia-100'
}

export function NotificationProvider({ children }: { readonly children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([])

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const notify = useCallback((input: NotificationInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const next: NotificationItem = { id, tone: input.tone, message: input.message }
    setItems((prev) => [...prev, next])
    window.setTimeout(() => dismiss(id), 7000)
  }, [dismiss])

  const value = useMemo<NotificationContextValue>(() => ({ notify }), [notify])

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(92vw,420px)] flex-col gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'success' ? 'status' : 'alert'}
            className={`pointer-events-auto rounded-md border-2 bg-black px-4 py-3 text-sm font-bold shadow-[4px_4px_0_0_#000] ${borderClassForTone(item.tone)}`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  )
}

export function useNotificationService(): NotificationContextValue {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotificationService must be used within NotificationProvider.')
  }
  return context
}
