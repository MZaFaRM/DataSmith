import { useEffect, useMemo, useRef, useState } from "react"
import { invokeGetTables } from "@/api/db"
import { Icon } from "@iconify/react"

import { Input } from "@/components/ui/input"
import { DBCreds, TableEntry, UsageInfo } from "@/components/types"

interface ListTablesProps {
  dbCreds: DBCreds | null
  activeTable: string | null
  usageInfo: UsageInfo[]
  setActiveTable: (activeTable: string | null) => void
}

export default function ListTables({
  dbCreds,
  activeTable,
  setActiveTable,
  usageInfo,
}: ListTablesProps) {
  const [tableEntries, setTableEntries] = useState<TableEntry[] | null>(null)
  const [availableHeight, setAvailableHeight] = useState("")
  const [search, setSearch] = useState("")
  const [usageInfoMap, setUsageInfoMap] = useState<Record<string, UsageInfo>>(
    {}
  )

  const ref = useRef<HTMLDivElement>(null)
  const activeTableRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function updateHeight() {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.top
        setAvailableHeight(spaceBelow - 40 + "px")
      }
    }

    updateHeight()
    window.addEventListener("resize", updateHeight)
    return () => window.removeEventListener("resize", updateHeight)
  }, [])

  useEffect(() => {
    if (!dbCreds) {
      setTableEntries(null)
      setActiveTable(null)
    } else {
      fetchTables()
      // console.log("Fetching tables for:", dbCreds.name)
    }
  }, [dbCreds])

  useEffect(() => {
    if (usageInfo.length > 0) {
      const map = createUsageInfoMap()
      setUsageInfoMap(map)
    }
  }, [usageInfo])

  useEffect(() => {
    if (usageInfo.length > 0) {
      const map = createUsageInfoMap()
      setUsageInfoMap(map)
    }
  }, [])

  function createUsageInfoMap() {
    return usageInfo.reduce(
      (acc, info) => {
        acc[info.tableName] = info
        return acc
      },
      {} as Record<string, UsageInfo>
    )
  }

  async function fetchTables() {
    if (!dbCreds) {
      setTableEntries(null)
      return
    }

    try {
      const response = await invokeGetTables()
      setTableEntries(response)
    } catch (error) {
      console.error("Error fetching tables:", error)
      setTableEntries([])
    }
  }

  useEffect(() => {
    if (activeTableRef.current) {
      activeTableRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    }
  }, [activeTable])

  useEffect(() => {
    setActiveTable(tableEntries?.[0]?.["name"] || null)
  }, [tableEntries])

  const searchEntries = useMemo(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
    return tableEntries?.filter((entry) =>
      entry?.name?.toLowerCase().includes(search.toLowerCase())
    )
  }, [tableEntries, search])

  return (
    <div
      ref={ref}
      className="mr-4 flex min-w-[340px] max-w-[340px] flex-1 flex-col overflow-hidden rounded border p-4"
      style={{ height: availableHeight }}
    >
      <div className="flex h-10 w-full flex-shrink-0 items-center justify-between">
        <h2 className="text-2xl font-semibold">Tables</h2>
        <p className="text-sm font-semibold text-muted-foreground">
          Total: {tableEntries?.length || 0} Rows:{" "}
          {new Intl.NumberFormat("en", { notation: "compact" }).format(
            tableEntries?.reduce((acc, entry) => acc + entry.rows, 0) || 0
          )}
        </p>
      </div>

      <Input
        className="mt-4"
        placeholder="Search tables..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div
        className="mt-4 flex-1 space-y-4 overflow-y-auto"
        ref={scrollContainerRef}
      >
        {searchEntries && searchEntries.length !== 0 ? (
          searchEntries.map((tableEntry) => (
            <div
              key={tableEntry.name}
              ref={tableEntry.name === activeTable ? activeTableRef : undefined}
            >
              <TableCard
                entry={tableEntry}
                usageInfo={usageInfoMap[tableEntry.name] || null}
                active={tableEntry.name === activeTable}
                onClick={() => setActiveTable(tableEntry.name)}
              />
            </div>
          ))
        ) : (
          <p className="animate-pulse text-center text-sm font-semibold text-muted-foreground">
            No tables found.
          </p>
        )}
      </div>
    </div>
  )
}

interface TableCardProps {
  entry: TableEntry
  usageInfo: UsageInfo | null
  active: boolean
  onClick: () => void
}

function TableCard({ entry, usageInfo, active, onClick }: TableCardProps) {
  const { name, parents } = entry
  const [rowsCount, setRowsCount] = useState<UsageInfo>({
    tableName: name,
    totalRows: 0,
    newRows: 0,
  })

  useEffect(() => {
    if (usageInfo) {
      setRowsCount(usageInfo)
    }
  }, [usageInfo])

  useEffect(() => {
    if (usageInfo) {
      setRowsCount(usageInfo)
    }
  }, [])

  return (
    <div
      className={
        "flex w-full items-center rounded border p-4 hover:bg-accent hover:text-accent-foreground" +
        (active ? " bg-accent text-accent-foreground" : "")
      }
      onClick={onClick}
      role="button"
    >
      {rowsCount.newRows > 0 ? (
        <Icon
          icon="ri:edit-circle-fill"
          className="mr-4 h-6 w-6 text-yellow-500"
        />
      ) : (
        <Icon icon="bxs:plus-circle" className="mr-4 h-6 w-6 text-purple-500" />
      )}
      <div>
        <div className="flex w-40 items-center">
          <h3 className="truncate font-semibold tracking-wider">{name}</h3>
          {rowsCount.newRows > 0 && (
            <p className="ml-2 text-sm font-bold text-yellow-600">
              +{rowsCount.newRows}
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{parents} parent tables</p>
      </div>
      <p className="ml-auto text-sm font-semibold text-muted-foreground">
        {rowsCount.totalRows !== 1
          ? new Intl.NumberFormat("en", { notation: "compact" }).format(
            rowsCount.totalRows
          ) + " rows"
          : "1 row"}
      </p>
    </div>
  )
}
