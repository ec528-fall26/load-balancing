"use client";
import Link from "next/link";
import type { RefObject, ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
export function SetupToggle({
  buttonRef,
  compact = false,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  compact?: boolean;
}) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  return (
    <Button
      variant="ghost"
      size={compact ? "icon-sm" : "sm"}
      aria-label={expanded ? "Hide setup" : "Show setup"}
      ref={buttonRef}
      onClick={toggleSidebar}
      aria-expanded={expanded}
    >
      {expanded ? (
        <PanelLeftClose data-icon="inline-start" />
      ) : (
        <PanelLeftOpen data-icon="inline-start" />
      )}
      {!compact && (expanded ? "Hide setup" : "Show setup")}
    </Button>
  );
}

export function AppHeader({
  triggerRef,
  actions,
}: {
  triggerRef?: RefObject<HTMLButtonElement | null>;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 bg-background items-center gap-3 border-b px-4 md:px-6">
      {triggerRef && <><SetupToggle buttonRef={triggerRef} compact /><Separator orientation="vertical" className="h-5" /></>}
      <Link href="/" aria-label="Load balancing lab home" className="flex items-center gap-3">
        <Server className="size-5" />
        <span className="hidden font-semibold sm:inline">Load balancing lab</span>
        <Badge variant="outline">EC528</Badge>
      </Link>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
