export type CliResponse<T> = Record<string, unknown> & {
  status: "ok" | "error"
  payload?: T
  error?: string
}

export type CliRequest<T> = Record<string, unknown> & {
  id?: string
  kind: string
  body?: T
}

export type DBDialectType =
  | "MYSQL"
  | "UNKNOWN"
  | "POSTGRESQL"
  | "MSSQL"
  | "ORACLE"
  | "MARIADB"
  | "FIREBIRD"

export interface DBCreds {
  id?: number
  host: string
  user: string
  port: string
  name: string
  dialect: DBDialectType
  password?: string
  error?: string
}

export interface ColumnData {
  name: string
  type: string
  unique: boolean
  multiUnique: string[] | null
  primaryKey: boolean
  nullable: boolean
  default: string | null
  autoincrement: boolean
  computed: boolean
  foreignKeys: { table: string; column: string }
  length: number | null
  precision: number | null
  scale: number | null
}

export interface TableMetadata {
  name: string
  parents: string[]
  columns: ColumnData[]
}

export interface TableEntry {
  name: string
  parents: number
  rows: number
}

export interface DataEntry {}

export interface DataPackage {
  verified: boolean
  table: string
  entries: DataEntry[]
  inserted: boolean
}

export type GeneratorType =
  | "faker"
  | "regex"
  | "foreign"
  | "autoincrement"
  | "computed"
  | "python"
  | "constant"
  | "null"

export interface TableSpec {
  name: string
  pageSize: number
  noOfEntries: number
  columns: ColumnSpec[]
}
export interface ColumnSpec {
  name: string
  generator: string | null
  type: GeneratorType | null
}

export type ColumnSpecMap = Record<string, ColumnSpec>
export interface TableSpecEntry {
  name: string
  noOfEntries: number
  columns: ColumnSpecMap
}

export type TableSpecMap = Record<string, TableSpecEntry>

export interface ErrorPacket {
  msg: string | null
  column: string | null
  type: "warning" | "error"
}

export type ErrorPacketMap = Record<string, ErrorPacket[]>

export interface PacketProgress {
  status: string
  jobId: string
  row: number
  total: number
  column: string | null
  eta: string | null
}

export interface TablePacketRequest {
  status: "done" | "pending"
  message: string
  jobId: string
  data: TablePacket | null
  progress: PacketProgress
}

export interface TablePacket {
  id: string
  name: string
  columns: string[] | null
  entries: (string | null)[][]
  errors: ErrorPacket[] | null

  page: number
  pageSize: number
  totalPages: number
  totalEntries: number
}

export interface SqlLog {
  log: string[]
  prompt: string
}

export interface UsageInfo {
  tableName: string
  totalRows: number
  newRows: number
}
