#!/usr/bin/env python3
import csv, math, statistics, json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

TZ = ZoneInfo('America/New_York')
MINTICK = 0.0001
MIN_SWEEP_TICKS = 1
DISPLACEMENT_MULT = 1.5
EXPECTED = {'asia': 48, 'london': 24, 'ny': 36}
MIN_COVERAGE = 0.85


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
        return 'PROVISIONAL'
    return 'PASS' if p is not None and p >= 55.0 and lo > 50.0 else 'FAIL'


def percentile(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    idx = math.ceil((q / 100.0) * len(s)) - 1
    idx = max(0, min(len(s) - 1, idx))
    return s[idx]


def mean(vals):
    return None if not vals else sum(vals) / len(vals)


def fmt(x, digits=1):
    return 'NaN' if x is None else f'{x:.{digits}f}'


def load_csv(path):
    rows = []
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            dt_utc = datetime.fromisoformat(r['datetime']).replace(tzinfo=timezone.utc)
            rows.append({
                'dt_utc': dt_utc,
                'dt_et': dt_utc.astimezone(TZ),
                'open': float(r['open']), 'high': float(r['high']),
                'low': float(r['low']), 'close': float(r['close']),
                'volume': int(float(r['volume'])),
            })
    return rows


def validate(rows, mintick=MINTICK):
    bodies = [abs(r['close'] - r['open']) for r in rows]
    prev_asia = prev_london = prev_ny = False

    asia_hi = asia_lo = asia_range_ticks = None
    asia_done = False
    asia_bars = london_bars = ny_bars = 0
    lon_sweep_hi = lon_sweep_lo = False
    lon_break_hi = lon_break_lo = False
    lon_touched_hi = lon_touched_lo = False
    max_sweep_ticks = 0.0
    london_class = 'AMBIGUOUS'
    ny_open = ny_close = None
    ny_sweep_bar = ny_mss_bar = ny_disp_bar = None
    ny_sweep_dir = 0
    mss_level = last_swing_hi = last_swing_lo = None
    day_finalized = False
    cycle_start = None

    counters = {k: 0 for k in [
        'rawDays','validDays','excludedDays','excludedWrongTf','excludedMissingSession',
        'excludedShortSession','excludedAmbiguousLondon','excludedAmbiguousNySweep',
        'bSequenceFailures','nA','nAHeld','nB','nBHeld']}
    sweep_samples, asia_range_samples = [], []
    scenario_ranges, scenario_kinds, scenario_wins = [], [], []
    days = []

    for i, r in enumerate(rows):
        hour = r['dt_et'].hour
        in_asia = hour >= 20
        in_london = 3 <= hour < 5
        in_ny = 7 <= hour < 10
        new_asia = in_asia and not prev_asia
        asia_just_ended = (not in_asia) and prev_asia
        lon_just_ended = (not in_london) and prev_london
        new_ny = in_ny and not prev_ny
        ny_just_ended = (not in_ny) and prev_ny

        if new_asia:
            cycle_start = r['dt_et']
            asia_hi, asia_lo = r['high'], r['low']
            asia_range_ticks = None
            asia_done = False
            asia_bars = london_bars = ny_bars = 0
            lon_sweep_hi = lon_sweep_lo = False
            lon_break_hi = lon_break_lo = False
            lon_touched_hi = lon_touched_lo = False
            max_sweep_ticks = 0.0
            london_class = 'AMBIGUOUS'
            ny_open = ny_close = None
            ny_sweep_bar = ny_mss_bar = ny_disp_bar = None
            ny_sweep_dir = 0
            mss_level = None
            last_swing_hi = last_swing_lo = None
            day_finalized = False

        if in_asia:
            asia_bars += 1
            asia_hi = r['high'] if asia_hi is None else max(asia_hi, r['high'])
            asia_lo = r['low'] if asia_lo is None else min(asia_lo, r['low'])

        if asia_just_ended and asia_hi is not None and asia_lo is not None:
            asia_done = True
            asia_range_ticks = (asia_hi - asia_lo) / mintick

        if in_london:
            london_bars += 1

        if in_london and asia_done:
            above = r['high'] > asia_hi
            below = r['low'] < asia_lo
            lon_touched_hi = lon_touched_hi or above
            lon_touched_lo = lon_touched_lo or below
            if above:
                if r['close'] > asia_hi:
                    lon_break_hi = True
                elif r['high'] >= asia_hi + MIN_SWEEP_TICKS * mintick:
                    lon_sweep_hi = True
                    max_sweep_ticks = max(max_sweep_ticks, (r['high'] - asia_hi) / mintick)
            if below:
                if r['close'] < asia_lo:
                    lon_break_lo = True
                elif r['low'] <= asia_lo - MIN_SWEEP_TICKS * mintick:
                    lon_sweep_lo = True
                    max_sweep_ticks = max(max_sweep_ticks, (asia_lo - r['low']) / mintick)

        if lon_just_ended:
            any_break = lon_break_hi or lon_break_lo
            both_sweep = lon_sweep_hi and lon_sweep_lo
            if both_sweep:
                london_class = 'LONDON_DOUBLE_SWEEP'
            elif lon_break_hi and not lon_break_lo:
                london_class = 'LONDON_BREAK_HIGH'
            elif lon_break_lo and not lon_break_hi:
                london_class = 'LONDON_BREAK_LOW'
            elif lon_sweep_hi and not lon_sweep_lo and not any_break:
                london_class = 'A_HIGH_SWEEP'
            elif lon_sweep_lo and not lon_sweep_hi and not any_break:
                london_class = 'A_LOW_SWEEP'
            elif not lon_touched_hi and not lon_touched_lo and not any_break:
                london_class = 'LONDON_NO_TOUCH'
            else:
                london_class = 'AMBIGUOUS'
            if (lon_sweep_hi or lon_sweep_lo) and max_sweep_ticks > 0:
                sweep_samples.append(max_sweep_ticks)

        if i >= 2:
            p1, p2 = rows[i-1], rows[i-2]
            if p1['high'] > p2['high'] and p1['high'] > r['high']:
                last_swing_hi = p1['high']
            if p1['low'] < p2['low'] and p1['low'] < r['low']:
                last_swing_lo = p1['low']

        if new_ny:
            ny_open = r['open']
            ny_close = r['open']

        if in_ny:
            ny_bars += 1
            ny_close = r['close']
            sweep_hi_now = asia_hi is not None and r['high'] > asia_hi and r['close'] <= asia_hi
            sweep_lo_now = asia_lo is not None and r['low'] < asia_lo and r['close'] >= asia_lo
            if ny_sweep_bar is None:
                if sweep_hi_now and not sweep_lo_now:
                    ny_sweep_bar, ny_sweep_dir, mss_level = i, -1, last_swing_lo
                elif sweep_lo_now and not sweep_hi_now:
                    ny_sweep_bar, ny_sweep_dir, mss_level = i, 1, last_swing_hi
                elif sweep_hi_now and sweep_lo_now:
                    ny_sweep_bar, ny_sweep_dir = i, 9

            if ny_sweep_bar is not None and ny_sweep_dir == -1 and ny_mss_bar is None and mss_level is not None and i > ny_sweep_bar and r['close'] < mss_level:
                ny_mss_bar = i
            if ny_sweep_bar is not None and ny_sweep_dir == 1 and ny_mss_bar is None and mss_level is not None and i > ny_sweep_bar and r['close'] > mss_level:
                ny_mss_bar = i

            median20 = statistics.median(bodies[i-20:i]) if i >= 20 else None
            body = bodies[i]
            bear_disp = r['close'] < r['open'] and median20 is not None and body >= DISPLACEMENT_MULT * median20
            bull_disp = r['close'] > r['open'] and median20 is not None and body >= DISPLACEMENT_MULT * median20
            if ny_mss_bar is not None and ny_disp_bar is None and i >= ny_mss_bar:
                if ny_sweep_dir == -1 and bear_disp:
                    ny_disp_bar = i
                if ny_sweep_dir == 1 and bull_disp:
                    ny_disp_bar = i

        if ny_just_ended and not day_finalized:
            day_finalized = True
            counters['rawDays'] += 1
            missing = asia_bars == 0 or london_bars == 0 or ny_bars == 0
            short = (not missing) and (
                asia_bars < math.ceil(EXPECTED['asia'] * MIN_COVERAGE) or
                london_bars < math.ceil(EXPECTED['london'] * MIN_COVERAGE) or
                ny_bars < math.ceil(EXPECTED['ny'] * MIN_COVERAGE))
            double_london = lon_sweep_hi and lon_sweep_lo
            a_candidate = lon_sweep_hi != lon_sweep_lo
            b_candidate = not lon_sweep_hi and not lon_sweep_lo
            ambiguous_ny = ny_sweep_dir == 9
            scenario_candidate = a_candidate or b_candidate
            rec = {
                'cycle_start_et': cycle_start.isoformat() if cycle_start else None,
                'finalized_et': r['dt_et'].isoformat(),
                'asiaBars': asia_bars, 'londonBars': london_bars, 'nyBars': ny_bars,
                'londonClass': london_class, 'lonSweepHi': lon_sweep_hi, 'lonSweepLo': lon_sweep_lo,
                'asiaRangeTicks': asia_range_ticks, 'scenario': None, 'success': None, 'exclusion': None,
            }
            if missing:
                counters['excludedDays'] += 1; counters['excludedMissingSession'] += 1; rec['exclusion'] = 'missing_session'
            elif short:
                counters['excludedDays'] += 1; counters['excludedShortSession'] += 1; rec['exclusion'] = 'short_session'
            elif double_london:
                counters['excludedDays'] += 1; counters['excludedAmbiguousLondon'] += 1; rec['exclusion'] = 'double_london_sweep'
            elif ambiguous_ny:
                counters['excludedDays'] += 1; counters['excludedAmbiguousNySweep'] += 1; rec['exclusion'] = 'ambiguous_ny_sweep'
            elif scenario_candidate:
                counters['validDays'] += 1
                asia_range_samples.append(asia_range_ticks)
                if a_candidate:
                    counters['nA'] += 1
                    expected_bearish = lon_sweep_hi
                    held = (ny_close < ny_open) if expected_bearish else (ny_close > ny_open)
                    counters['nAHeld'] += int(held)
                    scenario_ranges.append(asia_range_ticks); scenario_kinds.append(1); scenario_wins.append(int(held))
                    rec['scenario'], rec['success'] = 'A', bool(held)
                else:
                    counters['nB'] += 1
                    seq = (ny_sweep_bar is not None and ny_sweep_dir in (-1,1) and ny_mss_bar is not None and ny_disp_bar is not None and ny_sweep_bar < ny_mss_bar <= ny_disp_bar)
                    opposing = False
                    if mss_level is not None:
                        opposing = (ny_close < mss_level) if ny_sweep_dir == -1 else ((ny_close > mss_level) if ny_sweep_dir == 1 else False)
                    held = seq and opposing
                    counters['nBHeld'] += int(held)
                    if not seq:
                        counters['bSequenceFailures'] += 1
                    scenario_ranges.append(asia_range_ticks); scenario_kinds.append(2); scenario_wins.append(int(held))
                    rec.update({'scenario':'B','success':bool(held),'seqComplete':bool(seq),'nySweepDir':ny_sweep_dir})
            days.append(rec)

        prev_asia, prev_london, prev_ny = in_asia, in_london, in_ny

    def quartiles(kind):
        total = sum(1 for k in scenario_kinds if k == kind)
        if total < 4 or len(asia_range_samples) < 4:
            return None
        q25, q50, q75 = percentile(asia_range_samples,25), percentile(asia_range_samples,50), percentile(asia_range_samples,75)
        qn=[0]*4; qw=[0]*4
        for r,k,w in zip(scenario_ranges,scenario_kinds,scenario_wins):
            if k != kind: continue
            q = 0 if r <= q25 else 1 if r <= q50 else 2 if r <= q75 else 3
            qn[q]+=1; qw[q]+=w
        return [{'n':qn[i], 'wins':qw[i], 'pct':pct(qw[i],qn[i])} for i in range(4)]

    alo, ahi = wilson(counters['nAHeld'], counters['nA'])
    blo, bhi = wilson(counters['nBHeld'], counters['nB'])
    result = {
        **counters,
        'aPct': pct(counters['nAHeld'], counters['nA']), 'aWilson95':[alo,ahi], 'aStatus':status(counters['nAHeld'],counters['nA']),
        'bPct': pct(counters['nBHeld'], counters['nB']), 'bWilson95':[blo,bhi], 'bStatus':status(counters['nBHeld'],counters['nB']),
        'q4SweepN':len(sweep_samples), 'q4SweepMean':mean(sweep_samples), 'q4SweepMedian':percentile(sweep_samples,50),
        'q4SweepP25':percentile(sweep_samples,25), 'q4SweepP75':percentile(sweep_samples,75), 'q4SweepP90':percentile(sweep_samples,90),
        'q5AsiaN':len(asia_range_samples), 'q5AsiaMean':mean(asia_range_samples), 'q5AsiaMedian':percentile(asia_range_samples,50),
        'q5AsiaP75':percentile(asia_range_samples,75), 'q5AsiaP90':percentile(asia_range_samples,90),
        'aQuartiles':quartiles(1), 'bQuartiles':quartiles(2),
        'firstUtc':rows[0]['dt_utc'].isoformat(), 'lastUtc':rows[-1]['dt_utc'].isoformat(),
        'days': days,
    }
    return result


def main():
    import argparse
    ap=argparse.ArgumentParser()
    ap.add_argument('csv')
    ap.add_argument('--json-out')
    ap.add_argument('--mintick', type=float, default=MINTICK)
    args=ap.parse_args()
    rows=load_csv(args.csv)
    res=validate(rows, mintick=args.mintick)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(res,indent=2))
    print(f"range UTC: {res['firstUtc']} -> {res['lastUtc']}")
    print(f"raw/valid/excluded: {res['rawDays']}/{res['validDays']}/{res['excludedDays']}")
    print(f"exclusions missing/short/doubleLondon/ambigNY: {res['excludedMissingSession']}/{res['excludedShortSession']}/{res['excludedAmbiguousLondon']}/{res['excludedAmbiguousNySweep']}")
    print(f"A: n={res['nA']} wins={res['nAHeld']} pct={fmt(res['aPct'])}% Wilson=[{fmt(res['aWilson95'][0])},{fmt(res['aWilson95'][1])}] {res['aStatus']}")
    print(f"B: n={res['nB']} wins={res['nBHeld']} pct={fmt(res['bPct'])}% Wilson=[{fmt(res['bWilson95'][0])},{fmt(res['bWilson95'][1])}] {res['bStatus']} seq_fail={res['bSequenceFailures']}")
    print(f"Q4 sweep n/mean/med/p25/p75/p90: {res['q4SweepN']}/{fmt(res['q4SweepMean'])}/{fmt(res['q4SweepMedian'])}/{fmt(res['q4SweepP25'])}/{fmt(res['q4SweepP75'])}/{fmt(res['q4SweepP90'])}")
    print(f"Q5 Asia n/mean/med/p75/p90: {res['q5AsiaN']}/{fmt(res['q5AsiaMean'])}/{fmt(res['q5AsiaMedian'])}/{fmt(res['q5AsiaP75'])}/{fmt(res['q5AsiaP90'])}")
    print('A quartiles:', res['aQuartiles'])
    print('B quartiles:', res['bQuartiles'])

if __name__ == '__main__':
    main()
