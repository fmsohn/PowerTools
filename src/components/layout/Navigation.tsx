type AppView = 'calculator' | 'parser'

interface NavigationProps {
  activeView: AppView
  onViewChange: (nextView: AppView) => void
}

export function Navigation({ activeView, onViewChange }: NavigationProps) {
  return (
    <nav className="mx-auto mt-6 flex w-full max-w-3xl items-center justify-center gap-4 px-4">
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
          activeView === 'parser'
            ? 'border-[#FF00FF] bg-[#100010] text-[#FF00FF] shadow-[0_0_14px_rgba(255,0,255,0.85),4px_4px_0px_0px_rgba(0,255,255,0.55)]'
            : 'border-[#00FFFF] bg-[#050505] text-[#FFFFFF] shadow-[0_0_10px_rgba(0,255,255,0.5),3px_3px_0px_0px_rgba(255,0,255,0.45)] hover:text-[#00FFFF]'
        }`}
      >
        MATRIX PARSER
      </button>
    </nav>
  )
}
