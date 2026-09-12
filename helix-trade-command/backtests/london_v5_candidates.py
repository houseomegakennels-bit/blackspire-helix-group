import sys, math, statistics
import london_v4_dual_state as h
from collections import defaultdict
T=h.TICK

def in_ny(b):
    hh=b['dt_et'].hour; mm=b['dt_et'].minute
    return (hh>7 or (hh==7 and mm>=0)) and hh<10

def fvg(c,i,d): return h.fvg(c,i,d)

def sim(c,ei,d,entry,stop,target):
    # 1 contract normalized R after M6E costs, same slippage assumptions
    ef=entry+d*T; xr=None; xtype='time'; xb=c[-1]
    for j,b in enumerate(c[ei:],ei):
        if b['dt_et'].hour>=10: break
        sh=b['low']<=stop if d==1 else b['high']>=stop
        th=b['high']>=target if d==1 else b['low']<=target
        if sh: xr=stop; xtype='stop'; xb=b; break
        if th and j>ei: xr=target; xtype='target'; xb=b; break
        xr=b['close']; xb=b
    xf=xr-d*T
    gross=((xf-ef)/T*d)*h.TICK_VALUE
    net=gross-h.COMM_RT
    risk=abs(entry-stop)/T*h.TICK_VALUE
    return net/risk if risk else None, xtype

