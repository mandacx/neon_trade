FROM alpine:3.20
RUN apk add --no-cache curl
# Deployed as the market-catalog-cron service in the neon-trade-crons Railway project.
CMD ["sh", "-c", "curl -sf -H \"Authorization: Bearer $CRON_SECRET\" https://us.niftytrendz.com/api/cron/market-catalog"]
