#!/usr/bin/env python3
"""Reproducible V5 spot-proxy research; never authorizes execution or deployment."""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import statistics
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence" / "v5"
PROTOCOL = ROOT / "docs" / "backtests" / "london-v5" / "protocol.md"
BOUNDS = {"development": (2009, 2018), "internal": (2019, 2024)}
CANDIDATE_SHA = "62dcd485326e427dd5d557c6ee07ef78936daa69453ff8737f2d50edc7bc867b"
CSV_SHA = "6c33f99a43c007e08d4ce66fe0e3fc17d0374e97406d35749a79165ba3bfde1d"
GENERATOR_SHA = "a8372273217b6a72604d4e1220bd183f83cd8389657c0fa82b203dca843cbba1"
TARGETS = ("0.5", "0.75", "1.0", "1.25", "1.5", "2.0")
LEGACY_COST = 2.75
BASE_COST = 4.0
STRESS_COST = 6.5
LEGACY_UNIT_DOLLARS = 0.625


def encoded(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def read_json(path: Path) -> Any:
    def reject(value: str) -> None:
        raise ValueError(f"Non-finite JSON value: {value}")
    return json.loads(path.read_text(), parse_constant=reject)


def write_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(encoded(value))


def source_hashes() -> dict[str, str]:
    paths = [Path(__file__), ROOT / "backtests" / "london_v5_candidates.py",
             ROOT / "backtests" / "london_v4_dual_state.py", PROTOCOL,
             EVIDENCE / "preserved-generator.py.txt", EVIDENCE / "regeneration-audit.json"]
    return {str(p.relative_to(ROOT)): digest(p) for p in paths}


def grid() -> list[dict[str, Any]]:
    keys = ("family", "rr", "min_stop_m6e_ticks", "latest_entry_min", "context", "min_disp")
    values = (("ALL", "NY_LONDON_SWEEP_REJECT", "NY_ACCEPT_CONT"), TARGETS,
              (5, 10, 15, 20, 30), (60, 120, 175),
              ("ALL", "WITH_LONDON", "AGAINST_LONDON"), (1.5, 2.0, 2.5))
    return [dict(zip(keys, combination)) for combination in itertools.product(*values)]


def row_id(row: dict[str, Any]) -> tuple[Any, ...]:
    return row["day"], row["entry_min"], row["family"], row["side"]


def check_rows(rows: Any, split: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list) or split not in BOUNDS:
        raise ValueError("Expected a candidate list and a registered split")
    lo, hi = BOUNDS[split]
    seen: set[tuple[Any, ...]] = set()
    for row in rows:
        day = date.fromisoformat(row["day"])
        if not lo <= day.year <= hi or row["year"] != day.year:
            raise ValueError(f"Data outside {split} boundary: {row['day']}")
        if row["family"] not in ("NY_LONDON_SWEEP_REJECT", "NY_ACCEPT_CONT"):
            raise ValueError("Unknown candidate family")
        if row["d"] not in (-1, 1) or row["side"] not in ("HIGH", "LOW"):
            raise ValueError("Invalid direction or side")
        if not isinstance(row["same_as_london_dir"], bool):
            raise ValueError("Direction context must be boolean")
        for key in ("stop_ticks", "entry_min", "disp_mult"):
            if isinstance(row[key], bool) or not math.isfinite(float(row[key])):
                raise ValueError(f"Invalid feature: {key}")
        if row["stop_ticks"] <= 0 or not 0 <= row["entry_min"] <= 175:
            raise ValueError("Invalid risk or entry time")
        for target in TARGETS:
            outcome = row["outs"][target]
            if (len(outcome) != 2 or isinstance(outcome[0], bool)
                    or not isinstance(outcome[0], (int, float))
                    or not math.isfinite(outcome[0])
                    or outcome[1] not in ("stop", "target", "time")):
                raise ValueError("Invalid stored outcome")
        ident = row_id(row)
        if ident in seen:
            raise ValueError("Duplicate candidate identity")
        seen.add(ident)
    return rows


def load_rows(path: Path, split: str) -> list[dict[str, Any]]:
    return check_rows(read_json(path), split)


def prepare(out: Path) -> dict[str, Any]:
    preserved = EVIDENCE / "preserved-candidates.json"
    if digest(preserved) != CANDIDATE_SHA:
        raise ValueError("Preserved candidate hash mismatch")
    if digest(EVIDENCE / "preserved-generator.py.txt") != GENERATOR_SHA:
        raise ValueError("Preserved generator hash mismatch")
    audit_path = EVIDENCE / "regeneration-audit.json"
    audit = read_json(audit_path)
    if (audit["source_csv_sha256"] != CSV_SHA or audit["generated_candidates_sha256"] != CANDIDATE_SHA
            or not audit["matches_preserved"]):
        raise ValueError("Regeneration evidence does not match preserved inputs")
    # Exclude incomplete NY sessions by timestamp coverage only, before outcome analysis.
    original = read_json(preserved)
    incomplete = set(audit["ny_incomplete_days"])
    complete = [r for r in original if r["day"] not in incomplete]
    partitioned = {name: [r for r in complete if lo <= int(r["day"][:4]) <= hi]
                   for name, (lo, hi) in BOUNDS.items()}
    if sum(map(len, partitioned.values())) != len(complete):
        raise ValueError("Unregistered data outside the declared partitions")
    manifest: dict[str, Any] = {"preserved_candidates_sha256": CANDIDATE_SHA,
        "preserved_generator_sha256": GENERATOR_SHA, "source_csv_sha256": CSV_SHA,
        "regeneration_audit_sha256": digest(audit_path),
        "incomplete_ny_candidates_excluded": len(original) - len(complete),
        "dataset_kind": "EURUSD_SPOT_PROXY", "genuinely_unseen_final_data": False,
        "prior_exposure": ["2009-2024 EURUSD", "2026 Jan-Apr M6E", "2026 Mar-Sep EURUSD"],
        "splits": {}}
    for name, rows in partitioned.items():
        check_rows(rows, name)
        path = out / f"{name}-candidates.json"
        write_new(path, rows)
        manifest["splits"][name] = {"file": path.name, "sha256": digest(path),
            "candidates": len(rows), "days": len({r['day'] for r in rows}),
            "years": list(BOUNDS[name]), "unseen_holdout": False}
    write_new(out / "split-manifest.json", manifest)
    return manifest


def select(rows: list[dict[str, Any]], parameters: dict[str, Any]) -> list[dict[str, Any]]:
    eligible = []
    for row in rows:
        if parameters["family"] != "ALL" and row["family"] != parameters["family"]:
            continue
        # Original units are 0.00005, half the actual 0.0001 M6E-sized tick.
        if row["stop_ticks"] / 2 + 1e-9 < parameters["min_stop_m6e_ticks"]:
            continue
        if row["entry_min"] > parameters["latest_entry_min"]:
            continue
        if row["disp_mult"] + 1e-12 < parameters["min_disp"]:
            continue
        if parameters["context"] == "WITH_LONDON" and not row["same_as_london_dir"]:
            continue
        if parameters["context"] == "AGAINST_LONDON" and row["same_as_london_dir"]:
            continue
        eligible.append(row)
    first: dict[str, dict[str, Any]] = {}
    for row in sorted(eligible, key=row_id):
        first.setdefault(row["day"], row)
    return list(first.values())


def net_outcome(row: dict[str, Any], rr: str, roundtrip_cost: float) -> tuple[float, float]:
    risk = row["stop_ticks"] * LEGACY_UNIT_DOLLARS
    if not math.isfinite(risk) or risk <= 0 or roundtrip_cost < 0:
        raise ValueError("Invalid risk or cost")
    net = row["outs"][rr][0] * risk - (roundtrip_cost - LEGACY_COST)
    # Do not count floating-point dust around exact break-even as a win.
    net = 0.0 if abs(net) < 1e-9 else net
    return net / risk, net


def wilson(wins: int, n: int) -> list[float] | None:
    if n == 0:
        return None
    if not 0 <= wins <= n:
        raise ValueError("Invalid binomial counts")
    z = 1.959963984540054
    p = wins / n
    den = 1 + z * z / n
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    center = (p + z * z / (2 * n)) / den
    return [max(0.0, center - half), min(1.0, center + half)]


def summary(rows: list[dict[str, Any]], rr: str, cost: float) -> dict[str, Any]:
    outcomes = [net_outcome(r, rr, cost) for r in rows]
    rs = [r for r, _ in outcomes]
    dollars = [d for _, d in outcomes]
    wins = sum(d > 0 for d in dollars)
    gain = sum(d for d in dollars if d > 0)
    loss = -sum(d for d in dollars if d < 0)
    eq = peak = drawdown = 0.0
    streak = longest = 0
    for value in dollars:
        eq += value
        peak = max(peak, eq)
        drawdown = max(drawdown, peak - eq)
        streak = 0 if value > 0 else streak + 1
        longest = max(longest, streak)
    years = sorted({r["year"] for r in rows})
    yearly = {}
    for year in years:
        pairs = [o for row, o in zip(rows, outcomes) if row["year"] == year]
        yearly[str(year)] = {"trades": len(pairs), "wins": sum(d > 0 for _, d in pairs),
            "expectancy_r": statistics.mean(r for r, _ in pairs),
            "net_one_unit_usd": sum(d for _, d in pairs)}
    return {"trades": len(rows), "unique_days": len({r['day'] for r in rows}),
        "wins": wins, "losses": sum(d < 0 for d in dollars),
        "breakeven": sum(d == 0 for d in dollars),
        "win_rate": wins / len(rows) if rows else None, "wilson95": wilson(wins, len(rows)),
        "expectancy_r": statistics.mean(rs) if rs else None,
        "net_one_unit_usd": sum(dollars), "winning_usd": gain, "losing_usd": loss,
        "profit_factor_usd": gain / loss if loss else None,
        "max_drawdown_one_unit_usd": drawdown, "longest_nonwinning_streak": longest,
        "roundtrip_cost_usd": cost, "active_years": len(years),
        "positive_expectancy_years": sum(v["expectancy_r"] > 0 for v in yearly.values()),
        "yearly": yearly, "exits": dict(sorted(Counter(r["outs"][rr][1] for r in rows).items()))}


def goal(base: dict[str, Any], stress: dict[str, Any], minimum: int) -> dict[str, Any]:
    conditions = {"minimum_sample": base["trades"] >= minimum,
        "one_trade_per_day": base["trades"] == base["unique_days"],
        "net_win_rate_at_least_75pct": base["win_rate"] is not None and base["win_rate"] >= 0.75,
        "positive_base_expectancy": base["expectancy_r"] is not None and base["expectancy_r"] > 0,
        "positive_stress_expectancy": stress["expectancy_r"] is not None and stress["expectancy_r"] > 0,
        "profit_factor_above_one": base["winning_usd"] > base["losing_usd"],
        "positive_year_fraction": base["active_years"] > 0 and
            base["positive_expectancy_years"] / base["active_years"] >= 0.6}
    return {"pass": all(conditions.values()), "checks": conditions}


def holdout_claim_allowed(sample: dict[str, Any], provenance: dict[str, Any]) -> bool:
    """Eligibility only. Callers must independently establish every provenance fact."""
    return bool(provenance.get("unseen_verified") is True
        and provenance.get("frozen_before_access") is True
        and provenance.get("direct_instrument_execution_validated") is True
        and provenance.get("development_pass") is True
        and provenance.get("internal_pass") is True
        and provenance.get("dataset_kind") == "DIRECT_M6E"
        and sample.get("trades", 0) >= 100
        and sample.get("unique_days", 0) == sample.get("trades")
        and 0 <= sample.get("wins", -1) <= sample["trades"]
        and sample.get("wins", 0) / sample["trades"] >= 0.75
        and sample.get("expectancy_r") is not None and sample["expectancy_r"] > 0
        and sample.get("net_one_unit_usd", 0) > 0)


def check_snapshot(freeze: dict[str, Any]) -> None:
    if freeze["source_hashes"] != source_hashes():
        raise ValueError("Frozen code or protocol changed; validation is forbidden")
    if freeze["grid_sha256"] != hashlib.sha256(encoded(grid())).hexdigest():
        raise ValueError("Frozen grid changed")
    if freeze["selected"] is not None and freeze["selected"]["parameters"] not in grid():
        raise ValueError("Unregistered frozen parameter set")


def develop(data: Path, out: Path) -> dict[str, Any]:
    manifest = read_json(data / "split-manifest.json")
    path = data / "development-candidates.json"
    if digest(path) != manifest["splits"]["development"]["sha256"]:
        raise ValueError("Development data hash mismatch")
    rows = load_rows(path, "development")
    ledger = []
    for parameters in grid():
        chosen = select(rows, parameters)
        base = summary(chosen, parameters["rr"], BASE_COST)
        stress = summary(chosen, parameters["rr"], STRESS_COST)
        ledger.append({"parameters": parameters, "base": base, "stress": stress,
                       "development_goal": goal(base, stress, 100)})
    eligible = [r for r in ledger if r["base"]["trades"] >= 100]
    eligible.sort(key=lambda r: (-r["base"]["wilson95"][0], -r["base"]["expectancy_r"],
        -r["base"]["trades"], json.dumps(r["parameters"], sort_keys=True)))
    selected = eligible[0] if eligible else None
    write_new(out / "development-ledger.json", ledger)
    freeze = {"experiment": "LONDON_V5_RECOVERY_20260912", "source_hashes": source_hashes(),
        "protocol_stage": "FROZEN_BEFORE_INTERNAL_ACCESS", "grid_count": len(ledger),
        "grid_sha256": hashlib.sha256(encoded(grid())).hexdigest(),
        "split_manifest_sha256": digest(data / "split-manifest.json"),
        "development_sha256": digest(path),
        "internal_sha256": manifest["splits"]["internal"]["sha256"],
        "ledger_sha256": digest(out / "development-ledger.json"),
        "eligible_sample_configurations": len(eligible),
        "development_goal_pass_count": sum(r["development_goal"]["pass"] for r in ledger),
        "selected": selected,
        "internal_use": "single_candidate_diagnostic" if selected and not selected["development_goal"]["pass"] else "single_candidate_gate",
        "final_holdout": "NOT_RUN_NO_VERIFIED_UNSEEN_DIRECT_INSTRUMENT_DATA",
        "claim_75pct_allowed": False}
    write_new(out / "frozen-candidate.json", freeze)
    return {"grid_count": len(ledger), "sample_eligible": len(eligible),
            "goal_pass_count": freeze["development_goal_pass_count"], "selected": selected,
            "freeze_sha256": digest(out / "frozen-candidate.json")}


def validate(data: Path, freeze_path: Path, expected_sha: str, out: Path) -> dict[str, Any]:
    if digest(freeze_path) != expected_sha:
        raise ValueError("Freeze digest mismatch; do not open internal data")
    freeze = read_json(freeze_path)
    check_snapshot(freeze)
    if digest(data / "split-manifest.json") != freeze["split_manifest_sha256"]:
        raise ValueError("Split manifest changed")
    if digest(data / "development-candidates.json") != freeze["development_sha256"]:
        raise ValueError("Frozen development data changed")
    if not freeze["selected"]:
        raise ValueError("No sample-eligible development candidate; internal remains closed")
    internal_path = data / "internal-candidates.json"
    if digest(internal_path) != freeze["internal_sha256"]:
        raise ValueError("Internal data hash mismatch")
    # Only now may this stage read internal outcomes. It never ranks alternatives.
    rows = load_rows(internal_path, "internal")
    parameters = freeze["selected"]["parameters"]
    chosen = select(rows, parameters)
    base = summary(chosen, parameters["rr"], BASE_COST)
    stress = summary(chosen, parameters["rr"], STRESS_COST)
    checked = goal(base, stress, 50)
    result = {"experiment": freeze["experiment"], "freeze_sha256": expected_sha,
        "parameters": parameters, "use": freeze["internal_use"],
        "development_goal_pass": freeze["selected"]["development_goal"]["pass"],
        "internal_goal": checked, "base": base, "stress": stress,
        "final_holdout": "NOT_RUN_NO_VERIFIED_UNSEEN_DIRECT_INSTRUMENT_DATA",
        "claim_75pct_allowed": False, "trading_authorized": False,
        "decision": "RESEARCH_BATCH_CLOSED_NO_ADVANCEMENT" if not
            (freeze["selected"]["development_goal"]["pass"] and checked["pass"]) else
            "RESEARCH_ONLY_AWAIT_GENUINE_DIRECT_INSTRUMENT_HOLDOUT"}
    write_new(out / "internal-validation.json", result)
    trade_rows = [{"day": r["day"], "family": r["family"], "side": r["side"],
        "entry_min": r["entry_min"], "reference_risk_usd": r["stop_ticks"] * LEGACY_UNIT_DOLLARS,
        "base_r": net_outcome(r, parameters["rr"], BASE_COST)[0],
        "base_one_unit_usd": net_outcome(r, parameters["rr"], BASE_COST)[1],
        "stress_r": net_outcome(r, parameters["rr"], STRESS_COST)[0],
        "exit_type": r["outs"][parameters["rr"]][1]} for r in chosen]
    write_new(out / "internal-trades.json", trade_rows)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("develop")
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("validate")
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--freeze", type=Path, required=True)
    p.add_argument("--freeze-sha", required=True)
    p.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        result = prepare(args.out)
    elif args.command == "develop":
        result = develop(args.data, args.out)
    else:
        result = validate(args.data, args.freeze, args.freeze_sha, args.out)
    print(encoded(result).decode(), end="")


if __name__ == "__main__":
    main()
