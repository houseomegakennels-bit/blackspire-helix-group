import ast
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backtests'))
import london_v5_candidates as candidate
import london_v5_research as research


class InputIntegrityTests(unittest.TestCase):
    def make_csv(self, directory, stamps, ohlc='1.1,1.2,1.0,1.15'):
        path = pathlib.Path(directory) / 'bars.csv'
        path.write_text('datetime,open,high,low,close\n' +
                        ''.join(stamp + ',' + ohlc + '\n' for stamp in stamps))
        return path

    def test_backwards_timestamp_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_csv(directory, ['2020-01-02T01:55:00Z', '2020-01-02T01:00:00Z'])
            with self.assertRaisesRegex(ValueError, 'strictly time-ordered'):
                list(candidate.stream_rows(path))

    def test_duplicate_timestamp_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_csv(directory, ['2020-01-02T01:00:00Z'] * 2)
            with self.assertRaisesRegex(ValueError, 'strictly time-ordered'):
                list(candidate.stream_rows(path))

    def test_nonfinite_ohlc_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_csv(directory, ['2020-01-02T01:00:00Z'], 'nan,1.2,1.0,1.15')
            with self.assertRaisesRegex(ValueError, 'Non-finite'):
                list(candidate.stream_rows(path))

    def test_streaming_matches_original_cycle_semantics(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.make_csv(directory, ['2020-01-02T01:00:00Z', '2020-01-02T01:05:00Z',
                '2020-01-02T12:00:00Z', '2020-01-02T15:00:00Z', '2020-01-03T01:00:00Z'])
            audit = {}
            streamed = list(candidate.stream_cycles(path, audit))
            original = candidate.h.split_cycles(candidate.h.load_csv(path))
            self.assertEqual(streamed, original)
            self.assertTrue(audit['unfinished_cycle_discarded'])
            self.assertEqual(audit['bars_read'], 5)

    def test_archived_signal_functions_are_unchanged(self):
        old = ast.parse((ROOT / 'evidence/v5/preserved-generator.py.txt').read_text())
        new = ast.parse((ROOT / 'backtests/london_v5_candidates.py').read_text())
        old_functions = {n.name: ast.dump(n) for n in old.body if isinstance(n, ast.FunctionDef)}
        new_functions = {n.name: ast.dump(n) for n in new.body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(old_functions, {name: new_functions[name] for name in old_functions})

    def test_failed_audit_blocks_before_candidate_outcomes_are_read(self):
        failed = {'source_csv_sha256': research.CSV_SHA,
                  'generated_candidates_sha256': None, 'matches_preserved': False}
        with mock.patch.object(research, 'digest', side_effect=[research.CANDIDATE_SHA, research.GENERATOR_SHA]):
            with mock.patch.object(research, 'read_json', return_value=failed) as read:
                with self.assertRaisesRegex(ValueError, 'Regeneration evidence'):
                    research.prepare(pathlib.Path('/unused-test-destination'))
                self.assertEqual(read.call_count, 1)
                self.assertEqual(read.call_args.args[0].name, 'regeneration-audit.json')


if __name__ == '__main__':
    unittest.main()
