import fs from 'node:fs';
import path from 'node:path';
import {BUYER_WRITER_DEFAULT_SOCKET} from './local-gateway-protocol.js';

export function inspectBuyerWriterGatewaySocket({socketPath=BUYER_WRITER_DEFAULT_SOCKET,expectedUid,expectedGid,io=fs}={}){
  try{
    if(!path.isAbsolute(socketPath)||path.resolve(socketPath)!==socketPath||socketPath==='/'||!Number.isInteger(expectedUid)||!Number.isInteger(expectedGid))throw new Error();
    const parent=io.lstatSync(path.dirname(socketPath)),socket=io.lstatSync(socketPath);
    const verified=parent.isDirectory()&&!parent.isSymbolicLink()&&(parent.mode&0o0027)===0&&[0,expectedUid].includes(parent.uid)&&parent.gid===expectedGid
      &&socket.isSocket()&&!socket.isSymbolicLink()&&socket.uid===expectedUid&&socket.gid===expectedGid&&(socket.mode&0o777)===0o660;
    return Object.freeze({socketPath,localFilesystemSocket:socket.isSocket(),ownerUid:socket.uid,groupId:socket.gid,mode:socket.mode&0o777,
      parentOwnerUid:parent.uid,parentGroupId:parent.gid,parentMode:parent.mode&0o777,verified});
  }catch{return Object.freeze({socketPath,localFilesystemSocket:false,verified:false});}
}
