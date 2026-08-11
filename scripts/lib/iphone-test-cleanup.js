export function createIphoneTestCleanup({ worker, server, closeDb, removeData, log = console.log, deadlineMs = 30_000 }) {
  let cleanupPromise;
  return function cleanup(reason) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      let stopError;
      try {
        const result = await worker.stop({ deadlineMs });
        if (!result?.drained) throw new Error('worker shutdown did not drain before its deadline');
      } catch (error) {
        stopError = error;
      }

      const closed = new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      server.closeAllConnections?.();
      await closed;
      closeDb();
      removeData();
      if (stopError) throw stopError;
      log(JSON.stringify({ service: 'iphone-test-build', status: 'stopped', reason, cleaned: true }));
    })();
    return cleanupPromise;
  };
}
