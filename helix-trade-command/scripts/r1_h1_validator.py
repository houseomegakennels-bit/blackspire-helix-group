#!/usr/bin/env python3
import argparse
import csv
import json
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
MINTICK = 0.0001
MIN_SWEEP_TICKS = 1
DISPLACEMENT_MULT = 1.5
MIN_COVERAGE = 0.85
EXPECTED = {"asia": 48, "london": 24, "ny": 36}


def pct(wins, n):
    return None if n == 0 else 100.0 * wins / n


def wilson(wins, n):
    if n <= 0:
        return (None, None)
    z = 1.959963984540054
    p = wins / n
    z2 = z * z
    den = 1.0 + z2 / n
    center = (p + z2 / (2.0 * n)) / den
    margin = z * math.sqrt((p * (1.0 - p) + z2 / (4.0 * n)) / n) / den
    return (100.0 * (center - margin), 100.0 * (center + margin))


def status(wins, n):
    lo, _ = wilson(wins, n)
    p = pct(wins, n)
    if n < 30:
        return "PROVISIONAL"
    return "PASS" if p is not None and p >= 55.0 and lo > 50.0 else "FAIL"


def load_csv(path):
    rows = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            dt_utc = datetime.fromisoformat(row["datetime"]).replace(tzinfo=timezone.utc)
            rows.append(
                {
                    "dt_utc": dt_utc,
                    "dt_et": dt_utc.astimezone(TZ),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                }
            )
    return rows