def cycle_features(c):
    miss,short,_,_=h.quality(c)
    if miss or short:return []
    asia=[x for x in c if h.in_asia(x)]; london=[x for x in c if h.in_london(x)]; ny=[(i,x) for i,x in enumerate(c) if in_ny(x)]
    if not asia or not london or not ny:return []
    ah=max(x['high'] for x in asia); al=min(x['low'] for x in asia); ar=ah-al
    lh=max(x['high'] for x in london); ll=min(x['low'] for x in london); lr=lh-ll
    lc=london[-1]['close']; lo=london[0]['open']
    london_dir=1 if lc>lo else -1
    london_sweep_hi=lh>=ah+T; london_sweep_lo=ll<=al-T
    london_state=('DOUBLE' if london_sweep_hi and london_sweep_lo else 'HIGH' if london_sweep_hi else 'LOW' if london_sweep_lo else 'NONE')
    bodies=[abs(x['close']-x['open']) for x in c]
    # rolling swings available before each bar
    swing_hi=swing_lo=None
    rows=[]
    # NY candidates: sweep/reject of London extreme, or continuation retest after outside close
    for i,b in ny:
        # update swings from prior sequence globally up to i
        if i>=2:
            pass
    swings=[]; shi=slo=None
    for i,b in enumerate(c):
        if i>=2:
            p=c[i-1]; p2=c[i-2]
            if p['high']>p2['high'] and p['high']>b['high']: shi=p['high']
            if p['low']<p2['low'] and p['low']<b['low']: slo=p['low']
        swings.append((shi,slo))
    day=c[ny[0][0]]['dt_et'].date().isoformat(); dow=c[ny[0][0]]['dt_et'].weekday()
    # generic event generator per direction after NY sweep/reclaim of London high/low
    for side,name,level in ((1,'HIGH',lh),(-1,'LOW',ll)):
        # side=1 means sweep high -> bearish trade d=-1; side=-1 sweep low -> bullish d=1
        sweep_i=None; ext=None; mss_level=None
        for i,b in ny:
            if sweep_i is None:
                swept=(b['high']>=level+T and b['close']<=level) if side==1 else (b['low']<=level-T and b['close']>=level)
                if not swept: continue
                sweep_i=i; ext=b['high'] if side==1 else b['low']; shi,slo=swings[i]; mss_level=slo if side==1 else shi
                continue
            if side==1: ext=max(ext,b['high'])
            else: ext=min(ext,b['low'])
            d=-side
            # MSS then displacement/FVG
            mss_i=None
            for k in range(sweep_i+1,len(c)):
                x=c[k]
                if not in_ny(x): continue
                if mss_level is not None and ((d==-1 and x['close']<mss_level) or (d==1 and x['close']>mss_level)):
                    mss_i=k; break
            if mss_i is None: break
            gap=None; di=None; mult=None
            for k in range(mss_i,len(c)):
                x=c[k]
                if not in_ny(x): continue
                med=statistics.median(bodies[max(0,k-20):k]) if k>=20 else None
                strong=med and med>0 and bodies[k]>=1.5*med and ((d==1 and x['close']>x['open']) or (d==-1 and x['close']<x['open']))
                g=fvg(c,k,d) if strong else None
                if g:
                    gap=g; di=k; mult=bodies[k]/med; break
            if gap is None: break
            for k in range(di+1,len(c)):
                x=c[k]
                if not in_ny(x): continue
                if x['low']<=gap['mid']<=x['high']:
                    entry=gap['mid']; stop=ext+T if d==-1 else ext-T
                    if (d==1 and stop>=entry) or (d==-1 and stop<=entry): break
                    st=abs(entry-stop)/T
                    # outcomes at multiple fixed targets; select later only on dev
                    outs={}
                    for rr in (0.5,0.75,1.0,1.25,1.5,2.0):
                        r,xt=sim(c,k,d,entry,stop,entry+d*rr*abs(entry-stop)); outs[str(rr)]=(r,xt)
                    rows.append({'day':day,'year':int(day[:4]),'dow':dow,'family':'NY_LONDON_SWEEP_REJECT','side':name,'d':d,
                        'london_state':london_state,'london_dir':london_dir,'asia_ticks':ar/T,'london_ticks':lr/T,'london_over_asia':lr/ar if ar else None,
                        'london_close_pos':(lc-al)/ar if ar else None,'sweep_depth_ticks':abs(ext-level)/T,'stop_ticks':st,
                        'entry_min':c[k]['dt_et'].hour*60+c[k]['dt_et'].minute-420,'disp_mult':mult,
                        'same_as_london_dir':d==london_dir,'same_as_london_sweep':(london_state=='LOW' and d==1) or (london_state=='HIGH' and d==-1),
                        'outs':outs})
                    break
            break
    # Continuation: London closes outside Asia, NY retests London/Asia breakout boundary and resumes with displacement FVG
    for d,bound in ((1,ah),(-1,al)):
        accepted=(lc>=ah+T if d==1 else lc<=al-T)
        if not accepted: continue
        # require NY touch/retest of boundary and close back outside, then displacement/FVG same direction
        ret=None
        for i,b in ny:
            touch=b['low']<=bound<=b['high']
            outside=b['close']>=bound+T if d==1 else b['close']<=bound-T
            if touch and outside: ret=i; break
        if ret is None: continue
        gap=None; di=None; mult=None
        for k in range(ret,len(c)):
            x=c[k]
            if not in_ny(x): continue
            med=statistics.median(bodies[k-20:k]) if k>=20 else None
            strong=med and med>0 and bodies[k]>=1.5*med and ((d==1 and x['close']>x['open']) or (d==-1 and x['close']<x['open']))
            g=fvg(c,k,d) if strong else None
            if g: gap=g; di=k; mult=bodies[k]/med; break
        if gap is None: continue
        for k in range(di+1,len(c)):
            x=c[k]
            if not in_ny(x): continue
            if x['low']<=gap['mid']<=x['high']:
                entry=gap['mid']; stop=bound-T if d==1 else bound+T
                if (d==1 and stop>=entry) or (d==-1 and stop<=entry): break
                st=abs(entry-stop)/T; outs={}
                for rr in (0.5,0.75,1.0,1.25,1.5,2.0): outs[str(rr)]=sim(c,k,d,entry,stop,entry+d*rr*abs(entry-stop))
                rows.append({'day':day,'year':int(day[:4]),'dow':dow,'family':'NY_ACCEPT_CONT','side':'HIGH' if d==1 else 'LOW','d':d,
                    'london_state':london_state,'london_dir':london_dir,'asia_ticks':ar/T,'london_ticks':lr/T,'london_over_asia':lr/ar if ar else None,
                    'london_close_pos':(lc-al)/ar if ar else None,'sweep_depth_ticks':0,'stop_ticks':st,
                    'entry_min':c[k]['dt_et'].hour*60+c[k]['dt_et'].minute-420,'disp_mult':mult,
                    'same_as_london_dir':True,'same_as_london_sweep':False,'outs':outs})
                break
    return rows


