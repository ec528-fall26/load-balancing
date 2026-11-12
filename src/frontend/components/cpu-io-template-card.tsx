import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardAction, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { cpuIOTemplateHref, type CPUIOTemplate } from "@/lib/cpu-io-templates";
export function CPUIOTemplateCard({ template }: { template: CPUIOTemplate }) {
  const example = template.mode === "walkthrough";
  const href = cpuIOTemplateHref(template);
  const metrics = [
    ["Servers", example ? "1" : "8"],
    ["CPU slots / server", "1"],
    ["Outstanding cap / server", example ? "2" : "8"],
    ["Total requests", example ? "2" : String(template.rate * 2)],
    ["Workload", example ? "1s CPU → 2s I/O → 1s CPU" : template.profile === "io_heavy" ? "10% CPU / 90% I/O" : "90% CPU / 10% I/O"],
    ["Arrival window", example ? "0s and 0.1s" : `2s · ${template.rate} req/s`],
  ];
  return <Card className="min-w-0">
    <CardHeader>
      <CardTitle><Link href={href}>{template.name}</Link></CardTitle>
      <CardAction className="row-span-1"><Badge variant="secondary">Template</Badge></CardAction>
      <CardDescription className="col-span-2">{template.description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{metrics.map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>)}</dl>
      <div className="flex flex-wrap gap-2"><Badge variant="outline">CPU / I/O model</Badge><Badge variant="outline">{example ? "Stage playback" : "Three-policy comparison"}</Badge></div>
    </CardContent>
    <CardFooter className="mt-auto"><Button asChild variant="outline" className="w-full"><Link href={href}>Open CPU/I/O lab</Link></Button></CardFooter>
  </Card>;
}
