// Minimal cron-free scheduler (SpendBot pattern): checks every minute and
// fires jobs when local wall-clock time matches a target HH:MM. Timezone is
// handled via TIMEZONE_OFFSET (hours from UTC) per market — DST is manual.
//
// NOTE: multi-market support means jobs should fire on EACH exchange's clock.
// Here we key offsets per market so EU/US fire at their own open/close.

const MARKET_OFFSET = {
  IDX: Number(process.env.TZ_OFFSET_IDX ?? 7), // WIB
  EU: Number(process.env.TZ_OFFSET_EU ?? 2),   // CET/CEST (manual DST)
  US: Number(process.env.TZ_OFFSET_US ?? -4),  // ET (manual DST)
};

function nowHHMM(offsetHours) {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// jobs: [{ market, time: "HH:MM", run: async () => {} }]
export function startScheduler(jobs) {
  const fired = new Set();
  setInterval(async () => {
    for (const job of jobs) {
      const off = MARKET_OFFSET[job.market] ?? 0;
      const hhmm = nowHHMM(off);
      const key = `${job.market}:${job.time}:${hhmm}`;
      if (hhmm === job.time && !fired.has(key)) {
        fired.add(key);
        setTimeout(() => fired.delete(key), 90 * 1000); // allow re-fire next day
        try {
          await job.run();
        } catch (e) {
          console.error("[scheduler]", job.market, job.time, e.message);
        }
      }
    }
  }, 30 * 1000);
  console.log("[scheduler] started with", jobs.length, "jobs");
}
