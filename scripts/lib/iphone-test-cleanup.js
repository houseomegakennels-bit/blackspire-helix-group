export function createIphoneTestCleanup({ worker, server, closeDb, removeData, log = console.log, deadlineMs = 30_000 }) {
  let cleanupPromise;
  return function cleanup(reason) {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      // Every stage runs regardless of earlier failures, and every stage error is kept: a failing
      // db-close must not mask a failing data-remove, which is the stage that decides whether the
      // disposable root actually went away.
      const errors = [];
      try {
        if (worker) {
          const result = await worker.stop({ deadlineMs });
          if (!result?.drained) throw new Error('worker shutdown did not drain before its deadline');
          // stop() reports {drained:true, error} when an in-flight tick rejected. The drain really
          // did complete, so this is not a leak, but discarding the error let cleanup log a clean
          // result for a teardown that failed.
          if (result.error) throw result.error;
        }
      } catch (error) {
        errors.push(error);
      }

      if (server) {
        try {
          const closed = new Promise((resolve, reject) => {
            server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
          });
          server.closeAllConnections?.();
          await closed;
        } catch (error) {
          errors.push(error);
        }
      }
      try { closeDb(); } catch (error) { errors.push(error); }
      try { removeData(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, `disposable cleanup failed with ${errors.length} errors: ${errors.map((error) => String(error?.message || error)).join('; ')}`);
      log(JSON.stringify({ service: 'iphone-test-build', status: 'stopped', reason, cleaned: true }));
    })();
    // Success stays memoized so cleanup is idempotent, but a failed cleanup must be retryable rather
    // than returning the same rejection forever. The reset is registered first, so it has already run
    // by the time a caller's own rejection handler observes the failure.
    cleanupPromise.catch(() => { cleanupPromise = undefined; });
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
