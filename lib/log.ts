// Lightweight failure logging for cron/admin routes.
// No external alerting yet — this just makes failures grep-able in Vercel
// function logs (search "[cron-fail]") instead of only living in a JSON
// response body nobody reads.
export function logCronFailure(route: string, message: string, detail?: unknown) {
  console.error(`[cron-fail] ${route}: ${message}`, detail ?? "");
}
