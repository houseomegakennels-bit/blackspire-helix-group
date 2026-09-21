#!/usr/bin/env python3
"""Disposable actual internal-network/socket-proxyd/end-to-end TLS proof."""
import json, os, pathlib, socket, subprocess, tempfile, time, uuid
IMAGE='postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
name='zola-owned-transport-'+str(uuid.uuid4())
container=None
proxy=None
listener=None
network=False

def run(args, data=None):
    result=subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
    if result.returncode != 0:
        raise RuntimeError('Disposable command failed: '+result.stderr[:300])
    return result.stdout.strip()

try:
    run(['docker','network','create','--internal','--label','blackspire.disposable=owned-transport',name]);network=True
    container=run(['docker','create','--name',name,'--pull','never','--network',name,'--read-only','--memory','256m','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=8m','-e','POSTGRES_USER=fixture','-e','POSTGRES_PASSWORD=disposable-only','-e','POSTGRES_DB=postgres',IMAGE])
    run(['docker','start',container])
    for _ in range(80):
        ready=subprocess.run(['docker','exec',container,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if ready.returncode==0: break
        time.sleep(.1)
    else: raise RuntimeError('Disposable PostgreSQL startup timed out')
    with tempfile.TemporaryDirectory(prefix='zola-owned-tls-') as directory:
        d=pathlib.Path(directory)
        run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(d/'server.key'),'-out',str(d/'server.crt'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'])
        for part in ['server.crt','server.key']: run(['docker','exec','-i',container,'sh','-c','cat > /tmp/'+part],(d/part).read_text())
        run(['docker','exec',container,'chown','postgres:postgres','/tmp/server.key','/tmp/server.crt'])
        run(['docker','exec',container,'chmod','600','/tmp/server.key'])
        run(['docker','exec','-i',container,'psql','-X','-qAt','-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1'],"ALTER SYSTEM SET ssl='on';ALTER SYSTEM SET ssl_cert_file='/tmp/server.crt';ALTER SYSTEM SET ssl_key_file='/tmp/server.key';SELECT pg_reload_conf();")
        config=json.loads(run(['docker','inspect',container]))[0]
        ip=config['NetworkSettings']['Networks'][name]['IPAddress']
        assert json.loads(run(['docker','network','inspect',name]))[0]['Internal'] is True
        assert not config['HostConfig']['PortBindings']
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(40)
        port=listener.getsockname()[1]
        assert listener.fileno()==3, 'Dedicated activation fd must be three'
        proxy=subprocess.Popen(['/bin/bash','-c','LISTEN_PID=$$ LISTEN_FDS=1 exec /lib/systemd/systemd-socket-proxyd --connections-max=4 '+ip+':5432'],pass_fds=(3,),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        code="""import pg from 'pg';import fs from 'node:fs';import {checkServerIdentity} from 'node:tls';
const c=new pg.Client({host:'127.0.0.1',port:Number(process.argv[1]),database:'postgres',user:'fixture',password:'disposable-only',ssl:{ca:fs.readFileSync(process.argv[2],'utf8'),rejectUnauthorized:true,checkServerIdentity:(_host,cert)=>checkServerIdentity('127.0.0.1',cert)},connectionTimeoutMillis:3000});
try{await c.connect();const r=await c.query('select current_database() as db');if(r.rows[0].db!=='postgres'||c.connection.stream.authorized!==true)throw Error('TLS identity');for(const ssl of [{ca:[],rejectUnauthorized:true},{ca:fs.readFileSync(process.argv[2],'utf8'),rejectUnauthorized:true,checkServerIdentity:(_host,cert)=>checkServerIdentity('127.0.0.2',cert)}]){const denied=new pg.Client({host:'127.0.0.1',port:Number(process.argv[1]),database:'postgres',user:'fixture',password:'disposable-only',ssl,connectionTimeoutMillis:3000});let rejected=false;try{await denied.connect();}catch{rejected=true;}finally{await denied.end().catch(()=>{});}if(!rejected)throw Error('TLS denial failed');}console.log(JSON.stringify({ok:true,internalNetwork:true,loopbackProxy:true,endToEndTlsVerified:true,wrongCaAndIpRejected:true,productionTouched:false}));}finally{await c.end();}"""
        print(run(['/opt/nodejs/node-v22.23.1-linux-x64/bin/node','--input-type=module','-e',code,str(port),str(d/'server.crt')]))
finally:
    if proxy is not None:
        proxy.terminate()
        try: proxy.wait(timeout=5)
        except subprocess.TimeoutExpired: proxy.kill();proxy.wait()
        if proxy.stderr is not None: proxy.stderr.close()
    if listener is not None: listener.close()
    if container is not None: run(['docker','rm','-f',container])
    if network: run(['docker','network','rm',name])
