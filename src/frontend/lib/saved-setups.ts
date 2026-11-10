import { defaults, type Config } from "./engine";
export type SavedSetup = {
  id: string;
  name: string;
  config: Config;
  updatedAt: string;
};
export type Template = {
  id: string;
  name: string;
  description: string;
  config: Config;
};
export const LIBRARY_KEY = "lbsim.saved-setups.v1";
export const templates: Template[] = [
  {
    id: "light-traffic",
    name: "Light traffic",
    description:
      "A small, lightly loaded pool. A good place to learn the controls.",
    config: { ...defaults },
  },
  {
    id: "queue-pressure",
    name: "Queue pressure",
    description:
      "Overload a small pool and watch execution, waiting, and rejections.",
    config: {
      ...defaults,
      server_count: 4,
      concurrency: 2,
      queue_limit: 8,
      arrival_rate: 50,
      duration: 20,
    },
  },
  {
    id: "mixed-speed",
    name: "Mixed-speed servers",
    description:
      "Compare routing with slower and faster servers in the same pool.",
    config: {
      ...defaults,
      server_count: 6,
      concurrency: 2,
      queue_limit: 10,
      arrival_rate: 20,
      duration: 30,
      policy: "least_active_requests",
      processing_rates: [0.5, 0.5, 1, 1, 2, 2],
    },
  },
  {
    id: "large-pool",
    name: "Larger pool",
    description: "Inspect how work is distributed across 100 servers.",
    config: {
      ...defaults,
      server_count: 100,
      concurrency: 4,
      queue_limit: 8,
      arrival_rate: 1000,
      duration: 30,
    },
  },
  {
    id: "thousand-server-fleet",
    name: "1,000-server fleet",
    description:
      "Run 100,000 requests across 1,000 servers with 4,000 execution slots.",
    config: {
      ...defaults,
      server_count: 1000,
      concurrency: 4,
      queue_limit: 8,
      arrival_rate: 5000,
      duration: 20,
    },
  },
  {
    id: "large-overload",
    name: "100k-request overload",
    description:
      "Send 100,000 requests into a 100-server pool to expose queue saturation and rejection.",
    config: {
      ...defaults,
      server_count: 100,
      concurrency: 4,
      queue_limit: 16,
      arrival_rate: 5000,
      duration: 20,
    },
  },
];
const numericKeys = [
  "server_count",
  "concurrency",
  "queue_limit",
  "arrival_rate",
  "duration",
  "service_min",
  "service_max",
  "seed",
] as const;
export function validConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object") return false;
  const c = value as Config;
  if (
    !numericKeys.every((k) => typeof c[k] === "number" && Number.isFinite(c[k]))
  )
    return false;
  if (
    ![c.server_count, c.concurrency, c.queue_limit, c.seed].every(
      Number.isSafeInteger,
    )
  )
    return false;
  if (
    c.server_count < 1 ||
    c.server_count > 1000 ||
    c.concurrency < 1 ||
    c.server_count * c.concurrency > 4096 ||
    c.queue_limit < 0 ||
    c.server_count * c.queue_limit > 100000
  )
    return false;
  if (
    c.arrival_rate < 0 ||
    c.duration <= 0 ||
    c.service_min <= 0 ||
    c.service_max < c.service_min ||
    Math.floor(c.arrival_rate * c.duration) > 100000
  )
    return false;
  if (c.policy !== "round_robin" && c.policy !== "least_active_requests")
    return false;
  return (
    c.processing_rates === undefined ||
    (Array.isArray(c.processing_rates) &&
      c.processing_rates.length === c.server_count &&
      c.processing_rates.every(
        (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
      ))
  );
}
export function readSetups(): SavedSetup[] {
  const raw = localStorage.getItem(LIBRARY_KEY);
  if (raw === null) return [];
  if (raw.length > 512000)
    throw new Error(
      "Saved setup data is too large to read. Existing data has been left unchanged.",
    );
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Saved setups could not be read. Existing browser data has been left unchanged.",
    );
  }
  const envelope = data as { version?: unknown; items?: unknown };
  if (
    !envelope ||
    envelope.version !== 1 ||
    !Array.isArray(envelope.items) ||
    envelope.items.length > 100
  )
    throw new Error(
      "This saved-setup format is not supported. Existing browser data has been left unchanged.",
    );
  const seen = new Set<string>();
  for (const item of envelope.items) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 100 ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 80 ||
      typeof item.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(item.updatedAt)) ||
      !validConfig(item.config)
    )
      throw new Error(
        "A saved setup is invalid. Existing browser data has been left unchanged.",
      );
    seen.add(item.id);
  }
  return [...envelope.items].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}
function writeSetups(items: SavedSetup[]) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ version: 1, items }));
  } catch {
    throw new Error(
      "Could not save changes in this browser. Storage may be full or disabled. Your previous saves have not been replaced.",
    );
  }
}
export function saveSetup(
  name: string,
  config: Config,
  id?: string,
): SavedSetup {
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 80)
    throw new Error("Give this setup a name of 1–80 characters.");
  if (!validConfig(config))
    throw new Error(
      "Enter a valid configuration within the Python API limits before saving.",
    );
  const items = readSetups(),
    existing = id ? items.find((i) => i.id === id) : undefined;
  if (id && !existing)
    throw new Error("This save no longer exists. Choose Save a copy instead.");
  if (!existing && items.length >= 100)
    throw new Error(
      "This browser holds 100 saves. Remove one before saving another.",
    );
  const result: SavedSetup = {
    id: existing?.id ?? crypto.randomUUID(),
    name: cleaned,
    config: JSON.parse(JSON.stringify(config)),
    updatedAt: new Date().toISOString(),
  };
  writeSetups([result, ...items.filter((i) => i.id !== result.id)]);
  return result;
}
export function deleteSetup(id: string) {
  writeSetups(readSetups().filter((i) => i.id !== id));
}
