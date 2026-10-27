import { GeneratorType } from "@/components/types"

import { CliProgress, invokeCliRequest } from "./cli"

export interface AiDatabaseColumnPlan {
  name: string
  type: GeneratorType
  generator: string | null
  reason: string
}

export interface AiTablePlan {
  name: string
  noOfEntries: number
  columns: AiDatabaseColumnPlan[]
}

export interface AiTablePlanRequest {
  request_id: string
  table_name: string
  provider: AiProvider
  base_url: string
  model: string
  api_key: string
  prompt: string
  generators: string[]
}

export type AiProvider = "gemini" | "openai" | "openai_compatible"

export interface AiModelListRequest {
  provider: AiProvider
  base_url: string
  api_key: string
}

export function invokeAiModelList(request: AiModelListRequest) {
  return invokeCliRequest<AiModelListRequest, { models: string[] }>({
    kind: "list_ai_models",
    body: request,
  })
}

export function invokeAiTablePlan(
  request: AiTablePlanRequest,
  onProgress?: (progress: CliProgress) => void
) {
  return invokeCliRequest<
    AiTablePlanRequest,
    { table: AiTablePlan }
  >(
    {
      kind: "ai_plan_table",
      body: request,
    },
    onProgress
  )
}

export function invokeCancelAiTablePlan(requestId: string) {
  return invokeCliRequest<{ request_id: string }, { cancelled: boolean }>({
    kind: "cancel_ai_table_plan",
    body: { request_id: requestId },
  })
}
