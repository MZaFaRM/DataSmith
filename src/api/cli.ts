import { invoke } from "@tauri-apps/api/core"
import { listen, once } from "@tauri-apps/api/event"
import camelcaseKeys from "camelcase-keys"

import { CliRequest, CliResponse } from "@/components/types"

export interface CliProgress {
  stage: string
  message: string
  elapsedSeconds?: number
}

export async function invokeCliRequest<T = unknown, R = unknown>(
  req: CliRequest<T>,
  onProgress?: (progress: CliProgress) => void
): Promise<R> {
  const id = Date.now().toString() + Math.random().toString(36).slice(2)
  const taggedReq = { ...req, id }
  // console.log("Invoking CLI request:", taggedReq)
  return new Promise(async (resolve, reject) => {
    let unlistenResponse: (() => void) | undefined
    let unlistenProgress: (() => void) | undefined

    try {
      unlistenResponse = await once<string>(`py-response-${id}`, (event) => {
        try {
          const res = JSON.parse(event.payload || "{}") as CliResponse<R>
          if (res.status === "ok") {
            resolve(camelcaseKeys(res.payload || {}, { deep: true }) as R)
          } else {
            reject(new Error(res.error || JSON.stringify(res)))
          }
        } catch (error: any) {
          reject(new Error(error?.message || error))
        } finally {
          unlistenResponse?.()
          unlistenProgress?.()
        }
      })

      if (onProgress) {
        unlistenProgress = await listen<string>(
          `py-progress-${id}`,
          (event) => {
            try {
              const message = JSON.parse(event.payload || "{}")
              const progress = camelcaseKeys(message.payload || {}, {
                deep: true,
              }) as CliProgress
              onProgress(progress)
            } catch (error) {
              console.warn("Could not parse backend progress event", error)
            }
          }
        )
      }

      await invoke("send", { payload: JSON.stringify(taggedReq) })
    } catch (error) {
      unlistenResponse?.()
      unlistenProgress?.()
      reject(error)
    }
  })
}
