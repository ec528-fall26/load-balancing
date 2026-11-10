"use client";
import { Layers } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ServerNode, type ServerSnapshot } from "./server-node";
export function RackView({
  number,
  servers,
  averages,
  onInspect,
}: {
  number: number;
  servers: ServerSnapshot[];
  averages: boolean;
  onInspect: (id: string) => void;
}) {
  const active = servers.reduce((n, s) => n + s.active, 0),
    queued = servers.reduce((n, s) => n + s.queued, 0),
    slots = servers.reduce((n, s) => n + s.slots, 0);
  return (
    <Card className="min-w-0 gap-0 overflow-hidden">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-4" />
            Rack {number}
          </CardTitle>
          <Badge variant="outline">{servers.length} servers</Badge>
        </div>
        <CardDescription>
          Servers {servers[0]?.id}–{servers.at(-1)?.id}
          {!averages && ` · ${active} / ${slots} slots busy`}
        </CardDescription>
        {!averages && (
          <div className="flex flex-wrap gap-2">
            <Badge variant={active ? "executing" : "secondary"}>
              {active.toLocaleString()} running
            </Badge>
            <Badge variant={queued ? "waiting" : "secondary"}>
              {queued.toLocaleString()} waiting
            </Badge>
            {servers.some(s=>s.ioWaiting!==undefined)&&<Badge variant="outline">{servers.reduce((n,s)=>n+(s.ioWaiting??0),0)} I/O waiting</Badge>}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 border-t bg-muted/30 p-3">
        {servers.map((server) => (
          <ServerNode
            key={server.id}
            server={server}
            averages={averages}
            onInspect={() => onInspect(server.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}
