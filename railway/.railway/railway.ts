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

  // Earnings sync (lib/earnings.ts). Every 15 min around the clock; the route
  // picks the step by US/Eastern time (calendar + news results on weekdays
  // 06:30–19:30, Alpha Vantage backfill evenings and weekends) and returns
  // without touching the DB outside those windows.
  const earningsCron = service("earnings-cron", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-west2": 1 },
    deploy: { cronSchedule: "*/15 * * * *", restartPolicyType: "NEVER" },
    // Railway reference variable — one CRON_SECRET, owned by market-catalog-cron.
    env: { CRON_SECRET: "${{market-catalog-cron.CRON_SECRET}}" },
  });

  return project("neon-trade-crons", {
    resources: [marketCatalogCron, telegramAlertsCron, earningsCron],
  });
});
