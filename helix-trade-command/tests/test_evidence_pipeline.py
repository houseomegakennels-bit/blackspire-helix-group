import importlib.util, json, subprocess, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
collector=load('collector',ROOT/'scripts/collect_tradingview_evidence.py')
ledger=load('ledger',ROOT/'scripts/evidence_ledger.py')

class EvidencePipelineTests(unittest.TestCase):
    def test_parse_finalized_event(self):
        text='''Helix R1-H1 Prospective Collector\nHELIX_DAY_KEY\n20260912.0000\nHELIX_REASON_CODE\n7.0000\nHELIX_CANDIDATE\n1.0000\nHELIX_COUNTED_EVENT\n1.0000\nHELIX_SUCCESS\n1.0000\nHELIX_EVENTS\n1.0000\nHELIX_WINS\n1.0000\nHELIX_SUCCESS_PCT\n100.0000\nHELIX_WILSON_LO\n20.6540\nHELIX_GATE_CODE\n0.0000\nHELIX_DAYS_RECORDED\n1.0000'''
        rec,vals=collector.parse(text)
        self.assertEqual(rec['research_day_et'],'2026-09-12'); self.assertTrue(rec['counted_event']); self.assertTrue(rec['success']); self.assertEqual(rec['reason'],'counted_event')
    def test_parse_prevalidation_zero(self):
        text='''Helix R1-H1 Prospective Collector\nHELIX_DAY_KEY\n0.0000\nHELIX_REASON_CODE\n0.0000\nHELIX_CANDIDATE\n0.0000\nHELIX_COUNTED_EVENT\n0.0000\nHELIX_SUCCESS\n-1.0000\nHELIX_EVENTS\n0.0000\nHELIX_WINS\n0.0000\nHELIX_SUCCESS_PCT\n∅\nHELIX_WILSON_LO\n∅\nHELIX_GATE_CODE\n0.0000\nHELIX_DAYS_RECORDED\n0.0000'''
        rec,_=collector.parse(text); self.assertIsNone(rec)
    def test_hash_chain_detects_tamper(self):
        body={'research_day_et':'2026-09-12','counted_event':True,'success':True,'prev_hash':ledger.GENESIS}
        import hashlib
        row={**body,'record_hash':hashlib.sha256(ledger.canonical(body).encode()).hexdigest()}
        self.assertEqual(ledger.verify([row]),row['record_hash'])
        row['success']=False
        with self.assertRaises(ValueError): ledger.verify([row])
    def test_gate(self):
        self.assertEqual(ledger.gate(29,29),'PROVISIONAL'); self.assertEqual(ledger.gate(17,31),'FAIL')

if __name__=='__main__': unittest.main()
