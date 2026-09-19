// Startup may hold initialized PostgreSQL pools before a listener exists. A
// termination signal must wait for that initialization and close those pools
// before authority SQLite, without allowing a late listener to open.
export function createBuyerWriterApiLifecycle({initialize,listen,closeWriter,drainServer,closeAuthority}) {
  if([initialize,listen,closeWriter,drainServer,closeAuthority].some(value=>typeof value!=='function'))throw new TypeError('API lifecycle configuration rejected');
  let writer,server,starting,stopping=false,shutdown;
  return Object.freeze({
    start(){
      if(starting)return starting;
      starting=Promise.resolve().then(async()=>{
        if(stopping)return;
        writer=await initialize();
        if(stopping)return;
        server=listen(writer);return server;
      });
      return starting;
    },
    stop(){
      if(shutdown)return shutdown;
      stopping=true;
      shutdown=Promise.resolve().then(async()=>{
        try {
          try{await starting;}catch{}
          if(server)await drainServer(server);
          else await closeWriter(writer);
        }finally{closeAuthority();}
      });
      return shutdown;
    },
    getServer:()=>server,
  });
}
