import { useEffect, useRef, useState } from "react"
import {
  invokeClearGenPackets,
  invokeExportSqlPacket,
  invokeGenPackets,
  invokeGetGenPacket,
  invokeGetGenResult,
  invokeInsertSqlPacket,
} from "@/api/fill"
import { Icon } from "@iconify/react"
import { save } from "@tauri-apps/plugin-dialog"
import { set } from "date-fns"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import {
  ColumnSpec,
  PacketProgress,
  TablePacket,
  TableSpec,
  TableSpecEntry,
} from "@/components/types"
import { clear } from "console"

interface RenderPreviewProps {
  tableSpec: TableSpecEntry | null
  onInserted: () => void
  setPendingWrites: (n: number) => void
  noOfRows: number | null
}

export default function RenderPreview({
  tableSpec,
  onInserted,
  noOfRows,
  setPendingWrites,
}: RenderPreviewProps) {
  const [errorCols, setErrorCols] = useState<Record<string, string>>({})
  const [warnCols, setWarningCols] = useState<Record<string, string>>({})
  const [showCheck, setShowCheck] = useState<boolean>(false)
  const [tablePacket, setTablePacket] = useState<TablePacket | null>(null)
  const [needsRefresh, setNeedsRefresh] = useState<boolean>(true)
  const [previewLoading, setPreviewLoading] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [page, setPage] = useState<number>(0)
  const [progress, setProgress] = useState<PacketProgress | null>(null)
  const [noOfRowsInput, setNoOfRowsInput] = useState<number | null>(noOfRows || 1)

  useEffect(() => {
    setNeedsRefresh(true)
  }, [tableSpec])

  useEffect(() => {
    setTablePacket(null)
    handleClearGenPackets()
  }, [tableSpec?.name])

  useEffect(() => {
    if (tablePacket) {
      const errCol: Record<string, string> = {}
      const warnCol: Record<string, string> = {}
      setPage(tablePacket.page || 0)

      if (!tablePacket.errors) return

      tablePacket.errors.forEach((error) => {
        if (error.column) {
          const msg = `${error.column}: ${error.msg ?? "Unknown"}`
          if (error.type === "error") {
            errCol[error.column] = msg
          } else if (error.type === "warning") {
            warnCol[error.column] = msg
          }
        }
      })

      setErrorCols(errCol)
      setWarningCols(warnCol)

      if (Object.keys(warnCol).length > 0) {
        toast({
          variant: "warning",
          title: "Warnings found",
          description: (
            <pre className="whitespace-pre-wrap">
              {Object.values(warnCol).join("\n")}
            </pre>
          ),
        })
      }
      if (Object.keys(errCol).length > 0) {
        toast({
          variant: "destructive",
          title: "Errors found",
          description: (
            <pre className="whitespace-pre-wrap">
              {Object.values(errCol).join("\n")}
            </pre>
          ),
        })
      }
    }
  }, [tablePacket?.errors])

  useEffect(() => {
    if (!pendingJobId) return
    setPreviewLoading(true)

    const interval = setInterval(() => {
      invokeGetGenResult(pendingJobId)
        .then((result) => {
          if (result.status === "done" && result.data) {
            setTablePacket(result.data)
            clearInterval(interval)
            setPreviewLoading(false)
            setPendingJobId(null)
            setProgress(null)
            clearSamples()
          } else {
            setProgress({
              ...result.progress,
              eta: calculateEta(
                result.progress.row,
                result.progress.total
              ),
            })
          }
        })
        .catch((error) => {
          console.error("Error fetching generation result:", error)
          setPreviewLoading(false)
          clearInterval(interval)
          setPendingJobId(null)
          clearSamples()
        })
    }, 500)

    return () => clearInterval(interval)
  }, [pendingJobId])

  type Sample = {
    row: number
    time: number
  }

  const samples = useRef<Sample[]>([])
  const worstRate = useRef<number | null>(null)

  function clearSamples() {
    samples.current = []
    worstRate.current = null
  }

  function calculateEta(row: number, total: number): string | null {
    const now = Date.now()
    if (!total || row <= 0 || row >= total) {
      samples.current = [{ row, time: now }]
      worstRate.current = null
      return null
    }

    samples.current.push({ row, time: now })
    if (samples.current.length > 20) samples.current.shift()

    const rates: number[] = []
    for (let i = 1; i < samples.current.length; i++) {
      const deltaR = samples.current[i].row - samples.current[i - 1].row
      const deltaT = samples.current[i].time - samples.current[i - 1].time
      if (deltaR > 0 && deltaT > 0) {
        rates.push(deltaT / deltaR)
      }
    }

    if (rates.length < 3) return null

    const avg = rates.reduce((a, b) => a + b, 0) / rates.length
    const slowest = Math.max(...rates)
    worstRate.current = worstRate.current
      ? Math.max(worstRate.current, slowest)
      : slowest

    // Confidence increases as more rows processed
    const confidence = Math.min(Math.pow(row / total, 1.9), 0.8)
    const exaggeratedWorst = worstRate.current! * 1.9

    // Start harsh, then blend towards avg
    const blendedRate =
      (1 - confidence) * exaggeratedWorst + confidence * avg

    const remaining = total - row
    const etaMs = blendedRate * remaining
    const seconds = Math.floor(etaMs / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60

    return mins > 0
      ? `${mins} minute${mins !== 1 ? "s" : ""} ${secs} second${secs !== 1 ? "s" : ""} remaining`
      : `${secs} second${secs !== 1 ? "s" : ""} remaining`
  }



  function handleInsertPacket() {
    if (!tablePacket) return
    setLoading(true)
    invokeInsertSqlPacket(tablePacket.id)
      .then((res) => {
        setShowCheck(true)
        onInserted()
        setPendingWrites(res.pendingWrites)
        setTimeout(() => {
          setShowCheck(false)
        }, 2000)
      })
      .catch((err) => {
        toast({
          variant: "destructive",
          title: "Error inserting data",
          description: err.message
            ? err.message.slice(0, 250)
            : "Unknown error occurred",
        })
      })
      .finally(() => {
        setLoading(false)
      })
  }

  async function handleClearGenPackets() {
    try {
      clearSamples()
      invokeClearGenPackets()
    } catch (error) {
      console.error("Error clearing packets", error)
    }
  }

  async function HandleGenerateTablePackets(
    tSpec: TableSpecEntry | null = null,
    rows: number | null = null
  ) {
    const specEntry = tSpec || tableSpec
    if (!specEntry) return

    const newTableSpec: TableSpec = {
      name: specEntry.name,
      noOfEntries: noOfRowsInput || rows || specEntry.noOfEntries || 25,
      pageSize: 250,
      columns: Object.values(specEntry?.columns ?? []) as ColumnSpec[],
    }
    try {
      const res = await invokeGenPackets(newTableSpec)
      setPendingJobId(res.jobId)
      setProgress(res)
      setNeedsRefresh(false)
      // console.log("Generation started with job ID:", res.jobId)
    } catch (error) {
      console.error("Error verifying spec:", error)
    }
  }

  async function handleSaveToFile() {
    if (!tablePacket) return

    const fileName = `${tablePacket?.name || "unnamed_table"
      }_${new Date().toISOString().replace(/[:.]/g, "-")}.sql`

    const filePath = await save({
      defaultPath: fileName,
      filters: [
        {
          name: "SQL File",
          extensions: ["sql"],
        },
      ],
    })
    if (filePath) {
      try {
        await invokeExportSqlPacket(tablePacket.id, filePath)
        setShowCheck(true)
        setTimeout(() => {
          setShowCheck(false)
        }, 2000)
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error exporting SQL",
          description: (error as Error).message || "Unknown error occurred",
        })
      }
    }
  }

  async function getNewPacket(page: number | string, packetId: string) {
    if (!tablePacket) return
    setPreviewLoading(true)
    try {
      let value = Number(page)
      if (value < 0) {
        value = 0
      } else if (value >= (tablePacket?.totalPages || 1)) {
        value = (tablePacket?.totalPages || 1) - 1
      }
      setPage(value)
      const newPacket = await invokeGetGenPacket(packetId, value)
      // console.log("New packet page:", newPacket.page)
      setTablePacket(newPacket)
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error fetching new packet",
        description: (error as Error).message || "Unknown error occurred",
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-auto",
        (previewLoading || loading) && "cursor-wait"
      )}
    >
      <div
        className={cn(
          "bg-current-foreground flex h-full flex-col items-center justify-center rounded-md bg-gradient-to-br text-gray-800",
          !previewLoading && !loading && "hidden"
        )}
      >
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
        <p className="text-base font-medium tracking-wide text-foreground">
          {previewLoading ? "Generating preview..." : loading && "Processing your request..."}
        </p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {previewLoading ? "Hang tight. This may take a while." : loading && "Hang tight. This may take a few seconds."}
        </p>
        {previewLoading &&
          <div className="w-full max-w-lg">
            <div className="mt-4 flex w-full justify-between space-x-2 text-foreground">
              <p className="text-sm font-semibold">{progress?.status + "..."}</p>
              <p className="text-sm font-semibold text-muted-foreground">
                {progress?.column}
              </p>
            </div>

            <div className="mt-4 w-full max-w-lg">
              <Progress
                value={((progress?.row ?? 0) / (progress?.total ?? 1)) * 100}
              />
            </div>
            <p className="font-regular mt-2 w-full text-center text-sm text-muted-foreground">
              {progress?.eta ? progress.eta : "Calculating ETA..."}
            </p>
          </div>
        }
      </div>
      <div className={cn("flex-1 overflow-auto", previewLoading && "hidden")}>
        <Table key={tableSpec?.name || "unknown"}>
          <TableHeader>
            {tablePacket && (tablePacket?.columns?.length ?? 0) > 0 ? (
              <TableRow>
                {tablePacket.columns!.map((column) => (
                  <TableHead
                    title={
                      (errorCols && errorCols[column]) ||
                      (warnCols && warnCols[column])
                    }
                    key={column}
                    className={cn(
                      "bg-purple-400 text-center text-black",
                      warnCols[column] && "bg-yellow-400",
                      errorCols[column] && "bg-red-400"
                    )}
                  >
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            ) : (
              tableSpec && (
                <TableRow>
                  {Object.keys(tableSpec.columns).map((colName) => (
                    <TableHead
                      key={colName}
                      className="bg-purple-400 text-center text-black"
                    >
                      {colName}
                    </TableHead>
                  ))}
                </TableRow>
              )
            )}
          </TableHeader>
          <TableBody>
            {tablePacket &&
              (tablePacket?.columns?.length ?? 0) > 0 &&
              (() => {
                const columns = tablePacket.columns ?? []
                const entries = tablePacket.entries ?? []
                const rowCount = entries.length
                const colCount = entries[0]?.length || 0
                const name = tablePacket.name

                return Array.from({ length: rowCount }).map((_, rowIndex) => (
                  <TableRow key={`${name}.${rowIndex}`}>
                    {Array.from({ length: colCount }).map((_, colIndex) => {
                      const columnName = columns[colIndex]

                      return (
                        <TableCell
                          key={`${name}.${colIndex}.${rowIndex}`}
                          className={cn(
                            "w-[50px] whitespace-nowrap text-center",
                            warnCols[columnName] && "bg-yellow-100/25",
                            errorCols[columnName] && "bg-red-100/25"
                          )}
                        >
                          <div className="max-w-full">
                            {entries[rowIndex][colIndex] !== null
                              ? entries[rowIndex][colIndex]
                              : "NULL"}
                          </div>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))
              })()}
          </TableBody>
        </Table>
        {(tablePacket?.entries.length ?? 0) == 0 && (
          <div className="flex h-3/4 items-center justify-center text-muted-foreground">
            <p className="text-sm font-medium">
              Configure column specifications from <span className="bg-muted p-1 rounded border">Insert</span> tab
              and click on <span className="bg-muted p-1 rounded border">Generate</span> to preview data.
            </p>
          </div>
        )}
      </div>
      <div className="sticky bottom-0 mt-auto flex items-center justify-center bg-muted p-2">
        <div>
          {previewLoading ? (
            <button
              onClick={handleClearGenPackets}
              className={cn(
                "inline-flex items-center space-x-2 rounded-md border px-3 py-2 text-sm",
                "font-medium hover:bg-accent hover:text-red-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "w-28 bg-red-500 text-white"
              )}
            >
              <Icon icon="la:skull-crossbones" className="mr-4 h-4 w-4" />
              Cancel
            </button>
          ) : (
            <button
              className={cn(
                "inline-flex items-center space-x-2 rounded-md border px-3 py-2 text-sm",
                "font-medium hover:bg-accent hover:text-accent-foreground",
                "w-28 disabled:cursor-not-allowed disabled:opacity-50",
                needsRefresh && "bg-purple-500 text-white"
              )}
              onClick={() => {
                HandleGenerateTablePackets()
              }}
            >
              <Icon
                icon="streamline-ultimate:factory-industrial-robot-arm-1-bold"
                className={cn("h-4 w-4", !needsRefresh && "text-purple-500")}
              />
              <span>Generate</span>
            </button>
          )}
        </div>
        <div>
          <div
            className={cn(
              "inline-flex items-center space-x-2 rounded-md border px-3 py-2",
              "text-sm font-medium hover:bg-accent hover:text-accent-foreground",
              "ml-4"
            )}
          >
            <Icon
              icon="material-symbols:add-row-below"
              className={cn("h-4 w-4 text-foreground")}
            />
            <input
              type="number"
              max={99_999}
              min={1}
              value={noOfRowsInput ?? noOfRows ?? 0}
              onChange={(e) =>
                setNoOfRowsInput(e.target.value ? Number(e.target.value) : NaN)
              }
              onBlur={(e) => {
                let value = Number(e.target.value)
                if (value === 0) {
                  value += 1
                } else if (value >= 99_999) {
                  value = 99_999
                }
                setNoOfRowsInput(value)
                setNeedsRefresh(true)
              }}
            />
            <span> Rows</span>
          </div>
        </div>
        <div className="ml-auto">
          <div className="flex flex-row items-center space-x-2">
            <button
              disabled={page <= 0}
              onClick={() => getNewPacket(page - 1, tablePacket?.id || "")}
              className="disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon
                icon="streamline:move-left-solid"
                className="mr-1 h-5 w-5 text-purple-500"
              />
            </button>
            <span className="text-muted-foreground">
              {(tablePacket?.totalPages || 1) - 1} /
            </span>
            <input
              type="number"
              max={tablePacket?.totalPages || 99}
              min={0}
              value={page ?? 0}
              onChange={(e) =>
                setPage(e.target.value ? Number(e.target.value) : NaN)
              }
              onBlur={(e) => {
                getNewPacket(e.target.value, tablePacket?.id || "")
              }}
            />
            <button
              disabled={page >= (tablePacket?.totalPages || 1) - 1}
              onClick={() => getNewPacket(page + 1, tablePacket?.id || "")}
              className="disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon
                icon="streamline:move-right-solid"
                className="ml-1 h-5 w-5 text-purple-500"
              />
            </button>
          </div>
        </div>
        <div className="ml-auto">
          <div className="flex items-center space-x-2">
            {showCheck && (
              <Icon
                icon="lets-icons:check-fill"
                className="mr-4 h-6 w-6 animate-fade-in-out-once text-green-500"
              />
            )}
            {errorCols && Object.keys(errorCols).length > 0 ? (
              <Icon icon="jam:alert" className="h-5 w-5 text-red-500" />
            ) : warnCols && Object.keys(warnCols).length > 0 ? (
              <Icon icon="jam:alert" className="h-5 w-5 text-yellow-500" />
            ) : null}
            <div className="inline-flex overflow-hidden rounded-md border bg-purple-500 text-white">
              <button
                onClick={handleInsertPacket}
                disabled={!tablePacket || previewLoading || loading}
                className={cn(
                  "flex w-[145px] items-center px-3 py-2",
                  "text-sm font-medium hover:bg-purple-600",
                  previewLoading && "cursor-wait opacity-50",
                  !tablePacket && "cursor-not-allowed opacity-50"
                )}
              >
                <Icon icon="proicons:database-add" className="mr-2 h-4 w-4" />
                Insert into DB
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center border-l px-2 py-2 hover:bg-purple-600"
                    onClick={(e) => e.preventDefault()}
                  >
                    <Icon icon="mdi:chevron-down" className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  style={{ marginLeft: "-146px", width: "180px" }}
                >
                  <DropdownMenuItem
                    onSelect={handleSaveToFile}
                    disabled={!tablePacket || previewLoading}
                  >
                    <Icon icon="mdi:file-export" className="mr-4 h-4 w-4" />
                    Export SQL
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
