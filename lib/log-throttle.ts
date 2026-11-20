type WarningThrottleState = {
  lastLoggedAt: number;
  source: string;
};

export function createWarningThrottle(cooldownMs = 30_000) {
  const states = new Map<string, WarningThrottleState>();

  return (event: string, source: string, now = Date.now()): boolean => {
    const previous = states.get(event);
    const shouldLog = !previous
      || previous.source !== source
      || now - previous.lastLoggedAt >= cooldownMs;

    if (shouldLog) states.set(event, { lastLoggedAt: now, source });
    return shouldLog;
  };
}