def validate(rows, mintick=MINTICK, validation_start=None):
    bodies = [abs(r["close"] - r["open"]) for r in rows]
    counts = {
        "raw_days": 0,
        "complete_days": 0,
        "excluded_missing_session": 0,
        "excluded_short_session": 0,
        "excluded_double_london_sweep": 0,
        "london_single_sweep_candidates": 0,
        "ny_confirmed_events": 0,
        "successes": 0,
        "no_event_after_candidate": 0,
        "ambiguous_ny_bar": 0,
    }
    days = []

    prev_asia = prev_london = prev_ny = False
    asia_hi = asia_lo = None
    asia_done = False
    asia_bars = london_bars = ny_bars = 0
    lon_sweep_hi = lon_sweep_lo = False
    cycle_start = None
    ny_open = ny_close = None
    ny_same_side_sweep_bar = ny_mss_bar = ny_disp_bar = None
    ny_ambiguous = False
    last_swing_hi = last_swing_lo = None
    mss_level = None
    day_finalized = False

    for i, row in enumerate(rows):
        hour = row["dt_et"].hour
        in_asia = hour >= 20
        in_london = 3 <= hour < 5
        in_ny = 7 <= hour < 10
        new_asia = in_asia and not prev_asia
        asia_just_ended = (not in_asia) and prev_asia
        new_ny = in_ny and not prev_ny
        ny_just_ended = (not in_ny) and prev_ny

        if new_asia:
            cycle_start = row["dt_et"]
            asia_hi = row["high"]
            asia_lo = row["low"]
            asia_done = False
            asia_bars = london_bars = ny_bars = 0
            lon_sweep_hi = lon_sweep_lo = False
            ny_open = ny_close = None
            ny_same_side_sweep_bar = ny_mss_bar = ny_disp_bar = None
            ny_ambiguous = False
            last_swing_hi = last_swing_lo = None
            mss_level = None
            day_finalized = False

        if in_asia:
            asia_bars += 1
            asia_hi = row["high"] if asia_hi is None else max(asia_hi, row["high"])
            asia_lo = row["low"] if asia_lo is None else min(asia_lo, row["low"])

        if asia_just_ended and asia_hi is not None and asia_lo is not None:
            asia_done = True

        if in_london:
            london_bars += 1
            if asia_done:
                if row["high"] >= asia_hi + MIN_SWEEP_TICKS * mintick and row["close"] <= asia_hi:
                    lon_sweep_hi = True
                if row["low"] <= asia_lo - MIN_SWEEP_TICKS * mintick and row["close"] >= asia_lo:
                    lon_sweep_lo = True

        if i >= 2:
            p1, p2 = rows[i - 1], rows[i - 2]
            if p1["high"] > p2["high"] and p1["high"] > row["high"]:
                last_swing_hi = p1["high"]
            if p1["low"] < p2["low"] and p1["low"] < row["low"]:
                last_swing_lo = p1["low"]

        single_london = lon_sweep_hi != lon_sweep_lo
        swept_side = -1 if lon_sweep_hi and not lon_sweep_lo else (1 if lon_sweep_lo and not lon_sweep_hi else 0)

        if new_ny:
            ny_open = row["open"]
            ny_close = row["open"]

        if in_ny:
            ny_bars += 1
            ny_close = row["close"]
            sweep_hi = asia_hi is not None and row["high"] > asia_hi and row["close"] <= asia_hi
            sweep_lo = asia_lo is not None and row["low"] < asia_lo and row["close"] >= asia_lo
            if sweep_hi and sweep_lo:
                ny_ambiguous = True
            if single_london and ny_same_side_sweep_bar is None and not ny_ambiguous:
                if swept_side == -1 and sweep_hi:
                    ny_same_side_sweep_bar = i
                    mss_level = last_swing_lo
                elif swept_side == 1 and sweep_lo:
                    ny_same_side_sweep_bar = i
                    mss_level = last_swing_hi

            if ny_same_side_sweep_bar is not None and ny_mss_bar is None and mss_level is not None and i > ny_same_side_sweep_bar:
                if swept_side == -1 and row["close"] < mss_level:
                    ny_mss_bar = i
                elif swept_side == 1 and row["close"] > mss_level:
                    ny_mss_bar = i

            median20 = statistics.median(bodies[i - 20 : i]) if i >= 20 else None
            body = bodies[i]
            bearish_disp = row["close"] < row["open"] and median20 is not None and body >= DISPLACEMENT_MULT * median20
            bullish_disp = row["close"] > row["open"] and median20 is not None and body >= DISPLACEMENT_MULT * median20
            if ny_mss_bar is not None and ny_disp_bar is None and i >= ny_mss_bar:
                if swept_side == -1 and bearish_disp:
                    ny_disp_bar = i
                elif swept_side == 1 and bullish_disp:
                    ny_disp_bar = i

        if ny_just_ended and not day_finalized:
            day_finalized = True
            counts["raw_days"] += 1
            missing = asia_bars == 0 or london_bars == 0 or ny_bars == 0
            short = (not missing) and (
                asia_bars < math.ceil(EXPECTED["asia"] * MIN_COVERAGE)
                or london_bars < math.ceil(EXPECTED["london"] * MIN_COVERAGE)
                or ny_bars < math.ceil(EXPECTED["ny"] * MIN_COVERAGE)
            )
            in_validation = validation_start is None or (cycle_start is not None and cycle_start.date() >= validation_start.date())
            record = {
                "cycle_start_et": cycle_start.isoformat() if cycle_start else None,
                "asia_bars": asia_bars,
                "london_bars": london_bars,
                "ny_bars": ny_bars,
                "in_validation": in_validation,
                "london_single_sweep": bool(single_london),
                "swept_side": "HIGH" if swept_side == -1 else ("LOW" if swept_side == 1 else None),
                "ny_confirmed": False,
                "success": None,
                "reason": None,
            }
            if not in_validation:
                record["reason"] = "pre_validation_start"
            elif missing:
                counts["excluded_missing_session"] += 1
                record["reason"] = "missing_session"
            elif short:
                counts["excluded_short_session"] += 1
                record["reason"] = "short_session"
            elif lon_sweep_hi and lon_sweep_lo:
                counts["excluded_double_london_sweep"] += 1
                record["reason"] = "double_london_sweep"
            else:
                counts["complete_days"] += 1
                if single_london:
                    counts["london_single_sweep_candidates"] += 1
                    if ny_ambiguous:
                        counts["ambiguous_ny_bar"] += 1
                        counts["no_event_after_candidate"] += 1
                        record["reason"] = "ambiguous_ny_bar"
                    elif ny_same_side_sweep_bar is not None and ny_mss_bar is not None and ny_disp_bar is not None and ny_same_side_sweep_bar < ny_mss_bar <= ny_disp_bar:
                        counts["ny_confirmed_events"] += 1
                        held = (ny_close < ny_open) if swept_side == -1 else (ny_close > ny_open)
                        counts["successes"] += int(held)
                        record["ny_confirmed"] = True
                        record["success"] = bool(held)
                        record["reason"] = "counted_event"
                    else:
                        counts["no_event_after_candidate"] += 1
                        record["reason"] = "candidate_without_full_ny_sequence"
                else:
                    record["reason"] = "no_single_london_sweep"
            days.append(record)

        prev_asia, prev_london, prev_ny = in_asia, in_london, in_ny

    n = counts["ny_confirmed_events"]
    wins = counts["successes"]
    lo, hi = wilson(wins, n)
    return {
        **counts,
        "event_rate_pct_of_candidates": pct(n, counts["london_single_sweep_candidates"]),
        "success_pct": pct(wins, n),
        "wilson95": [lo, hi],
        "status": status(wins, n),
        "first_utc": rows[0]["dt_utc"].isoformat() if rows else None,
        "last_utc": rows[-1]["dt_utc"].isoformat() if rows else None,
        "validation_start": validation_start.isoformat() if validation_start else None,
        "days": days,
    }


def main():
    ap = argparse.ArgumentParser(description="Validate preregistered Helix R1-H1 research events on 5-minute CME CSV data.")
    ap.add_argument("csv")
    ap.add_argument("--mintick", type=float, default=MINTICK)
    ap.add_argument("--validation-start", help="ISO date/time; days before this are retained only as debug records")
    ap.add_argument("--json-out")
    args = ap.parse_args()
    validation_start = datetime.fromisoformat(args.validation_start) if args.validation_start else None
    rows = load_csv(args.csv)
    result = validate(rows, mintick=args.mintick, validation_start=validation_start)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, indent=2))
    print(f"range UTC: {result['first_utc']} -> {result['last_utc']}")
    print(f"raw/complete: {result['raw_days']}/{result['complete_days']}")
    print(f"London single-sweep candidates: {result['london_single_sweep_candidates']}")
    print(f"R1-H1 confirmed events: {result['ny_confirmed_events']}")
    print(f"successes: {result['successes']} / {result['ny_confirmed_events']} = {result['success_pct']}")
    print(f"Wilson 95%: {result['wilson95']} status={result['status']}")
    print(f"candidate no-events: {result['no_event_after_candidate']} ambiguous-NY={result['ambiguous_ny_bar']}")


if __name__ == "__main__":
    main()
