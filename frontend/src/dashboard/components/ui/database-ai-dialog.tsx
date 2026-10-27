import { useEffect, useRef, useState } from "react"
import {
  AiTablePlan,
  AiProvider,
  invokeAiTablePlan,
  invokeAiModelList,
  invokeCancelAiTablePlan,
} from "@/api/ai"
import { invokeGetFakerMethods } from "@/api/fill"
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
    "Create realistic development data for this table."
  )
  const [plan, setPlan] = useState<AiTablePlan | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [progressLogs, setProgressLogs] = useState<string[]>([])
  const [isListingModels, setIsListingModels] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(true)
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
    setProgressLogs([
      `${new Date().toLocaleTimeString()} [request] Starting table plan request`,
    ])
    setError(null)
    const backendWatchdog = window.setTimeout(() => {
      if (activeRequestId.current === requestId) {
        console.warn(
          "[DataSmith AI] No backend progress yet. Check that the sidecar is rebuilt and restarted."
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
      let availableGenerators = generators ?? []
      if (availableGenerators.length === 0) {
        console.info("[DataSmith AI] Loading available Faker methods")
        availableGenerators = await invokeGetFakerMethods()
      }
      if (availableGenerators.length === 0) {
        throw new Error(
          "Could not load Faker methods. Reconnect and try again."
        )
      }
      const result = await invokeAiTablePlan(
        {
          request_id: requestId,
          table_name: tableName,
          provider,
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: apiKey,
          prompt: prompt.trim(),
          generators: availableGenerators,
        },
        (progress) => {
          const entry = `${new Date().toLocaleTimeString()} [${progress.stage}] ${progress.message}`
          console.info(`[DataSmith AI] ${entry}`)
          setProgressLogs((current) => [...current, entry].slice(-8))
        }
      )
      if (!result.table?.columns.length) {
        throw new Error("The AI did not return a plan for this table.")
      }
      if (activeRequestId.current !== requestId) return
      setPlan(result.table)
    } catch (requestError) {
      if (activeRequestId.current !== requestId) return
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not generate a table plan."
      )
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
    setProgressLogs((current) =>
      [
        ...current,
        `${new Date().toLocaleTimeString()} [request] Cancelling request`,
      ].slice(-8)
    )
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

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && activeRequestId.current) void cancelPlan()
    if (nextOpen) {
      setPlan(null)
      setProgressLogs([])
    }
    setOpen(nextOpen)
    if (!nextOpen) setError(null)
  }

  const providerLabel = PROVIDER_CONFIG[provider].label
  const canGenerate =
    !isGenerating &&
    !!model.trim() &&
    !!prompt.trim() &&
    !(provider === "openai_compatible" && !baseUrl.trim())

  const errorBanner = error && (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      <Icon icon="lucide:circle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{error}</p>
    </div>
  )

  return (
    <>
      <Button
        size="sm"
        onClick={() => handleOpenChange(true)}
        disabled={!tableName}
      >
        <Icon icon="lucide:sparkles" className="mr-2 h-4 w-4" />
        Auto fill with AI
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-base">
              <Icon icon="lucide:sparkles" className="h-4 w-4 text-primary" />
              <span className="truncate">
                {plan
                  ? `Review plan for ${plan.name}`
                  : tableName
                    ? `Auto fill ${tableName}`
                    : "Select a table to configure"}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {plan
                ? "Check each column's generator and the row count, then apply them to this table's settings."
                : "Describe the data you want. The AI chooses Faker or creates regex patterns for structured values, then suggests a row count."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 overflow-y-auto md:h-[460px] md:grid-cols-[22rem_1fr] md:overflow-hidden">
            {/* Left rail */}
            <aside className="flex flex-col gap-4 border-b bg-muted/30 p-5 md:overflow-y-auto md:border-b-0 md:border-r">
              {!plan ? (
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Provider
                    </span>
                    <Select
                      value={provider}
                      onValueChange={(value) =>
                        changeProvider(value as AiProvider)
                      }
                      disabled={isGenerating}
                    >
                      <SelectTrigger
                        aria-label="Provider"
                        className="h-9 bg-background"
                      >
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
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Model
                      </span>
                      <button
                        type="button"
                        onClick={discoverModels}
                        disabled={isListingModels || isGenerating}
                        title="Load models from provider"
                        aria-label="Load models from provider"
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Icon
                          icon="lucide:refresh-cw"
                          className={`h-3.5 w-3.5 ${isListingModels ? "animate-spin" : ""}`}
                        />
                      </button>
                    </div>
                    {customModel ? (
                      <div className="flex gap-1.5">
                        <Input
                          autoFocus
                          value={model}
                          onChange={(event) => setModel(event.target.value)}
                          placeholder="Model ID"
                          autoComplete="off"
                          aria-label="Model ID"
                          className="h-9 bg-background"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
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
                        disabled={isGenerating}
                      >
                        <SelectTrigger
                          aria-label="Model"
                          className="h-9 bg-background"
                        >
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
                  </div>

                  {provider === "openai_compatible" && (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="ai-base-url"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        API base URL
                      </label>
                      <Input
                        id="ai-base-url"
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="http://localhost:11434/v1"
                        autoComplete="url"
                        className="h-9 bg-background"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label
                      htmlFor="ai-api-key"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      API key (if required)
                    </label>
                    <Input
                      id="ai-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="Session only, never saved"
                      autoComplete="new-password"
                      className="h-9 bg-background"
                    />
                  </div>

                  <div className="mt-auto flex items-start gap-2 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    <Icon
                      icon="lucide:shield-check"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
                    />
                    <p>
                      Only this table's schema and your prompt are sent to the
                      provider, never existing rows. Loading models sends your
                      key to the provider.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Table
                    </p>
                    <p className="truncate text-sm font-medium">{plan.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {plan.columns.length}{" "}
                      {plan.columns.length === 1 ? "column" : "columns"}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="ai-row-count"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Rows to generate
                    </label>
                    <Input
                      id="ai-row-count"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={plan.noOfEntries}
                      className="h-9 bg-background tabular-nums"
                      onChange={(event) => {
                        const value = Number.parseInt(event.target.value, 10)
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
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Planned by
                    </p>
                    <p className="truncate text-sm">{providerLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {model}
                    </p>
                  </div>

                  <p className="mt-auto pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    You can still edit any generator in the table settings after
                    applying.
                  </p>
                </>
              )}
            </aside>

            {/* Main area */}
            <section className="flex min-h-0 flex-col gap-3 p-5">
              {!plan ? (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="ai-prompt" className="text-sm font-medium">
                      What data do you need?
                    </label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {prompt.length}/4000
                    </span>
                  </div>
                  <Textarea
                    id="ai-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey) &&
                        canGenerate
                      ) {
                        event.preventDefault()
                        void generatePlan()
                      }
                    }}
                    maxLength={4000}
                    disabled={isGenerating}
                    className="min-h-24 flex-1 resize-none"
                    placeholder="Describe the data, row count, and any specifics like locales, date ranges, or formats."
                  />

                  {errorBanner}

                  {(isGenerating || progressLogs.length > 0) && (
                    <div
                      className="shrink-0 rounded-lg border bg-muted/30"
                      aria-live="polite"
                      aria-atomic="false"
                    >
                      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
                        <Icon
                          icon={
                            isGenerating
                              ? "lucide:loader-circle"
                              : "lucide:history"
                          }
                          className={`h-3.5 w-3.5 ${
                            isGenerating
                              ? "animate-spin text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                        {isGenerating ? "Generating plan" : "Last request"}
                      </div>
                      <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {progressLogs.map((entry, index) => (
                          <li key={`${index}-${entry}`} className="break-words">
                            {entry}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium">
                            Column
                          </th>
                          <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                            Type
                          </th>
                          <th className="px-4 py-2.5 text-left font-medium">
                            Generator
                          </th>
                          <th className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">
                            Why
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {plan.columns.map((column) => (
                          <tr key={column.name} className="align-top">
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{column.name}</p>
                              {column.reason && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground lg:hidden">
                                  {column.reason}
                                </p>
                              )}
                            </td>
                            <td className="hidden px-4 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">
                              {column.type}
                            </td>
                            <td className="px-4 py-2.5">
                              {column.generator ? (
                                <code className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                  {column.generator}
                                </code>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Type default
                                </span>
                              )}
                            </td>
                            <td className="hidden max-w-xs px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                              {column.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {errorBanner}
                </>
              )}
            </section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
            {!plan ? (
              <>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Press{" "}
                  <kbd className="rounded border bg-muted px-1 font-sans text-[10px]">
                    Ctrl
                  </kbd>{" "}
                  or{" "}
                  <kbd className="rounded border bg-muted px-1 font-sans text-[10px]">
                    ⌘
                  </kbd>{" "}
                  +{" "}
                  <kbd className="rounded border bg-muted px-1 font-sans text-[10px]">
                    Enter
                  </kbd>{" "}
                  to generate
                </p>
                <div className="ml-auto flex gap-2">
                  {isGenerating ? (
                    <Button
                      variant="outline"
                      onClick={cancelPlan}
                      disabled={isCancelling}
                    >
                      {isCancelling ? "Cancelling…" : "Cancel request"}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => handleOpenChange(false)}
                    >
                      Close
                    </Button>
                  )}
                  <Button onClick={generatePlan} disabled={!canGenerate}>
                    <Icon
                      icon={
                        isGenerating
                          ? "lucide:loader-circle"
                          : "lucide:sparkles"
                      }
                      className={`mr-2 h-4 w-4 ${isGenerating ? "animate-spin" : ""}`}
                    />
                    {isGenerating ? "Generating…" : "Generate plan"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setPlan(null)}>
                  <Icon icon="lucide:arrow-left" className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button onClick={applyPlan}>
                  <Icon icon="lucide:check" className="mr-2 h-4 w-4" />
                  Apply to {plan.name}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
