"use client";
import { useEffect, useRef } from "react";
import type { Run } from "@/lib/engine";
import { useSidebar } from "@/components/ui/sidebar";
export function OpenSetupOnLoad({
  ready,
  completedRun,
}: {
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
    if (completedRun) setOpenMobile(false);
  }, [completedRun, setOpenMobile]);
  return null;
}
