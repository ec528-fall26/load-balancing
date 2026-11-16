import { useRef, useState } from "react";
import { engineRequest, type Config, type Run } from "@/lib/engine";

export function useSavedRunTools(
  openRun: (
    request: () => Promise<Run>,
    onError: (message: string) => void,
  ) => Promise<void>,
) {
  const csvFiles = useRef<[string, string]>(["", ""]);
  const uploadVersions = useRef([0, 0]);
  const comparisonVersion = useRef(0);
  const [saved, setSaved] = useState<{ text: string; config: Config } | null>(null);
  const [savedName, setSavedName] = useState("");
  const [replayError, setReplayError] = useState("");
  const [comparison, setComparison] = useState<[Run, Run] | null>(null);
  const [fileNames, setFileNames] = useState<[string, string]>(["", ""]);
  const [compareError, setCompareError] = useState("");

  function replay() {
    if (saved === null) return;
    setReplayError("");
    return openRun(
      () => engineRequest<Run>("replay", { configuration: saved.text }),
      setReplayError,
    );
  }

  async function readConfig(file: File) {
    try {
      if (file.size > 60 * 1024) throw new Error("Configuration exceeds 60 KiB.");
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.config || typeof data.config !== "object")
        throw new Error(
          "Choose a configuration export containing a config object.",
        );
      setSaved({ text, config: data.config });
      setSavedName(file.name);
      setReplayError("");
    } catch (error) {
      setSaved(null);
      setSavedName("");
      setReplayError((error as Error).message);
    }
  }
  async function readCsv(file: File, index: number) {
    const uploadVersion = ++uploadVersions.current[index];
    ++comparisonVersion.current;
    csvFiles.current[index] = "";
    let activeComparison: number | undefined;
    setComparison(null);
    setCompareError("");
    setFileNames((current) => {
      const names: [string, string] = [...current];
      names[index] = "";
      return names;
    });
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Results exceed 5 MiB.");
      const text = await file.text();
      if (uploadVersion !== uploadVersions.current[index]) return;
      // File reads may finish together before React rerenders the other handler.
      const next: [string, string] = [...csvFiles.current];
      next[index] = text;
      csvFiles.current = next;
      setFileNames((current) => {
        const names: [string, string] = [...current];
        names[index] = file.name;
        return names;
      });
      setComparison(null);
      setCompareError("");
      if (next.every(Boolean)) {
        const version = ++comparisonVersion.current;
        activeComparison = version;
        const result = await engineRequest<[Run, Run]>("compare", {
          results: next,
        });
        if (version === comparisonVersion.current) setComparison(result);
      }
    } catch (error) {
      if (
        uploadVersion === uploadVersions.current[index] &&
        (activeComparison === undefined ||
          activeComparison === comparisonVersion.current)
      )
        setCompareError((error as Error).message);
    }
  }

  return {
    saved, savedName, replayError, replay, readConfig, readCsv,
    fileNames, comparison, compareError,
  };
}
