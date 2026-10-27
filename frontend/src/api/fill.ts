import {
  PacketProgress,
  TablePacket,
  TablePacketRequest,
  TableSpec,
} from "@/components/types"

import { invokeCliRequest } from "./cli"

export function invokeGetFakerMethods() {
  return invokeCliRequest<void, string[]>({ kind: "get_gen_methods" })
}

export function invokeGenPackets(tableSpec: TableSpec) {
  return invokeCliRequest<TableSpec, PacketProgress>({
    kind: "get_gen_packets",
    body: tableSpec,
  })
}

export function invokeGetGenPacket(packetId: string, page: number) {
  return invokeCliRequest<{ packetId: string; page: number }, TablePacket>({
    kind: "get_gen_packet",
    body: { packetId: packetId, page: page },
  })
}

export function invokeLoadSpec(dbId: number, tableName: string) {
  return invokeCliRequest<Record<string, string | number>, TableSpec>({
    kind: "get_pref_spec",
    body: {
      dbId: dbId,
      tableName: tableName,
    },
  })
}

export function invokeInsertSqlPacket(packetId: string) {
  return invokeCliRequest<{ packetId: string }, { pendingWrites: number }>({
    kind: "set_db_insert",
    body: { packetId: packetId },
  })
}

export function invokeExportSqlPacket(packetId: string, path: string) {
  return invokeCliRequest<{ path: string; packetId: string }, string>({
    kind: "set_db_export",
    body: { packetId: packetId, path: path },
  })
}

export function invokeClearGenPackets() {
  return invokeCliRequest<void, string>({
    kind: "clear_gen_packets",
  })
}

export function invokeGetGenResult(jobId: string) {
  return invokeCliRequest<{ jobId: string }, TablePacketRequest>({
    kind: "poll_gen_status",
    body: { jobId: jobId },
  })
}
