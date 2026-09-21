#!/usr/bin/env python3
"""Convert HistData EURUSD Generic ASCII M1 zip files (fixed EST, no DST) to UTC 5-minute CSV."""
import argparse,csv,datetime,glob,zipfile
from datetime import timezone,timedelta

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("input_glob"); ap.add_argument("output_csv"); a=ap.parse_args()
    fixed_est=timezone(timedelta(hours=-5)); files=sorted(glob.glob(a.input_glob))
    if not files: raise SystemExit("no files matched")
    with open(a.output_csv,"w",newline="") as fo:
        w=csv.writer(fo); w.writerow(["datetime","open","high","low","close","volume"]); curk=None; agg=None
        for zp in files:
            with zipfile.ZipFile(zp) as z:
                name=next(n for n in z.namelist() if n.lower().endswith(".csv"))
                for raw in z.open(name):
                    p=raw.decode("ascii").strip().split(";")
                    if len(p)<6: continue
                    dt=datetime.datetime.strptime(p[0],"%Y%m%d %H%M%S").replace(tzinfo=fixed_est).astimezone(timezone.utc)
                    k=dt.replace(minute=(dt.minute//5)*5,second=0,microsecond=0); o,h,l,c=map(float,p[1:5]); v=float(p[5])
                    if curk is None: curk=k; agg=[o,h,l,c,v]
                    elif k==curk: agg[1]=max(agg[1],h); agg[2]=min(agg[2],l); agg[3]=c; agg[4]+=v
                    else: w.writerow([curk.isoformat(),*agg]); curk=k; agg=[o,h,l,c,v]
        if curk is not None: w.writerow([curk.isoformat(),*agg])
if __name__=="__main__": main()
