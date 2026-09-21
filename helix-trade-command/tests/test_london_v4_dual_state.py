import importlib.util, pathlib, unittest
P=pathlib.Path(__file__).parents[1]/'backtests'/'london_v4_dual_state.py'
s=importlib.util.spec_from_file_location('v4',P); v4=importlib.util.module_from_spec(s); s.loader.exec_module(v4)
class V4Tests(unittest.TestCase):
    def test_position_size_caps(self):
        self.assertEqual(v4.size(50000,1.1000,1.0990),6)
    def test_bullish_fvg(self):
        c=[{'high':1.1,'low':1.09},{'high':1.11,'low':1.10},{'high':1.13,'low':1.12}]
        g=v4.fvg(c,2,1); self.assertAlmostEqual(g['mid'],1.11)
    def test_bearish_fvg(self):
        c=[{'high':1.13,'low':1.12},{'high':1.12,'low':1.11},{'high':1.10,'low':1.09}]
        g=v4.fvg(c,2,-1); self.assertAlmostEqual(g['mid'],1.11)
if __name__=='__main__': unittest.main()
