"use client";
import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Notice } from "@/components/surface";
import { saveSetup, type SavedSetup } from "@/lib/saved-setups";
import type { Config } from "@/lib/engine";
export function SaveSetupDialog({
  config,
  suggestedName,
  current,
  onSaved,
}: {
  config: Config;
  suggestedName: string;
  current: SavedSetup | null;
  onSaved: (setup: SavedSetup) => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  function save(copy: boolean) {
    try {
      const result = saveSetup(name, config, copy ? undefined : current?.id);
      onSaved(result);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save setup.");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setName(current?.name ?? suggestedName);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Save data-icon="inline-start" />
          Save setup
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {current ? "Save your changes" : "Save this setup"}
          </DialogTitle>
          <DialogDescription>
            Save the current configuration and seed in this browser. Results are
            not stored; open the setup and run it again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="setup-name">Setup name</FieldLabel>
              <Input
                id="setup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
                autoFocus
              />
            </Field>
            {error && <Notice error>{error}</Notice>}
          </FieldGroup>
          <DialogFooter>
            {current && (
              <Button
                type="button"
                variant="outline"
                onClick={() => save(true)}
              >
                Save a copy
              </Button>
            )}
            <Button type="submit">
              {current ? "Save changes" : "Save setup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
