"""Fetch market cap and basic profile from Yahoo Finance (yfinance) for a symbol list.

Used by scripts/refresh-securities.mjs, which does the database work. Usage:

    python -I scripts/fetch-market-caps.py symbols.txt out.json

symbols.txt: one symbol per line. out.json: {SYMBOL: {name, marketCap, sector,
industry, exchange, currency, quoteType} | {"error": "..."}}.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

FIELDS = {
    "name": "longName",
    "marketCap": "marketCap",
    "sector": "sector",
    "industry": "industry",
    "exchange": "exchange",
    "currency": "currency",
    "quoteType": "quoteType",
}


def fetch(symbol: str):
    # Yahoo spells share classes with a dash (BRK-B); our symbols use a dot.
    ysym = symbol.replace(".", "-")
    err = ""
    for attempt in range(4):  # Yahoo rate-limits (429); back off and retry
        try:
            info = yf.Ticker(ysym).info or {}
            return symbol, {k: info.get(v) for k, v in FIELDS.items()}
        except Exception as e:
            err = str(e)[:200]
            if "404" in err:  # unknown to Yahoo (indices etc.): don't retry
                break
            time.sleep(3 * (attempt + 1))
    return symbol, {"error": err}


def main():
    symbols = [s.strip().upper() for s in open(sys.argv[1]) if s.strip()]
    with ThreadPoolExecutor(max_workers=3) as pool:
        out = dict(pool.map(fetch, symbols))
    with open(sys.argv[2], "w") as f:
        json.dump(out, f)
    errs = sum(1 for v in out.values() if "error" in v)
    print(f"fetched {len(out)} symbols, {errs} errors")


if __name__ == "__main__":
    main()
