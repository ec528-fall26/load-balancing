"use client";
import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="content">
        <AccordionTrigger>{title}</AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
export function Notice({
  children,
  error = false,
  role = "alert",
}: {
  children: ReactNode;
  error?: boolean;
  role?: "alert" | "status";
}) {
  return (
    <Alert variant={error ? "destructive" : "default"} role={role}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
