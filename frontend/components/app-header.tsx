"use client";
import { useRouter } from "next/navigation";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
}: {
  triggerRef?: RefObject<HTMLButtonElement | null>;
  actions?: ReactNode;
  section?: PageSection;
  labHref?: string;
}) {
  const router=useRouter();
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
              href={page.id === "lab" ? labHref : page.href}
              aria-current={section === page.id ? "page" : undefined}
            >
              {page.label}
            </Link>
          </Button>
        ))}
      </nav>
      <div className="md:hidden"><NativeSelect aria-label="Page navigation" value={section} onChange={e=>{const page=pages.find(p=>p.id===e.target.value);if(page)router.push(page.id==='lab'?labHref:page.href);}}>{pages.map(page=><NativeSelectOption key={page.id} value={page.id}>{page.label}</NativeSelectOption>)}</NativeSelect></div>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
