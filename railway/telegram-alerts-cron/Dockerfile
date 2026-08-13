FROM alpine:3.20
RUN apk add --no-cache curl
# TODO: replace with the actual deployed Vercel domain before deploying this Railway cron.
CMD ["sh", "-c", "curl -sf -H \"Authorization: Bearer $CRON_SECRET\" https://YOUR-NEON-TRADE-DOMAIN.vercel.app/api/cron/telegram-alerts"]
