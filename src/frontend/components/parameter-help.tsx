"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ParameterHelp({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`About ${label.toLowerCase()}`}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>{description}</TooltipContent>
    </Tooltip>
  );
}
