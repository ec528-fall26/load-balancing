"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { FlaskConical, Library, Server, Settings2, Split } from "lucide-react";
import { Button } from "@/components/ui/button";

const pages = [
  { id: "library", label: "Library", icon: Library },
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "lab", label: "Lab", icon: FlaskConical },
  { id: "compare", label: "Compare", icon: Split },
] as const;
export type PageSection = (typeof pages)[number]["id"];

export function AppHeader({
  actions,
  section = "library",
  labHref = "/simulator",
  setupHref = "/setup",
  compareHref = "/compare",
}: {
  actions?: ReactNode;
  section?: PageSection;
  labHref?: string;
  setupHref?: string;
  compareHref?: string;
}) {
  const hrefs = {
    library: "/",
    setup: setupHref,
    lab: labHref,
    compare: compareHref,
  };
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-3 md:gap-4 md:px-6">
      <Link
        href="/"
        aria-label="Load balancing lab home"
        className="flex shrink-0 items-center gap-2"
      >
        <Server className="size-5" />
        <span className="text-sm font-semibold sm:text-base">
          Load balancing lab
        </span>
      </Link>
      <nav
        aria-label="Main navigation"
        className="app-navigation fixed inset-x-0 bottom-0 grid grid-cols-4 items-center gap-1 border-t bg-background px-2 md:static md:flex md:border-0 md:bg-transparent md:p-0"
      >
        {pages.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            asChild
            variant={section === id ? "secondary" : "ghost"}
            size="sm"
            className="h-12 min-w-0 flex-col gap-1 px-1 md:h-7 md:flex-row md:px-2.5"
          >
            <Link
              href={hrefs[id]}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon aria-hidden="true" className="size-4 md:hidden" />
              {label}
            </Link>
          </Button>
        ))}
      </nav>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
