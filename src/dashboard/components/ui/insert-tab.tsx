import { Dispatch, SetStateAction, useEffect, useState } from "react"
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
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
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
  TableSpecMap,
} from "@/components/types"

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

  return (
    <div className="flex h-full w-full flex-col overflow-auto">
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
    </div>
  )
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
