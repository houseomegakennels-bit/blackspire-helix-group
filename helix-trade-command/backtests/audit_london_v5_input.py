#!/usr/bin/env python3
"""Timestamp-only audit; never reads or evaluates strategy outcomes."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from london_v5_research import CSV_SHA, CANDIDATE_SHA, GENERATOR_SHA, EVIDENCE, write_new


def audit_csv(path: Path) -> dict:
    with path.open('rb') as handle:
        source_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
    if source_hash != CSV_SHA:
        raise ValueError('Input is not the preserved, pinned historical CSV')
    previous = None
    bars = 0
    anomalies = []
    alignment_failures = 0
    first = last = None
    with path.open(newline='') as handle:
        for line_number, row in enumerate(csv.DictReader(handle), 2):
            stamp = datetime.fromisoformat(row['datetime'])
            stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
            bars += 1
            first = first or stamp.isoformat()
            last = stamp.isoformat()
            if stamp.minute % 5 or stamp.second or stamp.microsecond:
                alignment_failures += 1
            if previous is not None and stamp <= previous:
                anomalies.append({'csv_line': line_number,
                    'kind': 'duplicate' if stamp == previous else 'backwards',
                    'previous_utc': previous.isoformat(), 'current_utc': stamp.isoformat()})
            previous = stamp
    invalid = bool(anomalies or alignment_failures)
    result = {'source_csv_sha256': source_hash, 'bars_read': bars,
        'first_utc': first, 'last_utc': last, 'timestamp_anomalies': anomalies,
        'alignment_failures': alignment_failures,
        'input_integrity': 'FAIL' if invalid else 'PASS_TIMESTAMP_AUDIT_ONLY',
        'regeneration': 'BLOCKED_INPUT_INTEGRITY' if invalid else 'NOT_RUN',
        'generated_candidates_sha256': None, 'matches_preserved': False,
        'development': 'NOT_RUN', 'internal_validation': 'NOT_RUN',
        'final_holdout': 'NOT_RUN_NO_VERIFIED_UNSEEN_DIRECT_INSTRUMENT_DATA',
        'claim_75pct_allowed': False, 'trading_authorized': False}
    for name, expected in [('preserved-candidates.json', CANDIDATE_SHA),
                           ('preserved-generator.py.txt', GENERATOR_SHA)]:
        with (EVIDENCE / name).open('rb') as handle:
            actual = hashlib.file_digest(handle, 'sha256').hexdigest()
        if actual != expected:
            raise ValueError('Preserved artifact changed: ' + name)
        result[name + '_sha256'] = actual
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    result = audit_csv(args.csv)
    write_new(args.out, result)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    if result['input_integrity'] == 'FAIL':
        raise SystemExit(2)


if __name__ == '__main__':
    main()
