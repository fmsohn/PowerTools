import { CommissionEstimator } from './modules/commission-calc'

function App() {
  return (
    <div className="app-shell bg-[#000000] text-[#FFFFFF]">
      <main className="flex flex-1 flex-col items-center">
        <CommissionEstimator />
      </main>
    </div>
  )
}

export default App
