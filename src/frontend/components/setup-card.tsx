"use client";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardAction,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { policies, type Config } from "@/lib/engine";
export function SetupCard({
  id,
  name,
  description,
  config,
  updatedAt,
  onDelete,
}: {
  id: string;
  name: string;
  description?: string;
  config: Config;
  updatedAt?: string;
  onDelete?: (id: string) => void;
}) {
  const isTemplate = !updatedAt;
  const href = `/simulator?${isTemplate ? "template" : "save"}=${encodeURIComponent(id)}`;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="min-w-0 truncate" title={name}>
          <Link href={href}>{name}</Link>
        </CardTitle>
        <CardAction className="row-span-1">
          <Badge variant={isTemplate ? "secondary" : "outline"}>
            {isTemplate ? "Template" : "Saved setup"}
          </Badge>
        </CardAction>
        <CardDescription className="col-span-2">
          {description ??
            `Saved ${new Date(updatedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {[
            ["Servers", config.server_count.toLocaleString()],
            ["Slots / server", config.concurrency.toLocaleString()],
            ["Requests / second", config.arrival_rate.toLocaleString()],
            ["Arrival window", `${config.duration} s`],
            [
              "Total requests",
              Math.floor(
                config.arrival_rate * config.duration,
              ).toLocaleString(),
            ],
            ["Queue / server", config.queue_limit.toLocaleString()],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{policies[config.policy]}</Badge>
          {config.processing_rates && (
            <Badge variant="outline">Mixed speeds</Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="mt-auto flex gap-2">
        <Button
          asChild
          variant={isTemplate ? "outline" : "default"}
          className="flex-1"
        >
          <Link href={href}>{isTemplate ? "Use template" : "Open setup"}</Link>
        </Button>
        {onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Delete ${name}`}
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes this saved configuration from this browser.
                  Templates are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(id)}>
                  Delete setup
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardFooter>
    </Card>
  );
}
