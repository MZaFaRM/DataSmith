import { useEffect, useState } from "react"
import { invokeGetRowsConfig } from "@/api/db"
import ConnectionStatus from "@/dashboard/components/connection-status"
import InsertionPanel from "@/dashboard/components/insertion-panel"
import ListTables from "@/dashboard/components/list-tables"

import { TooltipProvider } from "@/components/ui/tooltip"
import { DBCreds, UsageInfo } from "@/components/types"

export default function DashboardPage() {
  const [dbCreds, setDbCreds] = useState<DBCreds | null>(null)
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [usageInfo, setUsageInfo] = useState<UsageInfo[]>([])

  async function fetchUsageInfo() {
    try {
      const info = await invokeGetRowsConfig()
      setUsageInfo(info)
    } catch (error) {
      console.error("Error fetching usage info:", error)
      setUsageInfo([])
    }
  }

  return (
    <TooltipProvider>
      <div className="flex-col md:flex">
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="flex items-center justify-between space-y-2 pr-2">
            <div>
              <div className="flex items-center">
                <h2 className="text-lg font-semibold">Welcome to DataSmith!</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Generate realistic sample data and preview it before inserting.
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
          <div className="flex flex-row space-y-4">
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
