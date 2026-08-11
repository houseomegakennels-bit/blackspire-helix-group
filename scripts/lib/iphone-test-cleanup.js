export function createIphoneTestCleanup({ worker, server, closeDb, removeData, log = console.log, deadlineMs = 30_000 }) {
  let cleanupPromise;
  return function cleanup(reason) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      let cleanupError;
      try {
        if (worker) {
          const result = await worker.stop({ deadlineMs });
          if (!result?.drained) throw new Error('worker shutdown did not drain before its deadline');
        }
      } catch (error) {
        cleanupError = error;
      }

      if (server) {
        try {
          const closed = new Promise((resolve, reject) => {
            server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
          });
          server.closeAllConnections?.();
          await closed;
        } catch (error) {
          cleanupError ||= error;
        }
      }
      try { closeDb(); } catch (error) { cleanupError ||= error; }
      try { removeData(); } catch (error) { cleanupError ||= error; }
      if (cleanupError) throw cleanupError;
      log(JSON.stringify({ service: 'iphone-test-build', status: 'stopped', reason, cleaned: true }));
    })();
    return cleanupPromise;
  };
}

export function waitForServerListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onListening = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}
