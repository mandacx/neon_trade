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
    deploy: { cronSchedule: "*/15 12-21 * * 1-5", restartPolicyType: "NEVER" },
    env: { CRON_SECRET: preserve() },
  });

  return project("neon-trade-crons", {
    resources: [marketCatalogCron, telegramAlertsCron],
  });
});
