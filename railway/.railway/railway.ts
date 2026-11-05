import { defineRailway, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const marketCatalogCron = service("market-catalog-cron", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "0,30 13-17 * * 1-5", limitOverride: { containers: { cpu: 1, memoryBytes: 3000000000 } }, restartPolicyType: "NEVER" },
    env: { CRON_SECRET: preserve() },
  });
  const telegramAlertsCron = service("telegram-alerts-cron", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-west2": 1 },
    // Disabled until Telegram is configured (TELEGRAM_BOT_TOKEN etc. in Vercel).
    // To re-enable: cronSchedule: "*/15 12-21 * * 1-5" (route enforces NYSE hours).
    deploy: { cronSchedule: null, restartPolicyType: "NEVER" },
    env: { CRON_SECRET: preserve() },
  });

  // Earnings sync (lib/earnings.ts, docs/earnings.md). Every 15 min around the
  // clock; the route picks the step by US/Eastern time (AV calendar + Alpaca
  // News results on weekdays 06:30–19:30, news catch-up weekday evenings and
  // weekend mornings) and returns without touching the DB outside those windows.
  const earningsCron = service("earnings-cron", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "*/15 * * * *", restartPolicyType: "NEVER" },
    // Railway reference variable — one CRON_SECRET, owned by market-catalog-cron.
    env: { CRON_SECRET: "${{market-catalog-cron.CRON_SECRET}}" },
  });

  // US scanner universe (lib/usUniverse.ts, docs/us-scanner.md): listings, index flags and the
  // liquidity scan, weekly. Called every 10 min on Saturday morning; the route resumes the paced
  // liquidity scan where it stopped and skips every step once it is under 6 days old.
  const usUniverseCron = service("us-universe-cron", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "*/10 14-16 * * 6", restartPolicyType: "NEVER" },
    env: { CRON_SECRET: "${{market-catalog-cron.CRON_SECRET}}" },
  });

  // Sector / industry / market cap for the universe (yfinance, Python). No DB credentials: it pulls
  // the symbol list from and posts results to /api/cron/us-universe-meta. Sundays, after the universe run.
  const usUniverseMetaCron = service("us-universe-meta-cron", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "0 15 * * 0", restartPolicyType: "NEVER" },
    env: { CRON_SECRET: "${{market-catalog-cron.CRON_SECRET}}" },
  });

  return project("neon-trade-crons", {
    resources: [marketCatalogCron, telegramAlertsCron, earningsCron, usUniverseCron, usUniverseMetaCron],
  });
});
