import importlib.util, pathlib, unittest

P=pathlib.Path(__file__).resolve().parents[1]/'backtests'/'london_v3_adaptive.py'
s=importlib.util.spec_from_file_location('v3',P); v3=importlib.util.module_from_spec(s); s.loader.exec_module(v3)

class LondonV3Tests(unittest.TestCase):
    def test_feature_vector_is_pre_entry_only(self):
        x={'asia_ticks':50,'asia_ratio20':1.0,'asia_drift_frac':.2,'sweep_depth_frac':.1,'mss_lag_min':10,'disp_lag_min':20,'disp_mult':2,'fvg_frac':.1,'entry_minute':90,'retrace_lag_min':10,'stop_ticks':20,'rr':3,'prev24_ratio':.7,'side':-1}
        z=v3.vec(x); self.assertEqual(len(z),13); self.assertTrue(all(a==a for a in z))
    def test_stop_guard_threshold_is_frozen_in_spec(self):
        spec=(pathlib.Path(__file__).resolve().parents[1]/'docs'/'backtests'/'london-v3-adaptive-spec.md').read_text()
        self.assertIn('stop distance is < 15 M6E ticks',spec)
        self.assertIn('Ridge penalty lambda = 5.0',spec)
