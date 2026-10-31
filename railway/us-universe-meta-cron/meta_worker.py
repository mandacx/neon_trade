"""Weekly sector / industry / market-cap / fundamentals refresh for the US scanner universe.

Deployed as the us-universe-meta-cron service (Railway, neon-trade-crons). It has no database
credentials: it asks the app which stocks need metadata, looks them up on Yahoo Finance (yfinance)
and posts the results back (app/api/cron/us-universe-meta, lib/usUniverse.ts applyMeta).

Env: CRON_SECRET (required), APP_URL (default https://us.niftytrendz.com), MAX_MINUTES (default 40).
Run locally against a dev server:  APP_URL=http://localhost:3000 python -I meta_worker.py
"""
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

APP_URL = os.environ.get("APP_URL", "https://us.niftytrendz.com").rstrip("/")
SECRET = os.environ.get("CRON_SECRET", "")
MAX_SECONDS = float(os.environ.get("MAX_MINUTES", "40")) * 60
BATCH = 50


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{APP_URL}{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={"Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def finite(v):
    # NaN / Infinity (or the string "Infinity") would not survive JSON: send None instead.
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def fetch(symbol):
    # Yahoo spells share classes with a dash (BRK-B); our symbols use a dot.
    ysym = symbol.replace(".", "-")
    err = ""
    for attempt in range(4):  # Yahoo rate-limits (429): back off and retry
        try:
            info = yf.Ticker(ysym).info or {}
            if not info.get("quoteType"):
                return symbol, {"error": "unknown to the metadata source"}
            return symbol, {
                "name": info.get("longName") or info.get("shortName"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "marketCap": info.get("marketCap"),
                # Fundamentals (missing = None; the P/E is absent for loss-makers). debtToEquity is in percent.
                "fundamentals": {
                    "peTrailing": finite(info.get("trailingPE")),
                    "peForward": finite(info.get("forwardPE")),
                    "epsTtm": finite(info.get("trailingEps")),
                    "totalDebt": finite(info.get("totalDebt")),
                    "totalCash": finite(info.get("totalCash")),
                    "debtToEquity": finite(info.get("debtToEquity")),
                    "profitMargin": finite(info.get("profitMargins")),
                },
            }
        except Exception as e:  # noqa: BLE001 - any failure is retried, then reported
            err = str(e)[:200]
            if "404" in err:
                break
            time.sleep(3 * (attempt + 1))
    return symbol, {"error": err or "lookup failed"}


def main():
    if not SECRET:
        print("CRON_SECRET is not set", file=sys.stderr)
        sys.exit(1)
    started = time.time()
    total = errors = 0
    seen = set()
    while time.time() - started < MAX_SECONDS:
        symbols = [s for s in call("GET", f"/api/cron/us-universe-meta?limit={BATCH}")["data"]["symbols"] if s not in seen]
        if not symbols:
            break
        seen.update(symbols)
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = dict(pool.map(fetch, symbols))
        res = call("POST", "/api/cron/us-universe-meta", {"results": results})["data"]
        total += res["updated"]
        errors += res["errors"]
        print(f"batch of {len(symbols)}: updated {res['updated']}, errors {res['errors']}, top1000 {res.get('top1000')}", flush=True)
    print(f"done: {total} updated, {errors} errors in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
