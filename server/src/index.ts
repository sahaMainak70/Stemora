import { app } from "./app.js";
import { cleanupExpiredFiles } from "./services/fileManager.js";
import {
  pruneExpiredJobs,
  processMixJob,
  processSeparationJob,
} from "./services/jobService.js";
import { closeQueueInfra, startMixWorker, startSeparationWorker } from "./services/queue.js";

const PORT = Number(process.env.PORT ?? 3000);
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

async function runCleanupSweep(): Promise<void> {
  try {
    const removed = await cleanupExpiredFiles();
    const pruned = await pruneExpiredJobs();
    if (removed > 0 || pruned > 0) {
      console.log(`cleanup: removed ${removed} job dirs, pruned ${pruned} jobs`);
    }
  } catch (err) {
    console.error("cleanup sweep failed:", err);
  }
}

const server = app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});

// Start the separation and mix workers. They connect lazily and keep retrying,
// so the API stays up (with graceful 503s) even while Redis is unreachable.
startSeparationWorker((data) => processSeparationJob(data));
startMixWorker((data) => processMixJob(data));

const sweepTimer = setInterval(() => {
  void runCleanupSweep();
}, CLEANUP_INTERVAL_MS);

sweepTimer.unref();
void runCleanupSweep();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down...`);

  clearInterval(sweepTimer);
  server.close();
  // worker.close() stops pulling new jobs and waits for in-flight processing;
  // interrupted work is redelivered by BullMQ's stalled-job mechanism.
  await closeQueueInfra();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));