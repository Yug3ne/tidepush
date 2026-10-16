-- Plans, until payments exist: one boolean per org.
--
-- When the deployment runs in hosted mode (TIDEPUSH_MODE=hosted), orgs that
-- aren't subscribed get the free plan's limits (see src/billing.ts). Self-hosted
-- deployments have no limits. Phones always get updates; only publishing and
-- creating apps are ever refused.
ALTER TABLE orgs ADD COLUMN subscribed INTEGER NOT NULL DEFAULT 0;
-- When the org first went over a limit this month; publishing pauses 7 days later.
ALTER TABLE orgs ADD COLUMN over_limit_since TEXT;

-- One row per device per app per calendar month (UTC): the monthly active
-- devices that plans are measured in.
CREATE TABLE device_months (
  app_id TEXT NOT NULL,
  month TEXT NOT NULL,
  client_id TEXT NOT NULL,
  PRIMARY KEY (app_id, month, client_id)
);
