import { useEffect, useRef, useState } from "react"
import { invokeGetSqlBanner, invokeRunSql } from "@/api/db"
import { set } from "date-fns"

import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/use-toast"
import { SqlLog } from "@/components/types"

export default function SqlInsertionTab({
  onSuccess,
}: {
  onSuccess: () => void
}) {
  const [sqlLog, setSqlLog] = useState<SqlLog>({ log: [], prompt: "" })
  const [queryHistory, setQueryHistory] = useState<string[]>([])
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState<string>("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    invokeGetSqlBanner().then((log) => {
      setSqlLog(log)
    })
  }, [])

  useEffect(() => {
    scrollDown()
  }, [sqlLog.log])

  async function clearLogs() {
    setSqlLog((prev) => ({ ...prev, log: [] }))
  }

  async function newLine(rawQuery: string) {
    // if (loading) return
    setQuery(rawQuery)
    if (
      rawQuery.endsWith(";\n") ||
      (rawQuery.endsWith("\n") && rawQuery.trim() === "")
    ) {
      setQuery(rawQuery.slice(0, -1))
      setQueryHistory((prev) => {
        return [...prev, rawQuery.slice(0, -1)]
      })

      if (rawQuery.match(/^\s*clear\s*;?\s*$/)) {
        await clearLogs()
        setQuery("")
        return
      }

      const lines = rawQuery.trim().split("\n")
      const formattedLines = lines.map(
        (line, index) =>
          (index === 0
            ? sqlLog.prompt + "> "
            : " ".repeat(sqlLog.prompt.length) + "> ") + line
      )

      let output: string[] = []

      if (rawQuery.trim() !== "") {
        // console.log("query:", rawQuery.trim())
        output = await runSql(rawQuery.trim())
      }

      setSqlLog((prev) => ({
        ...prev,
        log: [...prev.log, ...formattedLines, ...output].slice(-200),
      }))
      setQuery("")
    }
  }

  function scrollDown() {
    if (ref.current) {
      ref.current.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      })
    }
  }
  function handleKeyInput(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault()
      const newIndex = Math.min(
        currentHistoryIndex + 1,
        queryHistory.length - 1
      )
      setCurrentHistoryIndex(newIndex)
      setQuery(queryHistory[queryHistory.length - 1 - newIndex] || "")
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const newIndex = Math.max(currentHistoryIndex - 1, -1)
      setCurrentHistoryIndex(newIndex)
      setQuery(
        newIndex === -1 ? "" : queryHistory[queryHistory.length - 1 - newIndex]
      )
    } else if (e.key === "Enter") {
      setCurrentHistoryIndex(-1)
    }
  }

  async function runSql(query: string): Promise<string[]> {
    try {
      setLoading(true)
      const resLog = await invokeRunSql(query)
      onSuccess()
      // console.log("SQL Execution Result:", resLog)
      return resLog
    } catch (error: any) {
      console.error("Error executing SQL:", error)
      toast({
        variant: "destructive",
        title: "SQL execution error",
        description: error.message,
      })
      return []
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex h-full overflow-auto", loading && "animate-pulse")} ref={ref}>
      <div className="mx-4 mt-4">
        {sqlLog.log.map((log, index) => (
          <pre
            key={index}
            className={cn("whitespace-pre-wrap font-mono text-sm text-current")}
          >
            {log || <br />}
          </pre>
        ))}
        <div className="m-0 flex pl-0 font-mono text-sm text-current">
          <div className="w-19 select-none pr-2">
            {query.split("\n").map((_, i) => (
              <pre key={i}>
                {i === 0 ? sqlLog.prompt : " ".repeat(sqlLog.prompt.length)}
                {">"}
              </pre>
            ))}
          </div>

          <textarea
            rows={1}
            value={query}
            disabled={loading}
            onChange={(e) => newLine(e.target.value)}
            onInput={(e) => {
              e.currentTarget.style.height = "auto"
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              handleKeyInput(e)
            }}
            className="w-full resize-none overflow-hidden bg-transparent font-mono text-sm focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}
