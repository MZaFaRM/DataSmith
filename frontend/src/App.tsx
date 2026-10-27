import { Menu } from "./components/custom-menu"
import { TailwindIndicator } from "./components/tailwind-indicator"
import { ThemeProvider } from "./components/theme-provider"
import DashboardPage from "./dashboard/page"
import { cn } from "./lib/utils"

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="h-screen overflow-clip">
        <Menu />
        <div
          className={cn(
            "h-screen overflow-auto border-t bg-background pb-8",
            // "scrollbar-none" 
            "scrollbar scrollbar-track-transparent scrollbar-thumb-accent scrollbar-thumb-rounded-md"
          )}
        >
          <DashboardPage />
        </div>
      </div>
      <TailwindIndicator />
    </ThemeProvider>
  )
}

export default App
