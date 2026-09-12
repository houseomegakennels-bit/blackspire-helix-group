"""Synthetic safety/regression tests; no held-out outcomes are inspected here."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from datetime import date, timedelta
from unittest import mock

PATH = pathlib.Path(__file__).parents[1] / 'backtests' / 'london_v5_research.py'
SPEC = importlib.util.spec_from_file_location('v5_research', PATH)
v5 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v5)


def row(day='2009-01-02', minute=30, family='NY_ACCEPT_CONT', side='HIGH', result=0.5):
    return {'day': day, 'year': int(day[:4]), 'entry_min': minute, 'family': family,
            'side': side, 'd': 1 if side == 'HIGH' else -1, 'stop_ticks': 20.0,
            'disp_mult': 2.0, 'same_as_london_dir': True,
            'outs': {target: [result, 'target' if result > 0 else 'stop'] for target in v5.TARGETS}}


def parameters():
    return {'family': 'ALL', 'rr': '0.5', 'min_stop_m6e_ticks': 5,
            'latest_entry_min': 175, 'context': 'ALL', 'min_disp': 1.5}


class V5Tests(unittest.TestCase):
    def test_registered_grid_exact_count_and_unique(self):
        grid = v5.grid()
        self.assertEqual(len(grid), 2430)
        self.assertEqual(len({json.dumps(p, sort_keys=True) for p in grid}), 2430)

    def test_correct_actual_tick_costs(self):
        self.assertEqual(v5.BASE_COST, 2 * 1.25 + 1.50)
        self.assertEqual(v5.STRESS_COST, 4 * 1.25 + 1.50)
        result, dollars = v5.net_outcome(row(), '0.5', v5.BASE_COST)
        self.assertAlmostEqual(result, 0.4)
        self.assertAlmostEqual(dollars, 5.0)
        self.assertAlmostEqual(v5.net_outcome(row(), '0.5', v5.STRESS_COST)[0], 0.2)

    def test_legacy_cost_reproduces_original_r(self):
        for value in (-1.25, -0.01, 0.5, 1.2):
            self.assertAlmostEqual(v5.net_outcome(row(result=value), '0.5', v5.LEGACY_COST)[0], value)

    def test_extra_cost_can_turn_stored_win_into_loss(self):
        self.assertLess(v5.net_outcome(row(result=0.05), '0.5', v5.BASE_COST)[0], 0)

    def test_stress_is_never_better_than_base(self):
        for stop in (1, 10, 20, 100):
            example = row()
            example['stop_ticks'] = stop
            self.assertLess(v5.net_outcome(example, '0.5', v5.STRESS_COST)[0],
                            v5.net_outcome(example, '0.5', v5.BASE_COST)[0])

    def test_one_trade_per_day_earliest_not_best_outcome(self):
        early = row(minute=5, result=-1)
        later = row(minute=60, result=9)
        self.assertEqual(v5.select([later, early], parameters()), [early])

    def test_simultaneous_tie_is_outcome_independent(self):
        first = row(family='NY_ACCEPT_CONT', result=-1)
        second = row(family='NY_LONDON_SWEEP_REJECT', result=8)
        self.assertEqual(v5.select([second, first], parameters()), [first])
        first['outs'] = copy.deepcopy(second['outs'])
        second['outs'] = {target: [-3, 'stop'] for target in v5.TARGETS}
        self.assertEqual(v5.select([second, first], parameters()), [first])

    def test_stop_filter_converts_legacy_units(self):
        p = parameters()
        p['min_stop_m6e_ticks'] = 15
        self.assertEqual(v5.select([row()], p), [])
        p['min_stop_m6e_ticks'] = 10
        self.assertEqual(len(v5.select([row()], p)), 1)

    def test_context_filter(self):
        p = parameters()
        p['context'] = 'AGAINST_LONDON'
        self.assertEqual(v5.select([row()], p), [])
        p['context'] = 'WITH_LONDON'
        self.assertEqual(len(v5.select([row()], p)), 1)

    def test_latest_entry_is_inclusive(self):
        p = parameters()
        p['latest_entry_min'] = 60
        self.assertEqual(len(v5.select([row(minute=60)], p)), 1)
        self.assertEqual(v5.select([row(minute=65)], p), [])

    def test_development_rejects_internal_year(self):
        with self.assertRaises(ValueError):
            v5.check_rows([row('2019-01-02')], 'development')

    def test_internal_rejects_development_year(self):
        with self.assertRaises(ValueError):
            v5.check_rows([row('2018-12-31')], 'internal')

    def test_mixed_input_rejected_not_silently_filtered(self):
        with self.assertRaises(ValueError):
            v5.check_rows([row(), row('2024-01-02')], 'development')

    def test_duplicate_identity_rejected(self):
        with self.assertRaises(ValueError):
            v5.check_rows([row(), row()], 'development')

    def test_nonfinite_outcomes_rejected(self):
        for bad in (float('nan'), float('inf'), -float('inf')):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                v5.check_rows([row(result=bad)], 'development')

    def test_invalid_or_nonfinite_features_rejected(self):
        for key, value in (('stop_ticks', 0), ('entry_min', 180), ('disp_mult', float('nan'))):
            example = row()
            example[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                v5.check_rows([example], 'development')

    def test_wilson_reports_uncertainty(self):
        low, high = v5.wilson(75, 100)
        self.assertLess(low, 0.75)
        self.assertGreater(high, 0.75)
        self.assertIsNone(v5.wilson(0, 0))

    def test_empty_stats_fail_goal(self):
        empty = v5.summary([], '0.5', v5.BASE_COST)
        self.assertFalse(v5.goal(empty, empty, 100)['pass'])

    def test_breakeven_is_not_a_win(self):
        example = row(result=0.1 + 1e-12)
        stats = v5.summary([example], '0.5', v5.BASE_COST)
        self.assertEqual(stats['wins'], 0)
        self.assertEqual(stats['breakeven'], 1)

    def test_summary_day_count_and_losing_streak(self):
        rows = [row('2009-01-01', result=-1), row('2009-01-02', result=-1), row('2009-01-03', result=1)]
        stats = v5.summary(rows, '0.5', v5.BASE_COST)
        self.assertEqual(stats['trades'], 3)
        self.assertEqual(stats['unique_days'], 3)
        self.assertEqual(stats['longest_nonwinning_streak'], 2)
        self.assertGreater(stats['max_drawdown_one_unit_usd'], 0)

    def test_perfect_tiny_sample_cannot_pass(self):
        sample = [row()]
        base = v5.summary(sample, '0.5', v5.BASE_COST)
        stress = v5.summary(sample, '0.5', v5.STRESS_COST)
        self.assertFalse(v5.goal(base, stress, 100)['pass'])

    def test_all_win_profit_factor_is_json_safe(self):
        stats = v5.summary([row()], '0.5', v5.BASE_COST)
        self.assertIsNone(stats['profit_factor_usd'])
        json.loads(v5.encoded(stats))

    def test_artifacts_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / 'evidence.json'
            v5.write_new(path, {'original': True})
            with self.assertRaises(FileExistsError):
                v5.write_new(path, {'original': False})
            self.assertEqual(v5.read_json(path), {'original': True})

    def test_json_nonfinite_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / 'bad.json'
            path.write_text('[NaN]')
            with self.assertRaises(ValueError):
                v5.read_json(path)

    def test_code_change_invalidates_freeze(self):
        with mock.patch.object(v5, 'source_hashes', return_value={'changed': 'new'}):
            with self.assertRaisesRegex(ValueError, 'code or protocol'):
                v5.check_snapshot({'source_hashes': {'changed': 'old'}})

    def test_freeze_digest_checked_before_internal_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / 'freeze.json'
            path.write_text('{}')
            with mock.patch.object(v5, 'load_rows') as load:
                with self.assertRaisesRegex(ValueError, 'Freeze digest'):
                    v5.validate(path.parent, path, 'incorrect', path.parent / 'out')
                load.assert_not_called()

    def test_claim_gate_requires_all_provenance_and_meaningful_sample(self):
        sample = {'trades': 100, 'unique_days': 100, 'wins': 75,
                  'expectancy_r': 0.1, 'net_one_unit_usd': 10}
        provenance = {'unseen_verified': True, 'frozen_before_access': True,
                      'direct_instrument_execution_validated': True,
                      'development_pass': True, 'internal_pass': True, 'dataset_kind': 'DIRECT_M6E'}
        self.assertTrue(v5.holdout_claim_allowed(sample, provenance))
        for field in ('unseen_verified', 'frozen_before_access', 'direct_instrument_execution_validated',
                      'development_pass', 'internal_pass'):
            changed = dict(provenance, **{field: False})
            self.assertFalse(v5.holdout_claim_allowed(sample, changed), field)
        self.assertFalse(v5.holdout_claim_allowed(sample, dict(provenance, dataset_kind='EURUSD_SPOT_PROXY')))
        for change in ({'trades': 99, 'unique_days': 99}, {'unique_days': 99}, {'wins': 74},
                       {'expectancy_r': 0}, {'net_one_unit_usd': 0}, {'wins': 101}):
            self.assertFalse(v5.holdout_claim_allowed(dict(sample, **change), provenance), change)


if __name__ == '__main__':
    unittest.main()
