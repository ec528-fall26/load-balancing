import { defaults, policies, type Config } from "./engine";
export type SavedSetup = {
  id: string;
  name: string;
  config: Config;
  updatedAt: string;
};
export type Template = {
  execution?: "one_shot" | "continuous";
  id: string;
  name: string;
  description: string;
  config: Config;
};
export const LIBRARY_KEY = "lbsim.saved-setups.v1";
export const templates: Template[] = [
  {id:"shared-io-bottleneck",name:"Shared I/O bottleneck",description:"One shared dependency slot creates I/O queueing even while server CPUs are idle.",config:{...defaults,server_count:8,concurrency:1,queue_limit:8,arrival_rate:100,duration:5,service_min:.08,service_max:.12,request_model:"cpu_io",io_fraction:.9,outstanding_limit:8,io_capacity:1,policy:"least_outstanding"}},
  {id:"mixed-cpu-io",name:"Mixed CPU and I/O requests",description:"An identical seeded mix of CPU-heavy and I/O-heavy requests, with a finite shared dependency.",config:{...defaults,server_count:8,concurrency:1,queue_limit:8,arrival_rate:100,duration:5,service_min:.08,service_max:.12,request_model:"cpu_io",io_fraction:.9,outstanding_limit:8,io_capacity:4,io_heavy_probability:.5,policy:"power_of_two"}},

  {id:"cpu-io-walkthrough",name:"CPU to I/O, step by step",description:"Two requests share one CPU. Watch I/O release CPU while admission stays occupied.",config:{...defaults,server_count:1,concurrency:1,queue_limit:1,arrival_rate:10,duration:.2,service_min:4,service_max:4,request_model:"cpu_io",io_fraction:.5,outstanding_limit:2,io_capacity:2}},
  {id:"io-heavy-routing",name:"I/O-heavy routing",description:"Compare CPU-active and outstanding load signals while requests spend 90% of service time on I/O.",config:{...defaults,server_count:8,concurrency:1,queue_limit:8,arrival_rate:400,duration:2,service_min:.08,service_max:.12,request_model:"cpu_io",io_fraction:.9,outstanding_limit:8,io_capacity:8,policy:"least_outstanding"}},
  {id:"cpu-heavy-routing",name:"CPU-heavy routing",description:"Put CPU capacity under pressure and compare rejection and latency with staged requests.",config:{...defaults,server_count:8,concurrency:1,queue_limit:8,arrival_rate:100,duration:2,service_min:.08,service_max:.12,request_model:"cpu_io",io_fraction:.1,outstanding_limit:8,io_capacity:64}},

  {id:"io-heavy-live",name:"Live I/O-heavy traffic",execution:"continuous",description:"Watch CPU, I/O wait and outstanding admission pressure in a continuous run.",config:{...defaults,server_count:8,concurrency:1,queue_limit:8,arrival_rate:400,duration:2,service_min:.08,service_max:.12,request_model:"cpu_io",io_fraction:.9,outstanding_limit:8,io_capacity:8,policy:"least_outstanding"}},
  {id:"cpu-heavy-live",name:"Live CPU-heavy traffic",execution:"continuous",description:"Watch CPU queues form, then change the offered traffic and observe draining.",config:{...defaults,server_count:8,concurrency:1,queue_limit:8,arrival_rate:100,duration:2,service_min:.08,service_max:.12,request_model:"cpu_io",io_fraction:.1,outstanding_limit:8,io_capacity:64,policy:"power_of_two"}},
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
  if (!Object.hasOwn(policies,c.policy))
    return false;
  if(c.request_model!==undefined && !["simple","cpu_io"].includes(c.request_model)) return false;
  if(c.request_model==="cpu_io") {
    if(typeof c.io_fraction!=="number" || !Number.isFinite(c.io_fraction) || c.io_fraction<0 || c.io_fraction>.99 || !Number.isSafeInteger(c.outstanding_limit) || c.outstanding_limit!<1 || c.server_count*c.outstanding_limit!>100000) return false;
    if(c.io_capacity!==undefined && (!Number.isSafeInteger(c.io_capacity)||c.io_capacity<1||c.io_capacity>4096)) return false;
    if(c.io_heavy_probability!==undefined && (typeof c.io_heavy_probability!=="number"||!Number.isFinite(c.io_heavy_probability)||c.io_heavy_probability<0||c.io_heavy_probability>1))return false;
  } else if(c.io_fraction!==undefined || c.outstanding_limit!==undefined || c.io_capacity!==undefined || c.io_heavy_probability!==undefined) return false;
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
