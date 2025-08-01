import { invoke } from "@tauri-apps/api/core"
import { once } from "@tauri-apps/api/event"
import camelcaseKeys from "camelcase-keys"

import { CliRequest, CliResponse } from "@/components/types"

export async function invokeCliRequest<T = unknown, R = unknown>(
  req: CliRequest<T>
): Promise<R> {
  const id = Date.now().toString() + Math.random().toString(36).slice(2)
  const taggedReq = { ...req, id }
  // console.log("Invoking CLI request:", taggedReq)
  return new Promise(async (resolve, reject) => {
    const unListen = await once<string>(`py-response-${id}`, (event) => {
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
        unListen()
      }
    })

    invoke("send", { payload: JSON.stringify(taggedReq) }).catch((e) => {
      unListen()
      reject(e)
    })
  })
}
