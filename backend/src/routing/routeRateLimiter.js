export class InMemoryRouteRateLimiter {
  constructor(options = {}) {
    this.maxCost = positiveInteger(options.maxCost, 30);
    this.windowMs = positiveInteger(options.windowMs, 60_000);
    this.maxEntries = positiveInteger(options.maxEntries, 1_000);
    this.now = options.now ?? Date.now;
    this.entries = new Map();
  }

  consume({ key, cost }) {
    const now = this.now();
    this.prune(now);
    const current = this.entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { cost: 0, resetAt: now + this.windowMs }
      : current;

    if (entry.cost + cost > this.maxCost) {
      this.entries.set(key, entry);
      return { allowed: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
    }

    entry.cost += cost;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.evictOverflow();
    return { allowed: true, remainingCost: this.maxCost - entry.cost };
  }

  prune(now) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  evictOverflow() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }
}

export function routeRequestCost(request) {
  if (request.algorithm === "alternative_route") return request.alternativeRoute.maxPaths;
  if (request.routeType === "loop" || request.preferences) return 2;
  return 1;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
