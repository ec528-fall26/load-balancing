"use client";
import Link from "next/link";
import type { RefObject, ReactNode } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  ChevronDown,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
export type PageSection = "library" | "lab" | "compare";
const pages = [
  { id: "library", label: "Library", href: "/" },
  { id: "lab", label: "Lab", href: "/simulator" },
  { id: "compare", label: "Compare", href: "/compare" },
] as const;
export function AppHeader({
  triggerRef,
  actions,
  section = "library",
  labHref = "/simulator",
  compareHref = "/compare",
}: {
  triggerRef?: RefObject<HTMLButtonElement | null>;
  actions?: ReactNode;
  section?: PageSection;
  labHref?: string;
  compareHref?: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-3 md:gap-4 md:px-6">
      {triggerRef && <SetupToggle buttonRef={triggerRef} compact />}
      <Link
        href="/"
        aria-label="Load balancing lab home"
        className="flex shrink-0 items-center gap-2"
      >
        <Server className="size-5" />
        <span className="hidden font-semibold sm:inline">
          Load balancing lab
        </span>
      </Link>
      <nav
        aria-label="Main navigation"
        className="hidden items-center gap-1 md:flex"
      >
        {pages.map((page) => (
          <Button
            key={page.id}
            asChild
            variant={section === page.id ? "secondary" : "ghost"}
            size="sm"
          >
            <Link
              href={
                page.id === "lab"
                  ? labHref
                  : page.id === "compare"
                    ? compareHref
                    : page.href
              }
              aria-current={section === page.id ? "page" : undefined}
            >
              {page.label}
            </Link>
          </Button>
        ))}
      </nav>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Page navigation">
              {pages.find((page) => page.id === section)?.label}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {pages.map((page) => (
                <DropdownMenuItem key={page.id} asChild>
                  <Link
                    href={
                      page.id === "lab"
                        ? labHref
                        : page.id === "compare"
                          ? compareHref
                          : page.href
                    }
                    aria-current={section === page.id ? "page" : undefined}
                  >
                    {page.label}
                    {section === page.id && <Check className="ml-auto" />}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
