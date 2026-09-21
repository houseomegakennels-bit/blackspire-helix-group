import importlib.util, json, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
ledger=load('v2ledger',ROOT/'scripts/v2_evidence_ledger.py')
scraper=load('v2scraper',ROOT/'scripts/collect_tradingview_v2_evidence.py')

class V2ProspectiveTests(unittest.TestCase):
    def test_gate_requires_all_execution_thresholds(self):
        rows=[]
        for i in range(30):
            r=0.75 if i<24 else -0.5
            rows.append({'counted_trade':True,'r_multiple':r,'net_pnl':150 if r>0 else -50})
        n,w,mean,lower,pf,net=ledger.stats(rows)
        self.assertEqual(n,30); self.assertGreater(mean,0.10); self.assertGreater(pf,1.25); self.assertGreater(lower,0)
    def test_hash_chain_detects_tamper(self):
        body={'research_day_et':'2026-09-12','counted_trade':False,'prev_hash':ledger.GENESIS}
        import hashlib
        row={**body,'record_hash':hashlib.sha256(ledger.canonical(body).encode()).hexdigest()}
        self.assertEqual(ledger.verify([row]),row['record_hash'])
        row['counted_trade']=True
        with self.assertRaises(ValueError): ledger.verify([row])
    def test_scraper_prevalidation_zero(self):
        text='Helix London V2 Prospective Collector ' + ' '.join([f'{f} '+('−1.0000' if f=='V2_WIN' else '∅' if f in {'V2_R_MULTIPLE','V2_NET_PNL','V2_EXPECTANCY_R','V2_MEAN_R_LOWER95','V2_PROFIT_FACTOR'} else '0.0000') for f in scraper.FIELDS])
        rec,vals=scraper.parse(text); self.assertIsNone(rec); self.assertEqual(vals['V2_TRADES'],0.0)
    def test_scraper_finalized_trade(self):
        values={'V2_DAY_KEY':'20260912','V2_REASON_CODE':'8','V2_CANDIDATE':'1','V2_COUNTED_TRADE':'1','V2_WIN':'1','V2_R_MULTIPLE':'1.50','V2_NET_PNL':'120.0','V2_TRADES':'1','V2_WINS':'1','V2_EXPECTANCY_R':'1.50','V2_MEAN_R_LOWER95':'∅','V2_PROFIT_FACTOR':'999','V2_GATE_CODE':'0','V2_DAYS_RECORDED':'1'}
        text='Helix London V2 Prospective Collector '+' '.join(f'{k} {v}' for k,v in values.items())
        rec,_=scraper.parse(text); self.assertTrue(rec['counted_trade']); self.assertEqual(rec['research_day_et'],'2026-09-12'); self.assertAlmostEqual(rec['r_multiple'],1.5)
if __name__=='__main__': unittest.main()
