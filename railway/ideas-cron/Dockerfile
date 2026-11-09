FROM alpine:3.20
RUN apk add --no-cache curl
# Deployed as the ideas-cron service in the neon-trade-crons Railway project (docs/trade-ideas.md).
# Runs every 30 min; /api/cron/ideas re-scores live ideas on the daily bars and sends opted-in email alerts. Idempotent.
CMD ["sh", "-c", "curl -sf --max-time 70 -H \"Authorization: Bearer $CRON_SECRET\" https://us.niftytrendz.com/api/cron/ideas"]
