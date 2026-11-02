"use client";
import { useEffect, useRef } from "react";
import type { Run } from "@/lib/engine";
import { useSidebar } from "@/components/ui/sidebar";
export function OpenSetupOnLoad({
  ready,
  completedRun,
  liveSessionId,
}: {
  liveSessionId?: string | null;
  ready: boolean;
  completedRun: Run | null;
}) {
  const handled = useRef(false);
  const { setOpen, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (!ready || handled.current) return;
    handled.current = true;
    if (window.matchMedia("(max-width:767px)").matches) setOpenMobile(true);
    else setOpen(true);
  }, [ready, setOpen, setOpenMobile]);
  useEffect(() => {
    if (completedRun || liveSessionId) setOpenMobile(false);
  }, [completedRun, liveSessionId, setOpenMobile]);
  return null;
}