# Portable, bounded-memory adapter. The signal functions above are unchanged.
SOURCE_CSV_SHA = '6c33f99a43c007e08d4ce66fe0e3fc17d0374e97406d35749a79165ba3bfde1d'
PRESERVED_CANDIDATE_SHA = '62dcd485326e427dd5d557c6ee07ef78936daa69453ff8737f2d50edc7bc867b'

def stream_rows(path):
    import csv
    from datetime import datetime, timezone
    previous = None
    with open(path, newline='') as handle:
        for raw in csv.DictReader(handle):
            stamp = datetime.fromisoformat(raw['datetime'])
            stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
            if previous is not None and stamp <= previous:
                raise ValueError('Input must be strictly time-ordered without duplicate bars')
            if stamp.minute % 5 or stamp.second or stamp.microsecond:
                raise ValueError('Input is not aligned to five-minute timestamps')
            previous = stamp
            bar = {'dt_utc': stamp, 'dt_et': stamp.astimezone(h.TZ),
                   **{key: float(raw[key]) for key in ('open', 'high', 'low', 'close')},
                   'volume': float(raw.get('volume', 0) or 0)}
            if not all(math.isfinite(bar[key]) for key in ('open', 'high', 'low', 'close', 'volume')):
                raise ValueError('Non-finite input bar')
            if not bar['low'] <= min(bar['open'], bar['close']) <= max(bar['open'], bar['close']) <= bar['high']:
                raise ValueError('Invalid OHLC input bar')
            yield bar


def stream_cycles(path, audit):
    # Match V4 split_cycles exactly, including discarding the terminating bar and unfinished cycle.
    current = []
    active = False
    start = None
    for bar in stream_rows(path):
        audit['bars_read'] = audit.get('bars_read', 0) + 1
        audit.setdefault('first_utc', bar['dt_utc'].isoformat())
        audit['last_utc'] = bar['dt_utc'].isoformat()
        if h.in_asia(bar) and not active:
            current = [bar]
            active = True
            start = bar['dt_et'].date()
            continue
        if active:
            if bar['dt_et'].date() > start and bar['dt_et'].hour >= 10:
                yield current
                current = []
                active = False
                start = None
                continue
            current.append(bar)
    audit['unfinished_cycle_discarded'] = bool(current)


def main():
    import argparse, hashlib, json
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Regenerate the preserved V5 spot-proxy candidates only')
    parser.add_argument('--csv', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--audit', type=Path, required=True)
    args = parser.parse_args()
    with args.csv.open('rb') as handle:
        source_sha = hashlib.file_digest(handle, 'sha256').hexdigest()
    if source_sha != SOURCE_CSV_SHA:
        raise ValueError('Only the pinned, previously exposed CSV may enter this recovery adapter')
    audit = {'source_csv_sha256': source_sha, 'completed_cycles': 0, 'ny_incomplete_days': []}
    rows = []
    for cycle in stream_cycles(args.csv, audit):
        audit['completed_cycles'] += 1
        ny = [bar for bar in cycle if in_ny(bar)]
        if ny:
            day = ny[0]['dt_et'].date()
            minutes = {bar['dt_et'].hour * 60 + bar['dt_et'].minute for bar in ny}
            if len(ny) != 36 or minutes != set(range(420, 600, 5)) or any(bar['dt_et'].date() != day for bar in ny):
                audit['ny_incomplete_days'].append(day.isoformat())
        rows.extend(cycle_features(cycle))
    payload = json.dumps(rows).encode()
    generated_sha = hashlib.sha256(payload).hexdigest()
    audit.update({'candidates': len(rows), 'generated_candidates_sha256': generated_sha,
                  'matches_preserved': generated_sha == PRESERVED_CANDIDATE_SHA})
    audit['ny_incomplete_days'] = sorted(set(audit['ny_incomplete_days']))
    with args.out.open('xb') as handle:
        handle.write(payload)
    with args.audit.open('x') as handle:
        handle.write(json.dumps(audit, sort_keys=True, indent=2, allow_nan=False) + '\n')
    print(json.dumps({key: value for key, value in audit.items() if key != 'ny_incomplete_days'}, indent=2))
    print('ny_incomplete_days', len(audit['ny_incomplete_days']))
    if not audit['matches_preserved']:
        raise SystemExit('Candidate regeneration mismatch: stop before development')


if __name__ == '__main__':
    main()
