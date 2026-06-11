import { useSimStore } from "./store/useSimStore"
import SetupScreen from "./ui/SetupScreen"
import SimScreen from "./ui/SimScreen"
import EndScreen from "./ui/EndScreen"

export default function App() {
  const phase = useSimStore((s) => s.state.phase)

  if (phase === "setup") return <SetupScreen />
  if (phase === "ended") return <EndScreen />
  return <SimScreen />
}
