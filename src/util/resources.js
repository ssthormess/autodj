import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const run = promisify(execFile);

/**
 * Resource usage for the whole app: this process plus mpv.
 *
 * Node's own numbers come from `process.cpuUsage()` deltas and `memoryUsage()`,
 * which are free. mpv has to be measured externally, so it is polled on a
 * slower cadence — sampling a child process once a second with `ps` would make
 * the meter a meaningful share of what it is reporting.
 */
export function createResourceSampler({ pidOf, externalIntervalMs = 4000 } = {}) {
  const cores = os.cpus().length || 1;
  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();

  let external = { cpu: 0, rss: 0, at: 0 };
  let polling = false;

  function self() {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage();
    const elapsedUs = Number(now - lastAt) / 1000;

    const usedUs = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
    lastCpu = cpu;
    lastAt = now;

    return {
      // Percent of one core, matching how `top` reports a single process.
      cpu: elapsedUs > 0 ? Math.max(0, (usedUs / elapsedUs) * 100) : 0,
      rss: process.memoryUsage().rss,
    };
  }

  /** Non-blocking: returns the last known figures and refreshes in background. */
  function externalUsage() {
    const pid = pidOf?.();
    if (!pid) return { cpu: 0, rss: 0 };

    if (!polling && Date.now() - external.at > externalIntervalMs) {
      polling = true;
      run('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], { timeout: 4000 })
        .then(({ stdout }) => {
          const [cpu, rssKb] = stdout.trim().split(/\s+/).map(Number);
          if (Number.isFinite(cpu) && Number.isFinite(rssKb)) {
            external = { cpu, rss: rssKb * 1024, at: Date.now() };
          }
        })
        .catch(() => {})
        .finally(() => { polling = false; });
    }
    return { cpu: external.cpu, rss: external.rss };
  }

  function sample() {
    const mine = self();
    const mpv = externalUsage();
    return {
      cpu: mine.cpu + mpv.cpu,
      rss: mine.rss + mpv.rss,
      node: mine,
      mpv,
      cores,
    };
  }

  return { sample };
}

export const formatBytes = (bytes) => {
  if (!bytes) return '0MB';
  const mb = bytes / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`;
};
