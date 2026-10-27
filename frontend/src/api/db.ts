import {
  DBCreds,
  SqlLog,
  TableEntry,
  TableMetadata,
  UsageInfo,
} from "@/components/types"

import { invokeCliRequest } from "./cli"

export function invokeDbInfo() {
  return invokeCliRequest<void, DBCreds>({ kind: "get_db_info" })
}

export function invokeGetLastConnected() {
  return invokeCliRequest<void, DBCreds | null>({
    kind: "get_db_last_connected",
  })
}

export function invokeDbConnection(dbCreds: DBCreds) {
  return invokeCliRequest<Record<string, unknown>, DBCreds>({
    kind: "set_db_connect",
    body: {
      host: dbCreds.host,
      port: dbCreds.port,
      user: dbCreds.user,
      name: dbCreds.name,
      password: dbCreds.password,
      dialect: dbCreds.dialect,
      drivername: dbCreds.drivername,
      url_query: dbCreds.urlQuery,
    },
  })
}

export function invokeDbConnectionUrl(connectionUrl: string) {
  return invokeCliRequest<{ connection_url: string }, DBCreds>({
    kind: "set_db_connect_url",
    body: { connection_url: connectionUrl },
  })
}

export function invokeDbDisconnect() {
  return invokeCliRequest<void, string>({ kind: "set_db_disconnect" })
}

export function invokeListDbCreds() {
  return invokeCliRequest<void, DBCreds[]>({ kind: "get_pref_connections" })
}

export function invokeDbDeletion(dbCreds: DBCreds) {
  return invokeCliRequest<DBCreds, string>({
    kind: "set_pref_delete",
    body: dbCreds,
  })
}

export function invokeDbReconnection(dbCreds: DBCreds) {
  return invokeCliRequest<Record<string, unknown>, DBCreds>({
    kind: "set_db_reconnect",
    body: {
      host: dbCreds.host,
      port: dbCreds.port,
      user: dbCreds.user,
      name: dbCreds.name,
      dialect: dbCreds.dialect,
      drivername: dbCreds.drivername,
      url_query: dbCreds.urlQuery,
    },
  })
}

export function invokeGetTables() {
  return invokeCliRequest<void, TableEntry[]>({ kind: "get_db_tables" })
}

export function invokeTableData(table: string) {
  return invokeCliRequest<{ name: string }, TableMetadata>({
    kind: "get_db_table",
    body: { name: table },
  })
}

export function invokeGetLogs(lines: number = 200) {
  return invokeCliRequest<{ lines: number }, string[]>({
    kind: "get_logs_read",
    body: { lines },
  })
}

export function invokeClearLogs() {
  return invokeCliRequest<void, []>({ kind: "set_logs_clear" })
}

export function invokeRunSql(sql: string) {
  return invokeCliRequest<{ sql: string }, string[]>({
    kind: "run_sql_query",
    body: { sql: sql },
  })
}

export function invokeGetSqlBanner() {
  return invokeCliRequest<void, SqlLog>({
    kind: "get_sql_banner",
  })
}

export function invokeDbCommit() {
  return invokeCliRequest<void, string>({ kind: "set_db_commit" })
}

export function invokeDbRollback() {
  return invokeCliRequest<void, string>({ kind: "set_db_rollback" })
}

export function invokeDbGetUncommitted() {
  return invokeCliRequest<void, number>({ kind: "get_uncommitted_db" })
}

export function invokeGetRowsConfig() {
  return invokeCliRequest<void, UsageInfo[]>({
    kind: "get_pref_rows",
  })
}
