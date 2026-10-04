FROM alpine:3.20
RUN apk add --no-cache curl
# Deployed as the earnings-cron service in the neon-trade-crons Railway project.
# Runs every 15 min; /api/cron/earnings decides which step (calendar / news / AV backfill) is due.
CMD ["sh", "-c", "curl -sf --max-time 70 -H \"Authorization: Bearer $CRON_SECRET\" https://us.niftytrendz.com/api/cron/earnings"]
