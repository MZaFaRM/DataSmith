import { useEffect, useState } from "react"
import { Icon } from "@iconify/react"
import { invokeGetRowsConfig } from "@/api/db"
import ConnectionStatus from "@/dashboard/components/connection-status"
import InsertionPanel from "@/dashboard/components/insertion-panel"
import ListTables from "@/dashboard/components/list-tables"

import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DBCreds, UsageInfo } from "@/components/types"

const GUIDE_HIDDEN_KEY = "datasmith:guide-hidden"

const STEPS = [
  {
    label: "Configure",
    hint: "Set row count and column generators in the Insert tab",
  },
  {
    label: "Preview",
    hint: "Review the generated rows before writing anything",
  },
  {
    label: "Insert or export",
    hint: "Write rows to the database, or export them as SQL",
  },
  {
    label: "Commit database changes",
    hint: "After inserting, save the transaction",
  },
]

export default function DashboardPage() {
  const [dbCreds, setDbCreds] = useState<DBCreds | null>(null)
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [usageInfo, setUsageInfo] = useState<UsageInfo[]>([])
  const [guideHidden, setGuideHidden] = useState(
    () => localStorage.getItem(GUIDE_HIDDEN_KEY) === "1"
  )

  async function fetchUsageInfo() {
    try {
      const info = await invokeGetRowsConfig()
      setUsageInfo(info)
    } catch (error) {
      console.error("Error fetching usage info:", error)
      setUsageInfo([])
    }
  }

  function setGuide(hidden: boolean) {
    setGuideHidden(hidden)
    localStorage.setItem(GUIDE_HIDDEN_KEY, hidden ? "1" : "0")
  }

  const status = !dbCreds
    ? "Connect a database to get started."
    : !activeTable
      ? "Pick a table from the list to start generating data."
      : `Configure generators for ${activeTable}, then preview and insert.`

  return (
    <TooltipProvider>
      <div className="flex-col md:flex">
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="flex items-center justify-between gap-6 pr-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Welcome to DataSmith</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a table, prepare sample data, then review it before
                inserting or exporting.
              </p>
            </div>
            <ConnectionStatus
              dbCreds={dbCreds}
              updateDb={(val) => {
                setDbCreds(val)
                if (val) {
                  setActiveTable(null)
                  fetchUsageInfo()
                }
              }}
            />
          </div>

          {guideHidden ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
              onClick={() => setGuide(false)}
            >
              <Icon icon="lucide:list-ordered" className="mr-2 h-4 w-4" />
              Show workflow guide
            </Button>
          ) : (
            <section className="rounded-lg border bg-card px-4 py-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon icon="lucide:workflow" className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">Getting started</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {status}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setGuide(true)}
                >
                  Hide guide
                </Button>
              </div>

              <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {STEPS.map((step, index) => (
                  <li
                    key={step.label}
                    className="flex min-w-0 items-start gap-3 rounded-md border bg-muted/30 px-3 py-2.5"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground ring-1 ring-border">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{step.label}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {step.hint}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                <Icon
                  icon="lucide:terminal-square"
                  className="h-4 w-4 shrink-0"
                />
                <span className="font-medium text-foreground">Script</span>
                <span>Run sample SQL in the current transaction.</span>
              </div>
            </section>
          )}

          <div className="flex flex-row gap-4">
            <ListTables
              usageInfo={usageInfo}
              dbCreds={dbCreds}
              setActiveTable={setActiveTable}
              activeTable={activeTable}
            />
            <InsertionPanel
              dbCreds={dbCreds}
              activeTable={activeTable}
              setActiveTable={setActiveTable}
              onInserted={() => fetchUsageInfo()}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
