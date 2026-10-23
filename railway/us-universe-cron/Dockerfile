FROM alpine:3.20
RUN apk add --no-cache curl
# Deployed as the us-universe-cron service in the neon-trade-crons Railway project (Saturdays; the route resumes).
CMD ["sh", "-c", "curl -sf --max-time 70 -H \"Authorization: Bearer $CRON_SECRET\" https://us.niftytrendz.com/api/cron/us-universe"]
