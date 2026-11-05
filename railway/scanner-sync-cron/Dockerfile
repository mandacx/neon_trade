FROM alpine:3.20
RUN apk add --no-cache curl
# Deployed as the scanner-sync-cron service in the neon-trade-crons Railway project.
# Runs every 15 min on weekdays; /api/cron/scanner-sync enforces the 07:45-15:45 CT window and copies
# new scan alerts from the crypto project's us_scanner into intra_us_scanner_eod.
CMD ["sh", "-c", "curl -sf --max-time 30 -H \"Authorization: Bearer $CRON_SECRET\" https://us.niftytrendz.com/api/cron/scanner-sync"]
