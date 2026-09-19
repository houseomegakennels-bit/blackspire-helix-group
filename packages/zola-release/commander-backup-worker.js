// Internal bounded copy child. The parent retains the source descriptor and
// protected output directory; killing this child never signals the API/worker.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
let db;
try{
 if(process.getuid?.()!==0||process.argv.length!==3)throw new Error();
 const destination=process.argv[2],parent=fs.lstatSync(path.dirname(destination)),source=fs.fstatSync(3);
 if(!path.isAbsolute(destination)||path.resolve(destination)!==destination||path.basename(destination)!=='snapshot.sqlite'
  ||!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o7777)!==0o700
  ||!source.isFile()||source.nlink!==1||fs.existsSync(destination))throw new Error();
 db=new DatabaseSync('/proc/self/fd/3',{readOnly:true});
 db.exec('PRAGMA busy_timeout=1000');
 db.exec(`VACUUM INTO '${destination.replaceAll("'","''")}'`);
}catch{process.exitCode=1;}finally{db?.close();}
