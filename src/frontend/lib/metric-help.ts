export const metricHelp = {
  completed: "Requests that finished successfully, including work that drained after a one-shot arrival window.",
  rejected: "Requests the model could not complete. Inspect the run’s outcome breakdown for the cause.",
  retries: "Additional attempts after admission rejection. Each original request still has one final outcome.",
  mean: "Average end-to-end time across completed requests. A fast mean can hide a slow tail.",
  p95: "95% of the measured completions finished in this time or less. Live and regional views use a recent window.",
  rejection: "Rejected requests divided by completed plus rejected requests. Check this alongside latency.",
  utilization: "Share of compute slot time occupied during the arrival window, averaged across servers. It excludes draining.",
} as const;
