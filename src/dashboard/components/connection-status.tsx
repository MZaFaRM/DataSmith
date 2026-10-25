import { useEffect, useState } from "react"
import {
  invokeDbConnection,
  invokeDbConnectionUrl,
  invokeDbDeletion,
  invokeDbDisconnect,
  invokeDbInfo,
  invokeDbReconnection,
  invokeGetLastConnected,
  invokeListDbCreds,
} from "@/api/db"
import { Icon } from "@iconify/react"
import { CaretSortIcon, CheckIcon } from "@radix-ui/react-icons"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { toast } from "@/components/ui/use-toast"
import { Icons } from "@/components/icons"
import { DBCreds, DBDialectType } from "@/components/types"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

interface ConnectionSelectorProps {
  dbCreds: DBCreds | null
  updateDb: (info: DBCreds | null) => void
}

export default function ConnectionSelector({
  dbCreds,
  updateDb,
}: ConnectionSelectorProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [open, setOpen] = useState(false)
  const [newDbCreds, setNewDbCreds] = useState<DBCreds | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorField, setErrorField] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [connectionMode, setConnectionMode] = useState<"fields" | "url">("fields")
  const [connectionUrl, setConnectionUrl] = useState("")
  const [urlError, setUrlError] = useState("")
  const [dbList, setDbList] = useState<DBCreds[]>([])

  useEffect(() => {
    ;(async () => {
      await handleListDbCreds()
      await handleSavedDbCreds()
      await handleLastConnected()
    })()
  }, [])

  async function handleLastConnected() {
    try {
      const lastConnected = await invokeGetLastConnected()
      if (lastConnected && Object.keys(lastConnected).length > 0) {
        updateDb(lastConnected)
        // console.log("Last connected database:", lastConnected)
      } else {
        console.warn("No last connected database found.")
      }
    } catch (error) {
      console.error("Error fetching last connected database:", error)
      toast({
        title: "Auto reconnect failed",
        description: (error as Error).message,
        variant: "destructive",
      })
    }
  }

  function handleErrorField(error: string) {
    if (
      error.includes("Access denied for user") &&
      error.includes("(using password: YES)")
    ) {
      setErrorField("password")
      return "Invalid password for the user."
    } else if (error.includes("Can't connect to MySQL server")) {
      return "Unable to connect to the MySQL server. Please check the host and port."
    } else if (error.includes("Unknown database")) {
      setErrorField("name")
      return "The specified database does not exist."
    } else if (error.includes("Access denied for user")) {
      setErrorField("user")
      return "Invalid user credentials."
    } else if (error.includes("Connection refused")) {
      setErrorField("host")
      return "Connection refused. Please check the host and port."
    }
    return error
  }

  async function handleSavedDbCreds() {
    setLoading(true)
    try {
      const payload = await invokeDbInfo()
      if (payload && payload.id) {
        await handleListDbCreds()
        updateDb(payload)
      }
    } catch (error) {
      console.error("Error fetching database info:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleListDbCreds() {
    try {
      const creds = await invokeListDbCreds()
      setDbList(creds.length > 0 ? creds : [])
    } catch (error) {
      console.error("Error fetching database credentials:", error)
      setDbList([])
    }
  }

  async function handleRefresh() {
    setLoading(true)
    try {
      await handleDbCredsSelect(dbCreds!)
    } catch (error) {
      console.error("Error refreshing database info:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDbDisconnect() {
    try {
      await invokeDbDisconnect()
      updateDb(null)
    } catch (error) {
      console.error("Error disconnecting from the database:", error)
    }
  }

  async function handleDbCredsSelect(creds: DBCreds) {
    setLoading(true)
    updateDb({ ...creds, id: undefined })
    // console.log(creds)
    try {
      const data = await invokeDbReconnection(creds)
      updateDb(data)
      setOpen(false)
      setNewDbCreds(null)
    } catch (error) {
      console.error("Error reconnecting to the database:", error)
      toast({
        title: `Reconnect to database \`${creds.name}\` failed`,
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      await handleSavedDbCreds()
    }
  }

  async function handleDbCredsRemove(creds: DBCreds) {
    try {
      await invokeDbDeletion(creds)
      await handleDbDisconnect()
      await handleListDbCreds()
    } catch (error) {
      console.error("Error removing database connection:", error)
    }
  }

  async function handleNewDbConnection(
    credentials: DBCreds | null = newDbCreds,
    source: "fields" | "url" = connectionMode
  ) {
    if (!credentials) return

    setLoading(true)

    try {
      if (!credentials.dialect) {
        setErrorField("dialect")
        throw new Error("Please select a database dialect.")
      }

      const res =
        source === "url" && credentials.connectionUrl
          ? await invokeDbConnectionUrl(credentials.connectionUrl)
          : await invokeDbConnection({
              host: credentials.host || "localhost",
              port: credentials.port || defaultPortFor(credentials.dialect),
              user: credentials.user ?? "root",
              name: credentials.name ?? "",
              password: credentials.password ?? "",
              dialect: credentials.dialect || "UNKNOWN",
              drivername: credentials.drivername,
              urlQuery: credentials.urlQuery,
            })

      if (!res) throw new Error("Connection failed")

      await handleListDbCreds()
      updateDb(res)

      setTimeout(() => {
        setNewDbCreds(null)
        setShowDialog(false)
      }, 1000)
    } catch (error: any) {
      const errMsg = error?.message || String(error)
      console.error("Connection error:", errMsg)

      setNewDbCreds((prev) => ({
        ...prev!,
        error: handleErrorField(errMsg),
      }))
      if (source === "url") setUrlError(handleErrorField(errMsg))

      setTimeout(() => {
        setErrorField(null)
        setNewDbCreds((prev) => ({
          ...prev!,
          error: "",
        }))
      }, 3000)
    } finally {
      setLoading(false)
    }
  }

  async function handleDbUrlConnection() {
    setUrlError("")
    let credentials: DBCreds
    try {
      credentials = parseDatabaseUrl(connectionUrl)
    } catch (error) {
      setUrlError((error as Error).message)
      return
    }

    setNewDbCreds(credentials)
    await handleNewDbConnection(credentials, "url")
  }

  return (
    <div className="relative">
      {loading && (
        <div
          className={cn(
            "group absolute inset-0 z-10 flex items-center justify-center rounded",
            "bg-muted px-5 text-muted-foreground hover:bg-red-500 hover:text-white"
          )}
          onClick={() => {
            setLoading(false)
            handleDbDisconnect()
          }}
        >
          <Icon
            icon="fontisto:spinner-fidget"
            className="mr-5 h-4 w-4 animate-spin"
          />
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn("w-[200px]", loading && "cursor-wait")}
            >
              {dbCreds?.name ? (
                <>
                  <div className={cn(loading && "cursor-wait")}>
                    <Icon
                      icon="ix:circle-dot"
                      className={cn(
                        "mr-2 h-4 w-4",
                        dbCreds.id
                          ? "animate-pulse text-green-500"
                          : "text-red-500"
                      )}
                    />
                  </div>
                  <div className="truncate">
                    <p className="truncate">{dbCreds.name}</p>
                  </div>
                </>
              ) : (
                <div className="flex items-center">
                  <Icon
                    icon="ix:circle-dot"
                    className="mr-2 h-4 w-4 text-red-500"
                  />
                  {"Not Connected"}
                </div>
              )}
              <div className="ml-auto">
                <Icon
                  icon="radix-icons:caret-sort"
                  className="ml-3 h-4 w-4 text-muted-foreground"
                />
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0">
            <Command>
              <CommandInput placeholder="Search connections..." />
              <CommandEmpty>No DB found.</CommandEmpty>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem onSelect={handleRefresh} disabled={loading}>
                  <Icon
                    icon="mdi:refresh"
                    className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                  />
                  Refresh
                </CommandItem>
                {dbCreds?.name && (
                  <>
                    <CommandItem
                      onSelect={() => !loading && handleDbDisconnect()}
                    >
                      <Icon
                        icon="mdi:power"
                        className="mr-2 h-4 w-4 text-red-500"
                      />
                      Disconnect
                    </CommandItem>

                    <CommandItem
                      onSelect={() => !loading && handleDbCredsRemove(dbCreds)}
                    >
                      <Icon
                        icon="solar:database-bold-duotone"
                        className="mr-2 h-4 w-4 text-red-500"
                      />
                      Remove
                    </CommandItem>
                  </>
                )}
              </CommandGroup>

              <CommandGroup heading="Connections">
                {dbList.map((conn) => (
                  <CommandItem
                    key={conn.name}
                    className={cn(loading && "cursor-wait")}
                    disabled={loading}
                    onSelect={() => {
                      handleDbCredsSelect(conn)
                    }}
                  >
                    <div>
                      <Icon
                        icon="solar:database-bold-duotone"
                        className={cn(
                          "mr-2 h-4 w-4",
                          dbCreds?.id === conn.id
                            ? "text-green-500"
                            : "text-red-500"
                        )}
                      />
                    </div>
                    <div className="truncate">
                      <p className="truncate">{conn.name}</p>
                    </div>

                    <CheckIcon
                      className={cn(
                        "ml-auto h-4 w-4",
                        dbCreds?.name === conn.name
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandList>
                <CommandGroup>
                  <DialogTrigger asChild>
                    <CommandItem
                      onSelect={() => {
                        setOpen(false)
                        setShowDialog(true)
                      }}
                    >
                      <Icon
                        icon="mdi:plus-circle-outline"
                        className="mr-2 h-4 w-4"
                      />
                      New Connection
                    </CommandItem>
                  </DialogTrigger>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect to a Database</DialogTitle>
            <DialogDescription>
              Enter connection details or paste a database URL.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={connectionMode}
            onValueChange={(value) => {
              setConnectionMode(value as "fields" | "url")
              setUrlError("")
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="fields">Connection details</TabsTrigger>
              <TabsTrigger value="url">Database URL</TabsTrigger>
            </TabsList>
            <TabsContent value="fields">
            <div className="space-y-4 py-2 pb-4">
              <div>
                <DialectDropdown
                  value={newDbCreds?.dialect}
                  onChange={(val) =>
                    setNewDbCreds((prev) => ({
                      ...prev!,
                      dialect: val,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div
                  className={
                    "space-y-2 " + (errorField === "host" ? "text-red-500" : "")
                  }
                >
                  <Label htmlFor="host">Host</Label>
                  <Input
                    id="host"
                    placeholder="localhost"
                    required
                    defaultValue={newDbCreds?.host || "localhost"}
                    onChange={(e) =>
                      setNewDbCreds((prev) => ({
                        ...prev!,
                        host: e.target.value,
                      }))
                    }
                  />
                </div>
                <div
                  className={
                    "space-y-2 " + (errorField === "port" ? "text-red-500" : "")
                  }
                >
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    placeholder="3306"
                    defaultValue={newDbCreds?.port || "3306"}
                    onChange={(e) =>
                      setNewDbCreds((prev) => ({
                        ...prev!,
                        port: e.target.value,
                      }))
                    }
                  />
                </div>
                <div
                  className={
                    "space-y-2 " + (errorField === "user" ? "text-red-500" : "")
                  }
                >
                  <Label htmlFor="user">User</Label>
                  <Input
                    id="user"
                    placeholder="root"
                    defaultValue={newDbCreds?.user || "root"}
                    onChange={(e) =>
                      setNewDbCreds((prev) => ({
                        ...prev!,
                        user: e.target.value,
                      }))
                    }
                  />
                </div>
                <div
                  className={
                    "space-y-2 " + (errorField === "name" ? "text-red-500" : "")
                  }
                >
                  <Label htmlFor="name">Database Name</Label>
                  <Input
                    id="name"
                    required
                    defaultValue={newDbCreds?.name || ""}
                    onChange={(e) =>
                      setNewDbCreds((prev) => ({
                        ...prev!,
                        name: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div
                className={
                  "space-y-2 " +
                  (errorField === "password" ? "text-red-500" : "")
                }
              >
                <Label htmlFor="password">Password</Label>
                <div className="relative flex items-center">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    defaultValue={newDbCreds?.password || ""}
                    onChange={(e) =>
                      setNewDbCreds((prev) => ({
                        ...prev!,
                        password: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-2 text-muted-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            </TabsContent>
            <TabsContent value="url">
              <div className="space-y-4 py-2 pb-4">
                <div className="space-y-2">
                  <Label htmlFor="database-url">Connection URL</Label>
                  <Input
                    id="database-url"
                    type="url"
                    autoComplete="off"
                    placeholder="postgresql://user:password@host:5432/database"
                    value={connectionUrl}
                    onChange={(event) => {
                      setConnectionUrl(event.target.value)
                      setUrlError("")
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleDbUrlConnection()
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Supports PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, and Firebird URLs, including query options such as sslmode.
                  </p>
                  {urlError && (
                    <p className="text-sm text-red-500">{urlError}</p>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
          <div className="-mt-4 flex justify-center">
            {connectionMode === "fields" && newDbCreds?.error && (
              <p className="text-center text-sm text-red-500">
                {newDbCreds.error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              className={
                "min-w-[100px] " +
                (newDbCreds?.id
                  ? " cursor-not-allowed bg-green-600 text-white hover:bg-green-600"
                  : loading
                    ? "cursor-not-allowed"
                    : "hover:bg-accent")
              }
              onClick={() =>
                connectionMode === "url"
                  ? handleDbUrlConnection()
                  : handleNewDbConnection()
              }
              disabled={loading}
            >
              {newDbCreds?.id ? (
                "Connected!"
              ) : loading ? (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function defaultPortFor(dialect: DBDialectType): string {
  const ports: Record<DBDialectType, string> = {
    MYSQL: "3306",
    MARIADB: "3306",
    POSTGRESQL: "5432",
    MSSQL: "1433",
    ORACLE: "1521",
    FIREBIRD: "3050",
    UNKNOWN: "",
  }
  return ports[dialect]
}

function parseDatabaseUrl(value: string): DBCreds {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error("Enter a valid database URL.")
  }

  if (url.hash) {
    throw new Error("Remove the URL fragment and try again.")
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase()
  const baseScheme = scheme.split("+")[0]
  const dialectByScheme: Record<string, DBDialectType> = {
    postgres: "POSTGRESQL",
    postgresql: "POSTGRESQL",
    mysql: "MYSQL",
    mariadb: "MARIADB",
    mssql: "MSSQL",
    oracle: "ORACLE",
    firebird: "FIREBIRD",
  }
  const dialect = dialectByScheme[baseScheme]
  if (!dialect) {
    throw new Error("This database URL scheme is not supported.")
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ""))
  if (!url.hostname || !url.username || !name) {
    throw new Error(
      "The URL must include a host, username, and database name."
    )
  }

  const defaultDrivername: Record<DBDialectType, string> = {
    MYSQL: "mysql+pymysql",
    MARIADB: "mariadb+pymysql",
    POSTGRESQL: "postgresql+psycopg2",
    MSSQL: "mssql+pyodbc",
    ORACLE: "oracle+cx_oracle",
    FIREBIRD: "firebird+fdb",
    UNKNOWN: "",
  }
  const query: Record<string, string | string[]> = {}
  url.searchParams.forEach((value, key) => {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      const previous = query[key]
      query[key] = Array.isArray(previous)
        ? [...previous, value]
        : [previous, value]
    } else {
      query[key] = value
    }
  })

  return {
    host: url.hostname,
    port: url.port || defaultPortFor(dialect),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    name,
    dialect,
    drivername: scheme.includes("+") ? scheme : defaultDrivername[dialect],
    urlQuery: JSON.stringify(query),
    connectionUrl: value.trim(),
  }
}

const DIALECTS: {
  value: DBDialectType
  label: string
  icon: string
  className?: string
}[] = [
  {
    value: "MYSQL",
    label: "MYSQL",
    icon: "skill-icons:mysql-light",
  },
  {
    value: "POSTGRESQL",
    label: "POSTGRESQL",
    icon: "logos:postgresql",
  },
  {
    value: "MSSQL",
    label: "MSSQL (Experimental)",
    icon: "streamline-ultimate-color:microsoft-logo",
  },
  {
    value: "ORACLE",
    label: "ORACLE (Experimental)",
    icon: "cib:oracle",
    className: "text-red-500",
  },
  {
    value: "MARIADB",
    label: "MARIADB (Experimental)",
    icon: "logos:mariadb-icon",
  },
  {
    value: "FIREBIRD",
    label: "FIREBIRD (Experimental)",
    icon: "devicon:firebird",
  },
]

function DialectDropdown({
  value,
  onChange,
}: {
  value?: string
  onChange: (val: DBDialectType) => void
}) {
  const current = DIALECTS.find((d) => d.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <Icon
            icon={current?.icon || "logos:database"}
            className={`mr-2 h-5 w-5 ${current?.className || ""}`}
          />
          {current?.label || "Select a DB Dialect"}
          <CaretSortIcon className="ml-auto h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[460px]">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(val) => onChange(val as DBDialectType)}
        >
          {DIALECTS.map((d) => (
            <DropdownMenuRadioItem key={d.value} value={d.value}>
              <Icon
                icon={d.icon}
                className={`mr-2 h-4 w-4 ${d.className || ""}`}
              />
              {d.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
