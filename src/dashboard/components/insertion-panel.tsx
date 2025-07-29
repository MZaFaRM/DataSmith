import { useEffect, useRef, useState } from "react"
import { invokeDbCommit, invokeDbRollback, invokeTableData } from "@/api/db"
import {
  invokeGenPackets,
  invokeGetFakerMethods,
  invokeLoadSpec,
} from "@/api/fill"
import InsertTab from "@/dashboard/components/ui/insert-tab"
import RenderLogs from "@/dashboard/components/ui/log-tab"
import RenderPreview from "@/dashboard/components/ui/preview-tab"
import { Icon } from "@iconify/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { toast } from "@/components/ui/use-toast"
import {
  ColumnSpec,
  ColumnSpecMap,
  DBCreds,
  TableMetadata,
  TablePacket,
  TableSpec,
  TableSpecEntry,
  TableSpecMap,
} from "@/components/types"

import SqlInsertionTab from "./ui/sql-tab"

interface InsertionPanelProps {
  dbCreds: DBCreds | null
  activeTable: string | null
  setActiveTable: (activeTable: string | null) => void
  onInserted: () => void
}

export default function InsertionPanel({
  dbCreds,
  activeTable,
  setActiveTable,
  onInserted,
}: InsertionPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const insertTabRef = useRef<HTMLDivElement>(null)
  const previewTabRef = useRef<HTMLDivElement>(null)
  const logTabRef = useRef<HTMLDivElement>(null)

  const [availableHeight, setAvailableHeight] = useState("")
  const [availableWidth, setAvailableWidth] = useState("")
  const [timeOfDay, setTimeOfDay] = useState<
    "sunrise" | "sunset" | "moonrise" | "moonset"
  >("sunrise")
  const [tableData, setTableData] = useState<TableMetadata | null>(null)
  const [activeTab, setActiveTab] = useState<string>("insert")
  const [globalSpecs, setGlobalSpecs] = useState<TableSpecMap>({})
  const [tableSpec, setTableSpec] = useState<TableSpecEntry | null>(null)
  const [pendingWrites, setPendingWrites] = useState<number>(0)
  const [fakerMethods, setFakerMethods] = useState<string[] | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    getTimeOfDay()
    updateSize()
    handleTabChange(activeTab)
    window.addEventListener("resize", updateSize)
    return () => window.removeEventListener("resize", updateSize)
  }, [])

  useEffect(() => {
    if (activeTable) {
      saveToGlobal(tableSpec)
    }
    fetchActiveTableData()
    // handleTabChange("insert")
  }, [activeTable])

  useEffect(() => {
    setTableData(null)
    setTableSpec(null)
    setGlobalSpecs({})
    if (activeTable) {
      fetchActiveTableData()
    }
  }, [dbCreds])

  useEffect(() => {
    insertTabRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    })
    previewTabRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    })
    logTabRef.current?.scrollTo({
      top: logTabRef.current.scrollHeight,
      left: 0,
      behavior: "auto",
    })
  }, [activeTable, dbCreds])

  async function handleTabChange(activeTab: string) {
    setActiveTab(activeTab)
    if (activeTab === "insert") {
      if (!fakerMethods) {
        try {
          const methods = await invokeGetFakerMethods()
          setFakerMethods(methods)
        } catch (error) {
          console.error(error)
        }
      }
    }
  }

  async function fetchActiveTableData() {
    if (!activeTable) {
      setTableData(null)
      setTableSpec(null)
      return
    }
    setLoading(true)

    try {
      const table = await invokeTableData(activeTable)
      if (table) {
        loadTableSpecs(table)
        setTableData(table)
      }
    } catch (err) {
      console.error("Error fetching table data:", err)
      setTableData(null)
    } finally {
      setLoading(false)
    }
  }

  function saveToGlobal(tableSpec: TableSpecEntry | null = null) {
    // console.log("Saving table spec to global:", tableSpec)
    if (!tableSpec) return

    setGlobalSpecs((prev) => {
      return {
        ...prev,
        [tableSpec.name]: {
          ...tableSpec,
        },
      }
    })
  }

  async function loadTableSpecs(tableData: TableMetadata | null = null) {
    // console.log("Got table to load spec: ", tableData)
    if (!tableData) return

    // Step 1: Start with default
    let ts: TableSpecEntry = {
      name: tableData.name,
      noOfEntries: 50,
      columns: tableData.columns?.reduce((acc, col) => {
        acc[col.name] = {
          name: col.name,
          generator: null,
          type: null,
        }
        return acc
      }, {} as ColumnSpecMap),
    }

    // Step 2: Try global spec
    if (globalSpecs[tableData.name]) {
      // console.log("Using global spec for table:", globalSpecs[tableData.name])
      ts = globalSpecs[tableData.name]
    }

    // Step 3: Try DB spec
    else if (dbCreds?.id) {
      try {
        const spec = await invokeLoadSpec(dbCreds.id, tableData.name)
        // console.log("Loaded spec from DB:", spec)
        if (spec && Object.keys(spec).length > 0) {
          ts.noOfEntries = spec.noOfEntries
          ts.columns = spec.columns.reduce((acc, col) => {
            acc[col.name] = col
            return acc
          }, {} as ColumnSpecMap)
        }
      } catch (err) {
        console.error("Failed to load spec from DB", err)
      }
    }

    // Step 4: Fill in default type if still null
    for (const col of tableData?.columns ?? []) {
      const spec = ts.columns[col.name]
      // console.log("spec.type:", spec.name, spec.type)
      if (!spec.type) {
        if (col.foreignKeys?.table) {
          spec.type = "foreign"
        } else if (col.autoincrement) {
          spec.type = "autoincrement"
        } else if (col.computed) {
          spec.type = "computed"
        } else {
          spec.type = "faker"
        }
      }
    }

    // Step 5: Apply once at the end
    setTableSpec(ts)
  }

  function updateSize() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()

      const spaceBelow = window.innerHeight - rect.top
      setAvailableHeight(spaceBelow - 40 + "px")

      const spaceRight = window.innerWidth - rect.left
      setAvailableWidth(spaceRight - 40 + "px")
    }
  }

  function getTimeOfDay() {
    const hour = new Date().getHours()

    setTimeOfDay(() => {
      if (hour >= 5 && hour < 9) return "sunrise"
      if (hour >= 9 && hour < 18) return "sunset"
      if (hour >= 18 && hour < 21) return "moonrise"
      return "moonset"
    })
  }

  return (
    <TooltipProvider>
      <Toaster />
      <div
        ref={ref}
        className="flex flex-col"
        style={{
          height: availableHeight,
          width: availableWidth,
        }}
      >
        <div>
          {!activeTable ? (
            <>
              <div className="mb-4 flex items-center space-x-2">
                <div className="flex gap-2">
                  {[0, 300, 600, 900].map((delay, i) => (
                    <Icon
                      key={i}
                      icon="streamline-pixel:interface-essential-waiting-hourglass-loading"
                      className={`animate-fade-loop h-6 w-6 text-muted-foreground animation-delay-${delay}`}
                    />
                  ))}
                </div>
              </div>
              <p className="mb-4 text-sm font-medium text-muted-foreground">
                Select a table to continue.
              </p>
            </>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <div className="mb-2 flex items-center space-x-2">
                  <h2 className="text-2xl font-semibold tracking-wide">
                    {tableData?.name || (
                      <span>
                        Loading
                        {[0, 300, 600, 900].map((delay, i) => (
                          <span
                            key={i}
                            className={`animate-fade-loop h-6 w-6 text-muted-foreground animation-delay-${delay}`}
                          >
                            .
                          </span>
                        ))}
                      </span>
                    )}
                  </h2>
                  <Icon
                    key={activeTable}
                    icon="meteocons:smoke-particles"
                    className="h-8 w-8 text-muted-foreground"
                  />
                </div>
                <div>
                  <div className="mb-2 flex gap-2">
                    <Icon
                      icon="carbon:parent-node"
                      className="h-4 w-4 text-muted-foreground"
                    />
                    {tableData?.parents && tableData.parents.length > 0 ? (
                      tableData.parents.map((parent) => (
                        <Badge
                          key={parent}
                          variant="outline"
                          className="cursor-pointer font-medium hover:bg-muted-foreground hover:text-slate-300"
                          onClick={() => setActiveTable(parent)}
                          title="Parent Table"
                        >
                          {parent}
                        </Badge>
                      ))
                    ) : (
                      <Badge
                        variant="outline"
                        className="cursor-not-allowed bg-muted font-medium"
                      >
                        Orphan
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <HandleTransaction
                  onTransactionSuccess={onInserted}
                  pendingWrites={pendingWrites}
                  updatePendingWrites={(val) => {
                    setPendingWrites(val)
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-end">
          <div className="ml-auto flex items-center rounded text-sm font-medium">
            <TabButton
              label="Script"
              icon="gravity-ui:abbr-sql"
              isActive={activeTab === "sql"}
              onClick={() => handleTabChange("sql")}
            />
            <TabButton
              label="Log"
              icon="octicon:log-16"
              isActive={activeTab === "log"}
              onClick={() => handleTabChange("log")}
            />
            <TabButton
              label="Preview"
              icon="lucide:view"
              isActive={activeTab === "preview"}
              onClick={() => handleTabChange("preview")}
            />
            <TabButton
              label="Insert"
              icon="dashicons:insert"
              isActive={activeTab === "insert"}
              onClick={() => handleTabChange("insert")}
            />
          </div>
        </div>
        <div className="flex h-full w-full flex-col overflow-hidden rounded rounded-tr-none border">
          {tableData && tableData?.columns && tableSpec ? (
            <div className="flex h-full w-full flex-col">
              <div
                key={activeTable}
                ref={insertTabRef}
                className={cn(
                  "flex-1 overflow-auto",
                  activeTab !== "insert" && "hidden"
                )}
              >
                <InsertTab
                  fakerMethods={fakerMethods}
                  tableData={tableData}
                  tableSpec={tableSpec}
                  setTableSpec={(spec) => setTableSpec(spec)}
                />
              </div>
              <div
                ref={previewTabRef}
                className={cn(
                  activeTab !== "preview" && "hidden",
                  "flex-1 overflow-auto"
                )}
              >
                <RenderPreview
                  tableSpec={tableSpec}
                  onInserted={onInserted}
                  noOfRows={tableSpec?.noOfEntries}
                  setPendingWrites={setPendingWrites}
                />
              </div>
              <div
                ref={logTabRef}
                className={cn(
                  "relative flex h-full w-full flex-col",
                  activeTab !== "log" && "hidden"
                )}
              >
                <RenderLogs activeTab={activeTab} />
              </div>
              <div
                className={cn(
                  "relative flex h-full w-full flex-col",
                  activeTab !== "sql" && "hidden"
                )}
              >
                <SqlInsertionTab
                  onSuccess={() => {
                    fetchActiveTableData()
                    onInserted()
                  }}
                />
              </div>
            </div>
          ) : !dbCreds || (dbCreds && !loading) ? (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Icon
                icon={`meteocons:${timeOfDay}-fill`}
                className="margin-auto h-16 w-16"
              />
              <p className="ml-1 text-sm font-medium">Start by connecting to a database.</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-muted">
              <Icon
                icon="fontisto:spinner-fidget"
                className="h-4 w-4 animate-spin text-muted-foreground"
              />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

function TabButton({
  label,
  icon,
  isActive,
  onClick,
}: {
  label: string
  icon: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        "w-32 cursor-pointer rounded rounded-b-none px-4 py-2 text-center",
        isActive ? "border border-b-0 bg-muted" : "opacity-50"
      )}
      onClick={onClick}
    >
      <div className="inline-flex items-center">
        <Icon icon={icon} className="h-4 w-4" />
        <p className="ml-2">{label}</p>
      </div>
    </div>
  )
}

function HandleTransaction({
  pendingWrites,
  updatePendingWrites,
  onTransactionSuccess,
}: {
  pendingWrites: number
  updatePendingWrites: (count: number) => void
  onTransactionSuccess: () => void
}) {
  const [showCheck, setShowCheck] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // console.log("writes:", pendingWrites)
  }, [pendingWrites])

  function handleCommit() {
    setLoading(true)
    invokeDbCommit()
      .then(() => {
        setShowCheck(true)
        onTransactionSuccess()
        setTimeout(() => {
          setShowCheck(false)
        }, 2000)
        updatePendingWrites(0)
      })
      .catch((error) => {
        console.error("Commit failed:", error)
        toast({
          title: "Commit Failed",
          description: "There was an error committing your changes.",
          variant: "destructive",
        })
      })
      .finally(() => {
        setLoading(false)
      })
  }

  function handleRollback() {
    setLoading(true)
    invokeDbRollback()
      .then(() => {
        setShowCheck(true)
        onTransactionSuccess()
        setTimeout(() => {
          setShowCheck(false)
        }, 2000)

        updatePendingWrites(0)
      })
      .catch((error) => {
        console.error("Rollback failed:", error)
        toast({
          title: "Rollback Failed",
          description: "There was an error rolling back your changes.",
          variant: "destructive",
        })
      })
      .finally(() => {
        setLoading(false)
      })
  }

  return (
    <div className="flex items-center gap-2">
      {showCheck && (
        <Icon
          icon="lets-icons:check-fill"
          className="mr-4 h-6 w-6 animate-fade-in-out-once text-green-500"
        />
      )}
      {pendingWrites > 0 && (
        <div className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-muted-foreground">
          <Icon icon="jam:alert" className="h-4 w-4 text-yellow-500" />
          <p>{pendingWrites} Pending Writes</p>
        </div>
      )}
      <button
        className="inline-flex items-center space-x-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        onClick={handleCommit}
      >
        <Icon icon="ion:git-commit-sharp" className="h-4 w-4 text-violet-500" />
        <span>Commit</span>
      </button>

      <button
        className="inline-flex items-center space-x-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        onClick={handleRollback}
      >
        <Icon
          icon="solar:rewind-back-bold-duotone"
          className="h-4 w-4 text-amber-500"
        />
        <span>Rollback</span>
      </button>
    </div>
  )
}
