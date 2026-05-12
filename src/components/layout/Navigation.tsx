type AppView = 'calculator' | 'parser' | 'comparison'

interface NavigationProps {
  activeView: AppView
  onViewChange: (nextView: AppView) => void
  onSettingsOpen: () => void
  isPersistenceSyncing: boolean
}

export function Navigation({
  activeView,
  onViewChange,
  onSettingsOpen,
  isPersistenceSyncing,
}: NavigationProps) {
  const isParserMode = activeView === 'parser' || activeView === 'comparison'

  return (
    <nav className="mx-auto mt-6 flex w-full max-w-4xl flex-wrap items-center justify-center gap-4 px-4">
      <button
        type="button"
        onClick={() => onViewChange('calculator')}
        className={`min-h-[44px] border-2 px-6 py-3 text-sm font-semibold tracking-[0.2em] transition-all duration-150 ${
          activeView === 'calculator'
            ? 'border-[#00FFFF] bg-[#001010] text-[#00FFFF] shadow-[0_0_14px_rgba(0,255,255,0.85),4px_4px_0px_0px_rgba(255,0,255,0.55)]'
            : 'border-[#FF00FF] bg-[#050505] text-[#FFFFFF] shadow-[0_0_10px_rgba(255,0,255,0.5),3px_3px_0px_0px_rgba(0,255,255,0.45)] hover:text-[#FF00FF]'
        }`}
      >
        CALCULATOR
      </button>
      <button
        type="button"
        onClick={() => onViewChange('parser')}
        className={`min-h-[44px] border-2 px-6 py-3 text-sm font-semibold tracking-[0.2em] transition-all duration-150 ${
          isParserMode
            ? 'border-[#FF00FF] bg-[#100010] text-[#FF00FF] shadow-[0_0_14px_rgba(255,0,255,0.85),4px_4px_0px_0px_rgba(0,255,255,0.55)]'
            : 'border-[#00FFFF] bg-[#050505] text-[#FFFFFF] shadow-[0_0_10px_rgba(0,255,255,0.5),3px_3px_0px_0px_rgba(255,0,255,0.45)] hover:text-[#00FFFF]'
        }`}
      >
        MATRIX PARSER
      </button>
      <button
        type="button"
        onClick={onSettingsOpen}
        aria-label="Open settings"
        className="min-h-[44px] min-w-[44px] border-2 border-cyan-500/50 bg-black/80 px-3 text-cyan-200 shadow-[0_0_15px_rgba(0,255,255,0.2)] transition hover:bg-cyan-500/10"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
          <path d="m3 13.5 1.4.2a7.8 7.8 0 0 0 .8 2l-.9 1.1a1 1 0 0 0 .1 1.3l1.3 1.3a1 1 0 0 0 1.3.1l1.1-.9c.6.3 1.3.6 2 .8L10.5 21a1 1 0 0 0 1 .9h1.9a1 1 0 0 0 1-.9l.2-1.4a7.8 7.8 0 0 0 2-.8l1.1.9a1 1 0 0 0 1.3-.1l1.3-1.3a1 1 0 0 0 .1-1.3l-.9-1.1c.3-.6.6-1.3.8-2l1.4-.2a1 1 0 0 0 .9-1v-1.9a1 1 0 0 0-.9-1l-1.4-.2a7.8 7.8 0 0 0-.8-2l.9-1.1a1 1 0 0 0-.1-1.3L19.1 4a1 1 0 0 0-1.3-.1l-1.1.9a7.8 7.8 0 0 0-2-.8L14.5 2.6a1 1 0 0 0-1-.9h-1.9a1 1 0 0 0-1 .9L10.4 4a7.8 7.8 0 0 0-2 .8L7.3 3.9A1 1 0 0 0 6 4L4.7 5.3a1 1 0 0 0-.1 1.3l.9 1.1c-.3.6-.6 1.3-.8 2L3.3 10a1 1 0 0 0-.9 1v1.9a1 1 0 0 0 .6.6Z" />
        </svg>
      </button>
      <div className="min-h-[44px] min-w-[220px] border-2 border-cyan-500/50 bg-black/80 px-4 py-2 text-xs font-semibold tracking-[0.12em] text-cyan-100 shadow-[0_0_12px_rgba(0,255,255,0.25)]">
        {isPersistenceSyncing ? '💾 Syncing to Disk...' : '✅ Saved'}
      </div>
    </nav>
  )
}
