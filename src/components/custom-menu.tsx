"use client"

import { LaptopIcon, MoonIcon, SunIcon } from "@radix-ui/react-icons"
import { Icon } from "@iconify/react"
import { useTheme } from "next-themes"
import { openUrl } from "@tauri-apps/plugin-opener"

import { cn } from "@/lib/utils"

import { AboutDialog } from "./about-dialog"
import { Dialog, DialogTrigger } from "./ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

export function Menu() {
  const { setTheme, theme } = useTheme()

  return (
    <div className="flex items-center border-none bg-muted py-1 lg:pl-3">
      <div className="flex w-full items-center px-2 py-1">
        <div className="mr-4 inline-flex items-center text-cyan-500">
          <img src="/icon.svg" alt="App icon" className="h-6 w-6" />
          <span className="ml-2 font-semibold text-foreground">DataSmith</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            Theme
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <SunIcon className="mr-2 inline h-4 w-4" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon className="mr-2 inline h-4 w-4" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <LaptopIcon className="mr-2 inline h-4 w-4" />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog modal={false}>
          <DialogTrigger asChild>
            <button
              className={cn(
                "ml-4 px-2 py-1 text-sm font-medium",
                "text-muted-foreground hover:text-foreground"
              )}
            >
              About
            </button>
          </DialogTrigger>
          <AboutDialog />
        </Dialog>

        <button
          className={cn(
            "ml-auto inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium",
            "text-muted-foreground hover:bg-card hover:text-foreground"
          )}
          aria-label="Open DataSmith on GitHub"
          title="Open DataSmith on GitHub"
          onClick={() => openUrl("https://github.com/MZaFaRM/DataSmith")}
        >
          <Icon icon="cib:github" className="h-5 w-5" />
          <span>GitHub</span>
        </button>
      </div>
    </div>
  )
}
