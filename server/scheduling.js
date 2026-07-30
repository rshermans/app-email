export const MAX_SAFE_TIMEOUT = 2_147_000_000;

export function nextScheduleDelay(scheduledAt, now = Date.now()) {
  const targetTime = scheduledAt ? new Date(scheduledAt).getTime() : now;
  const remaining = Math.max(0, targetTime - now);
  return {
    targetTime,
    due: remaining === 0,
    delay: Math.min(remaining, MAX_SAFE_TIMEOUT)
  };
}
