import { useEffect, useRef, useState } from "react"
import {
  AiTablePlan,
  AiProvider,
  invokeAiTablePlan,
  invokeAiModelList,
  invokeCancelAiTablePlan,
} from "@/api/ai"
import { Icon } from "@iconify/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { TableSpecEntry } from "@/components/types"

interface DatabaseAiDialogProps {
  generators: string[] | null
  tableName: string | null
  onApply: (plan: TableSpecEntry) => void
}

const PROVIDER_CONFIG: Record<
  AiProvider,
  { label: string; baseUrl: string; models: string[] }
> = {
  gemini: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"],
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5.1", "gpt-5-mini", "gpt-4.1-mini"],
  },
  openai_compatible: {
    label: "OpenAI-compatible / self-hosted",
    baseUrl: "http://localhost:11434/v1",
    models: ["qwen2.5-coder:7b", "llama3.1:8b", "mistral-nemo"],
  },
}

export default function DatabaseAiDialog({
  generators,
  tableName,
  onApply,
}: DatabaseAiDialogProps) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<AiProvider>("gemini")
  const [baseUrl, setBaseUrl] = useState(PROVIDER_CONFIG.gemini.baseUrl)
  const [model, setModel] = useState("gemini-3.8-flash")
  const [availableModels, setAvailableModels] = useState(
    PROVIDER_CONFIG.gemini.models
  )
  const [customModel, setCustomModel] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [prompt, setPrompt] = useState(
    "Create realistic development data for this table. Generate 50 rows."
  )
  const [plan, setPlan] = useState<AiTablePlan | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [progressMessage, setProgressMessage] = useState("")
  const [progressLogs, setProgressLogs] = useState<string[]>([])
  const [isListingModels, setIsListingModels] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequestId = useRef<string | null>(null)

  useEffect(() => {
    const requestId = activeRequestId.current
    activeRequestId.current = null
    if (requestId) {
      void invokeCancelAiTablePlan(requestId).catch(() => undefined)
    }
    setIsGenerating(false)
    setIsCancelling(false)
    setPlan(null)
    setError(null)
  }, [tableName])

  function changeProvider(nextProvider: AiProvider) {
    setProvider(nextProvider)
    setBaseUrl(PROVIDER_CONFIG[nextProvider].baseUrl)
    setAvailableModels(PROVIDER_CONFIG[nextProvider].models)
    setModel(PROVIDER_CONFIG[nextProvider].models[0])
    setCustomModel(false)
    setError(null)
  }

  async function discoverModels() {
    setIsListingModels(true)
    setError(null)
    try {
      const result = await invokeAiModelList({
        provider,
        base_url: baseUrl.trim(),
        api_key: apiKey,
      })
      if (!result.models.length) {
        setError("No chat models were found for this API key and provider.")
        return
      }
      setAvailableModels(result.models)
      if (!result.models.includes(model)) setModel(result.models[0])
      setCustomModel(false)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load the provider's models. You can still enter a model ID manually."
      )
    } finally {
      setIsListingModels(false)
    }
  }

  async function generatePlan() {
    if (!tableName) {
      setError("Select a table before generating a plan.")
      return
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeRequestId.current = requestId
    setIsGenerating(true)
    setProgressMessage("Sending request to the local backend…")
    setProgressLogs([])
    setError(null)
    const backendWatchdog = window.setTimeout(() => {
      if (activeRequestId.current === requestId) {
        setProgressMessage((current) =>
          current === "Sending request to the local backend…"
            ? "No backend progress yet. Check that the sidecar is rebuilt and restarted."
            : current
        )
      }
    }, 12_000)
    console.info("[DataSmith AI] Starting table plan request", {
      requestId,
      tableName,
      provider,
      model,
    })
    try {
      const result = await invokeAiTablePlan(
        {
          request_id: requestId,
          table_name: tableName,
          provider,
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: apiKey,
          prompt: prompt.trim(),
          generators: generators ?? [],
        },
        (progress) => {
          const entry = `${new Date().toLocaleTimeString()} [${progress.stage}] ${progress.message}`
          console.info(`[DataSmith AI] ${entry}`)
          setProgressMessage(progress.message)
          setProgressLogs((current) => [...current, entry].slice(-8))
        }
      )
      if (!result.table?.columns.length) {
        throw new Error("The AI did not return a plan for this table.")
      }
      if (activeRequestId.current !== requestId) return
      setPlan(result.table)
      setProgressMessage("Plan ready to review.")
    } catch (requestError) {
      if (activeRequestId.current !== requestId) return
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not generate a table plan."
      )
      setProgressMessage("Request failed.")
    } finally {
      window.clearTimeout(backendWatchdog)
      if (activeRequestId.current === requestId) {
        activeRequestId.current = null
        setIsGenerating(false)
      }
    }
  }

  async function cancelPlan() {
    const requestId = activeRequestId.current
    if (!requestId) return

    setIsCancelling(true)
    setProgressMessage("Cancelling request…")
    activeRequestId.current = null
    try {
      const result = await invokeCancelAiTablePlan(requestId)
      setError(
        result.cancelled
          ? "Table plan request cancelled."
          : "The table plan request had already finished."
      )
    } catch {
      setError(
        "Could not confirm cancellation. The provider request may still be running."
      )
    } finally {
      setIsGenerating(false)
      setIsCancelling(false)
    }
  }

  function applyPlan() {
    if (!plan) return
    onApply({
      name: plan.name,
      noOfEntries: plan.noOfEntries,
      columns: Object.fromEntries(
        plan.columns.map((column) => [
          column.name,
          {
            name: column.name,
            type: column.type,
            generator: column.generator,
          },
        ])
      ),
    })
    setOpen(false)
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={!tableName}>
        <Icon icon="lucide:sparkles" className="mr-2 h-4 w-4" />
        AI table setup
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && activeRequestId.current) void cancelPlan()
          if (nextOpen) {
            setPlan(null)
            setProgressLogs([])
          }
          setOpen(nextOpen)
          if (!nextOpen) setError(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {tableName
                ? `Generate a plan for ${tableName}`
                : "Select a table to configure"}
            </DialogTitle>
            <DialogDescription>
              Configure generators and row count for this table only. Review the
              plan before applying it to DataSmith&apos;s table settings.
            </DialogDescription>
          </DialogHeader>

          {!plan ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Provider</span>
                  <Select
                    value={provider}
                    onValueChange={(value) =>
                      changeProvider(value as AiProvider)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PROVIDER_CONFIG).map(([id, config]) => (
                        <SelectItem key={id} value={id}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Model</span>
                  {customModel ? (
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="Enter model ID"
                        autoComplete="off"
                      />
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCustomModel(false)
                          if (!availableModels.includes(model)) {
                            setModel(availableModels[0] ?? "")
                          }
                        }}
                      >
                        List
                      </Button>
                    </div>
                  ) : (
                    <Select
                      value={
                        availableModels.includes(model) ? model : "__custom__"
                      }
                      onValueChange={(value) => {
                        if (value === "__custom__") {
                          setModel("")
                          setCustomModel(true)
                        } else {
                          setModel(value)
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableModels.map((modelId) => (
                          <SelectItem key={modelId} value={modelId}>
                            {modelId}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">
                          Custom model ID…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={discoverModels}
                    disabled={isListingModels || isGenerating}
                  >
                    {isListingModels
                      ? "Loading models…"
                      : "Load models from provider"}
                  </Button>
                </label>
              </div>
              {provider === "openai_compatible" && (
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">API base URL</span>
                  <Input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="http://localhost:11434/v1"
                    autoComplete="url"
                  />
                  <span className="block text-xs text-muted-foreground">
                    Use an OpenAI-compatible chat endpoint. HTTPS is recommended
                    for remote services; local HTTP is supported.
                  </span>
                </label>
              )}
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">
                  API key{" "}
                  <span className="text-muted-foreground">(if required)</span>
                </span>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Your key is kept in memory for this session"
                  autoComplete="new-password"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">
                  Describe the table data
                </span>
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={4000}
                  className="min-h-28"
                  placeholder="Describe the data and approximate row count you want for this table."
                />
              </label>
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Icon
                  icon="lucide:shield-check"
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                />
                <p>
                  Loading models sends your API key to the selected provider.
                  When generating, DataSmith sends the selected table and its
                  column names, types, nullability, uniqueness, relationships, and your prompt
                  through its local backend to the selected provider. It does
                  not send existing database rows. Your key is not saved by
                  DataSmith. Use an endpoint you trust; HTTPS is recommended for
                  remote providers.
                </p>
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              {(isGenerating || progressLogs.length > 0) && (
                <div
                  className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs"
                  aria-live="polite"
                  aria-atomic="false"
                >
                  <p className="font-medium">Request progress</p>
                  {progressLogs.length > 0 ? (
                    <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-muted-foreground">
                      {progressLogs.map((entry, index) => (
                        <li key={`${index}-${entry}`} className="break-words">
                          {entry}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">{progressMessage}</p>
                  )}
                  <p className="pt-1 text-muted-foreground">
                    Detailed backend trace: datasmith-ai.log
                  </p>
                </div>
              )}
              <DialogFooter>
                {isGenerating && (
                  <Button
                    variant="outline"
                    onClick={cancelPlan}
                    disabled={isCancelling}
                  >
                    {isCancelling ? "Cancelling…" : "Cancel"}
                  </Button>
                )}
                <Button
                  onClick={generatePlan}
                  disabled={
                    (provider === "openai_compatible" && !baseUrl.trim()) ||
                    !model.trim() ||
                    !prompt.trim() ||
                    isGenerating
                  }
                >
                  {isGenerating ? (
                    <>
                      <Icon
                        icon="lucide:loader-circle"
                        className="mr-2 h-4 w-4 animate-spin"
                      />
                      <span className="max-w-64 truncate">
                        {progressMessage || "Generating table plan…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon icon="lucide:sparkles" className="mr-2 h-4 w-4" />
                      Generate table plan
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="max-h-[52vh] space-y-3 overflow-y-auto">
                {plan && (
                  <section className="rounded-md border">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.columns.length} columns
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Rows
                        <Input
                          type="number"
                          min={1}
                          max={10000}
                          step={1}
                          value={plan.noOfEntries}
                          className="h-8 w-24"
                          onChange={(event) => {
                            const value = Number.parseInt(
                              event.target.value,
                              10
                            )
                            setPlan((current) =>
                              current
                                ? {
                                    ...current,
                                    noOfEntries: Number.isFinite(value)
                                      ? Math.max(1, Math.min(10000, value))
                                      : 1,
                                  }
                                : current
                            )
                          }}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-3 text-xs">
                      {plan.columns.map((column) => (
                        <div
                          key={column.name}
                          className="flex min-w-0 items-center justify-between gap-2"
                          title={column.reason}
                        >
                          <span className="truncate">{column.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {column.generator ?? column.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPlan(null)}>
                  Back
                </Button>
                <Button onClick={applyPlan}>
                  <Icon icon="lucide:check" className="mr-2 h-4 w-4" />
                  Apply plan to {plan?.name ?? "this table"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
