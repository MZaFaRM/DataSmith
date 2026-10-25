import { SetStateAction, useEffect, useState } from "react"
import { invokeGetFakerMethods } from "@/api/fill"
import { python } from "@codemirror/lang-python"
import { sql } from "@codemirror/lang-sql"
import { Icon } from "@iconify/react"
import { CaretSortIcon, CheckIcon } from "@radix-ui/react-icons"
import { githubDark, githubLight } from "@uiw/codemirror-theme-github"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import {
  ColumnData,
  ColumnSpec,
  GeneratorType,
  TableMetadata,
  TableSpecEntry,
} from "@/components/types"

type AiMode = "autofill" | "sample" | null

interface GeneratorSuggestion {
  column: ColumnData
  type: GeneratorType
  generator: string | null
  reason: string
}

interface InsertTabProps {
  fakerMethods: string[] | null
  tableData: TableMetadata
  tableSpec: TableSpecEntry | null
  setTableSpec: (data: SetStateAction<TableSpecEntry | null>) => void
}

export default function InsertTab({
  fakerMethods,
  tableData,
  tableSpec,
  setTableSpec,
}: InsertTabProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string[] | null>(null)
  const [aiMode, setAiMode] = useState<AiMode>(null)
  const [sampleData, setSampleData] = useState("")
  const [suggestions, setSuggestions] = useState<GeneratorSuggestion[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  function startAutoFill() {
    setSuggestions(buildSuggestions(tableData.columns, fakerMethods))
    setAiMode("autofill")
  }

  function startSampleFlow() {
    setSuggestions([])
    setAiMode("sample")
  }

  function analyzeSample() {
    setIsAnalyzing(true)
    window.setTimeout(() => {
      const headers = readSampleHeaders(sampleData)
      setSuggestions(buildSuggestions(tableData.columns, fakerMethods, headers))
      setIsAnalyzing(false)
    }, 650)
  }

  function applySuggestions() {
    setTableSpec((previous) => {
      if (!previous) return previous
      const columns = { ...previous.columns }
      for (const suggestion of suggestions) {
        columns[suggestion.column.name] = {
          name: suggestion.column.name,
          type: suggestion.type,
          generator: suggestion.generator,
        }
      }
      return { ...previous, columns }
    })
    setAiMode(null)
    setSampleData("")
  }

  return (
    <div className="flex h-full w-full flex-col overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-background text-primary">
            <Icon icon="lucide:sparkles" className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium">AI data setup</p>
            <p className="text-xs text-muted-foreground">
              Build a generator plan for this table
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={startAutoFill}>
            <Icon icon="lucide:sparkles" className="mr-2 h-4 w-4" />
            Auto-fill with AI
          </Button>
          <Button size="sm" onClick={startSampleFlow}>
            <Icon icon="lucide:table-2" className="mr-2 h-4 w-4" />
            Generate from sample data
          </Button>
        </div>
      </div>
      <Table className="w-full flex-1">
        <TableBody>
          {tableData?.columns?.map((column) => (
            <InsertTabRows
              key={`${tableData.name}-${column.name}`}
              column={column}
              columnSpec={(tableSpec?.columns[column.name] as ColumnSpec) ?? {}}
              setColumnSpec={(newSpec) =>
                setTableSpec((prev) => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    columns: {
                      ...prev?.columns,
                      [column.name]: newSpec,
                    },
                  }
                })
              }
              fakerMethods={fakerMethods}
              hoveredGroup={hoveredGroup}
              setHoveredGroup={setHoveredGroup}
            />
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={aiMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAiMode(null)
            setIsAnalyzing(false)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon icon="lucide:sparkles" className="h-5 w-5 text-primary" />
              {aiMode === "sample"
                ? suggestions.length
                  ? "Review sample-based suggestions"
                  : "Generate from sample data"
                : "Suggested generator plan"}
            </DialogTitle>
            <DialogDescription>
              {aiMode === "sample"
                ? suggestions.length
                  ? `Matched your sample structure to ${suggestions.length} columns. Review the proposed generators before applying.`
                  : "Paste a small CSV or JSON example. DataSmith will use its structure to suggest matching generators."
                : "Review the proposed generators. You can change any setting in the table after applying."}
            </DialogDescription>
          </DialogHeader>

          {aiMode === "sample" && !suggestions.length ? (
            <div className="space-y-3">
              <Textarea
                value={sampleData}
                onChange={(event) => setSampleData(event.target.value)}
                placeholder={'name,email,city\nAvery Stone,avery@example.com,Doha\n'}
                className="min-h-40 font-mono text-xs"
              />
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Icon icon="lucide:shield-check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <p>
                  Sample content stays in this app in this prototype. Only its
                  column labels are used to match generator suggestions.
                </p>
              </div>
              <DialogFooter>
                <Button
                  onClick={analyzeSample}
                  disabled={!sampleData.trim() || isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <Icon icon="lucide:loader-circle" className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing sample
                    </>
                  ) : (
                    <>
                      <Icon icon="lucide:sparkles" className="mr-2 h-4 w-4" />
                      Analyze sample
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Column</span>
                  <span>Suggested generator</span>
                </div>
                <div className="max-h-72 divide-y overflow-y-auto">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.column.name}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {suggestion.column.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {suggestion.reason}
                        </p>
                      </div>
                      <Badge variant="secondary" className="w-fit max-w-full truncate">
                        {suggestion.generator || suggestion.type}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAiMode(null)}>
                  Cancel
                </Button>
                <Button onClick={applySuggestions} disabled={!suggestions.length}>
                  <Icon icon="lucide:check" className="mr-2 h-4 w-4" />
                  Apply {suggestions.length} suggestions
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function buildSuggestions(
  columns: ColumnData[],
  fakerMethods: string[] | null,
  sampleHeaders: string[] = []
): GeneratorSuggestion[] {
  const available = new Set(fakerMethods ?? [])
  const methodFor = (name: string, sqlType: string) => {
    const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
    const type = sqlType.toLowerCase()
    const candidates: [RegExp, string, string][] = [
      [/email|e_mail/, "email", "Email-shaped values"],
      [/first_?name|given_?name/, "first_name", "Recognized as a first name"],
      [/last_?name|surname|family_?name/, "last_name", "Recognized as a last name"],
      [/(^|_)name($|_)/, "name", "Recognized as a person name"],
      [/phone|mobile|telephone/, "phone_number", "Recognized as a phone number"],
      [/address|street/, "street_address", "Recognized as an address"],
      [/city|town/, "city", "Recognized as a city"],
      [/country/, "country", "Recognized as a country"],
      [/company|organization|business/, "company", "Recognized as an organization"],
      [/url|website|link/, "url", "Recognized as a web address"],
      [/created|updated|date|time|birth/, "date_time", "Recognized as a date or timestamp"],
      [/uuid|guid/, "uuid4", "Recognized as a UUID"],
      [/description|comment|message|text|body/, "text", "Recognized as free-form text"],
    ]
    const match = candidates.find(([pattern]) => pattern.test(value))
    if (match && available.has(match[1])) {
      return { generator: match[1], reason: match[2] }
    }
    if (/(int|serial|number)/.test(type) && available.has("pyint")) {
      return { generator: "pyint", reason: "Numeric database type" }
    }
    if (/(float|double|decimal|numeric|real)/.test(type) && available.has("pyfloat")) {
      return { generator: "pyfloat", reason: "Numeric database type" }
    }
    const fallback = ["word", "pystr", "text"].find((method) => available.has(method))
    return {
      generator: fallback ?? null,
      reason: fallback ? "General-purpose sample value" : "Choose a generator in the table",
    }
  }

  return columns.map((column): GeneratorSuggestion => {
    if (column.foreignKeys?.table) {
      return {
        column,
        type: "foreign",
        generator: `${column.foreignKeys.table}__${column.foreignKeys.column}`,
        reason: `Keeps the link to ${column.foreignKeys.table}`,
      }
    }
    if (column.autoincrement) {
      return { column, type: "autoincrement", generator: null, reason: "Database-managed identifier" }
    }
    if (column.computed) {
      return { column, type: "computed", generator: null, reason: "Computed by the database" }
    }

    const sampleHeader = sampleHeaders.find(
      (header) => normalizeName(header) === normalizeName(column.name)
    )
    const { generator, reason } = methodFor(
      sampleHeader ?? column.name,
      column.type
    )
    return {
      column,
      type: "faker",
      generator,
      reason: sampleHeader ? `Matched sample field “${sampleHeader}”` : reason,
    }
  })
}

function readSampleHeaders(sample: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sample)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    if (first && typeof first === "object") return Object.keys(first)
  } catch {
    // Treat non-JSON input as CSV and use the first row as its header.
  }
  return (sample.split(/\r?\n/, 1)[0] ?? "")
    .split(",")
    .map((header) => header.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

interface InsertTabRowsProps {
  column: ColumnData
  columnSpec: ColumnSpec
  setColumnSpec: (newSpec: ColumnSpec) => void
  fakerMethods: string[] | null
  hoveredGroup: string[] | null
  setHoveredGroup: (group: string[] | null) => void
}

function InsertTabRows({
  column,
  columnSpec,
  setColumnSpec,
  fakerMethods,
  hoveredGroup,
  setHoveredGroup,
}: InsertTabRowsProps) {
  const thisGroup = column.multiUnique || []
  const inHovered = hoveredGroup?.includes(column.name)

  return (
    <TableRow
      onMouseEnter={() => {
        setHoveredGroup(thisGroup ?? null)
      }}
      onMouseLeave={() => setHoveredGroup(null)}
    >
      <TableCell>
        <div
          className={cn(
            "flex items-center",
            inHovered && "font-medium text-lime-500",
            column.primaryKey && "text-purple-500"
          )}
        >
          {column.name}
          <div className="ml-2 flex items-center space-x-1">
            {column.primaryKey ? (
              <div className="rounded border p-1 text-xs font-medium text-current">
                PK
              </div>
            ) : column.unique ? (
              <div className="rounded border p-1 text-xs font-medium text-current">
                UQ
              </div>
            ) : (
              thisGroup.length > 0 && (
                <div className="rounded border p-1 text-xs font-medium text-current">
                  UQG
                </div>
              )
            )}
            {!column.nullable && (
              <div className="rounded border p-1 text-xs font-medium text-current">
                NN
              </div>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell>{column.type}</TableCell>

      <TableCell>
        <GeneratorTypeSelect
          selected={columnSpec.type}
          setSelected={(val) =>
            setColumnSpec({ ...columnSpec, type: val, generator: null })
          }
          column={column}
        />
      </TableCell>

      <TableCell>
        <RenderGenerator
          column={column}
          generatorType={columnSpec.type}
          selected={columnSpec.generator}
          setSelected={(val) =>
            setColumnSpec({ ...columnSpec, generator: val })
          }
          fakerMethods={fakerMethods}
        />
      </TableCell>
    </TableRow>
  )
}

interface GeneratorTypeSelectProps {
  selected: GeneratorType | null
  setSelected: (view: GeneratorType) => void
  column: ColumnData
}

function GeneratorTypeSelect({
  selected,
  setSelected,
  column,
}: GeneratorTypeSelectProps) {
  return (
    <Select
      // key={column.name}
      value={selected ?? ""}
      onValueChange={(val) => setSelected(val as GeneratorType)}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Generator Type" />
      </SelectTrigger>

      <SelectContent>
        {column.foreignKeys?.table ? (
          <SelectItem value="foreign">
            <div className="flex items-center">
              <Icon
                icon="tabler:package-import"
                className="mr-2 h-4 w-4 text-yellow-400"
              />
              Foreign Key
            </div>
          </SelectItem>
        ) : column.autoincrement ? (
          <SelectItem value="autoincrement">
            <div className="flex items-center">
              <Icon
                icon="mdi:increment"
                className="mr-2 h-4 w-4 text-amber-400"
              />
              Auto Increment
            </div>
          </SelectItem>
        ) : (
          column.computed && (
            <SelectItem value="computed">
              <div className="flex items-center">
                <Icon
                  icon="fa-solid:code"
                  className="mr-2 h-4 w-4 text-blue-600"
                />
                Computed
              </div>
            </SelectItem>
          )
        )}
        <SelectItem value="faker">
          <div className="flex items-center">
            <Icon
              icon="ep:collection"
              className="mr-2 h-4 w-4 text-purple-400"
            />
            Library
          </div>
        </SelectItem>
        <SelectItem value="regex">
          <div className="flex items-center">
            <Icon icon="mdi:regex" className="mr-2 h-4 w-4 text-green-500" />
            Regex
          </div>
        </SelectItem>
        <SelectItem value="python">
          <div className="flex items-center">
            <Icon icon="material-icon-theme:python" className="mr-2 h-4 w-4" />
            Py Script
          </div>
        </SelectItem>
        <SelectItem value="constant">
          <div className="flex items-center">
            <Icon
              icon="raphael:locked"
              className="mr-2 h-4 w-4 text-yellow-300"
            />
            Constant
          </div>
        </SelectItem>
        {column.nullable && (
          <SelectItem value="null">
            <div className="flex items-center">
              <Icon
                icon="pepicons-pop:no-entry"
                className="mr-2 h-4 w-4 text-red-500"
              />
              NULL
            </div>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

interface RenderGeneratorProps {
  column: ColumnData
  generatorType: string | null
  selected: string | null
  setSelected: (value: string | null) => void
  fakerMethods: string[] | null
}

function RenderGenerator({
  column,
  generatorType,
  selected,
  setSelected,
  fakerMethods,
}: RenderGeneratorProps) {
  const [generatorInput, setGeneratorInput] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const { theme } = useTheme()
  const pythonPlaceholder = [
    "# You can import builtins + faker",
    "# Python generators run *after* faker, foreign, regex, etc.",
    "# Use @order(int) to set execution order between python generators",
    "# Example:",
    "#   @order(1)",
    "#   def generator(columns):",
    '#       return columns["name"].lower() + "@x.com\n\n',
  ].join("\n")

  useEffect(() => {
    setGeneratorInput(selected || null)
    if (generatorType === "foreign") {
      setSelected(`${column.foreignKeys?.table}__${column.foreignKeys?.column}`)
    } else if (generatorType === "null") {
      setSelected("null")
    }
  }, [generatorType])

  return generatorType === "faker" ? (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-[350px] justify-between")}
        >
          <div
            className={cn(
              "flex items-center",
              selected ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <Icon icon="mdi:collection" className="mr-2 h-4 w-4" />
            {selected ?? "Select item"}
          </div>
          <CaretSortIcon className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandEmpty>No item found.</CommandEmpty>
          <CommandList>
            {fakerMethods &&
              fakerMethods.map((item) => (
                <CommandItem
                  key={item}
                  value={item}
                  onSelect={(val) => {
                    setSelected(val)
                    setOpen(false)
                  }}
                >
                  {item}
                  <CheckIcon
                    className={cn(
                      "ml-auto h-4 w-4",
                      selected === item ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  ) : generatorType === "foreign" ? (
    <Popover open={false}>
      <PopoverTrigger asChild>
        <span
          title={`Table: ${column.foreignKeys.table} Column: ${column.foreignKeys.column}`}
        >
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={false}
            className="w-[350px] justify-start text-left"
            disabled
          >
            <Icon icon="tabler:table-filled" className="mr-2 h-4 w-4" />
            {column.foreignKeys.table}__{column.foreignKeys.column}
          </Button>
        </span>
      </PopoverTrigger>
    </Popover>
  ) : generatorType === "regex" ? (
    <div className="w-[350px] overflow-auto rounded border">
      <div className="flex items-stretch bg-muted">
        <div className="flex w-10">
          <Icon icon="mingcute:up-fill" className="m-auto h-4 w-4" />
        </div>
        <Input
          placeholder={"Regex (Python engine)"}
          value={
            generatorInput
              ? generatorInput.slice(1, -1)
              : selected
                ? selected.slice(1, -1)
                : ""
          }
          onChange={(e) => setGeneratorInput("^" + e.target.value + "$")}
          height="auto"
          className="rounded-none border-0 text-green-400"
          onBlur={() => {
            setSelected(generatorInput)
          }}
        />
        <div className="flex w-10">
          <Icon icon="bx:dollar" className="m-auto h-4 w-4" />
        </div>
      </div>
    </div>
  ) : generatorType === "python" ? (
    <div className="w-[350px] overflow-clip rounded border">
      <CodeMirror
        placeholder={pythonPlaceholder}
        value={generatorInput || selected || ""}
        onChange={setGeneratorInput}
        extensions={[python()]}
        theme={theme === "light" ? githubLight : githubDark}
        height="auto"
        minHeight="50px"
        onBlur={() => {
          setSelected(generatorInput)
        }}
        maxHeight="200px"
        maxWidth="350px"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
        }}
      />
    </div>
  ) : generatorType === "constant" ? (
    <div className="flex w-[350px] items-center rounded border bg-muted">
      <Icon icon="oui:vis-text" className="m-2 mr-2 h-6 w-6" />
      <Input
        placeholder="Constant value"
        className="rounded-none border-0"
        value={generatorInput || selected || ""}
        onChange={(e) => setGeneratorInput(e.target.value)}
        onBlur={() => {
          setSelected(generatorInput)
        }}
      />
    </div>
  ) : null
}
