"use client";
import { useEffect, useRef } from "react";
import type { VisualizationSpec } from "vega-embed";
export function Chart({
  spec,
  height = 240,
  label,
}: {
  spec: Record<string, unknown>;
  height?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    import("vega-embed")
      .then(async ({ default: embed }) => {
        if (disposed || !ref.current) return;
        const result = await embed(
          ref.current,
          {
            width: "container",
            height,
            autosize: { type: "fit", contains: "padding" },
            config: {
              font: "Source Sans",
              view: { stroke: null },
              axis: {
                labelFontSize: 12,
                titleFontSize: 12,
                labelColor: "#7c8798",
                titleColor: "#7c8798",
                titleFontWeight: "normal",
                domain: false,
                ticks: false,
                gridColor: "#dfe7f0",
                labelPadding: 16,
                titlePadding: 16,
              },
            },
            ...spec,
          } as VisualizationSpec,
          { actions: false, renderer: "svg" },
        );
        if (disposed) result.finalize();
        else cleanup = () => result.finalize();
      })
      .catch(() => {
        if (ref.current) ref.current.textContent = "Chart unavailable.";
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [spec, height]);
  return (
    <div
      ref={ref}
      className="chart"
      style={{ minHeight: height }}
      role="img"
      aria-label={label}
    />
  );
}
