import { app } from "./app.js";
import { cleanupExpiredFiles } from "./services/fileManager.js";
import { pruneExpiredJobs } from "./services/jobService.js";

const PORT = Number(process.env.PORT ?? 3000);
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

async function runCleanupSweep(): Promise<void> {
  try {
    const removed = await cleanupExpiredFiles();
    const pruned = pruneExpiredJobs();
    if (removed > 0 || pruned > 0) {
      console.log(`cleanup: removed ${removed} job dirs, pruned ${pruned} jobs`);
    }
  } catch (err) {
    console.error("cleanup sweep failed:", err);
  }
}

app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});

void runCleanupSweep();
setInterval(() => {
  void runCleanupSweep();
}, CLEANUP_INTERVAL_MS);