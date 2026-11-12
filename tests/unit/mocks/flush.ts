/**
 * Lasă să ruleze toate promisiunile deja rezolvate (un macro-task `setImmediate`, fără nicio
 * așteptare pe ceas). Doar în testele care falsifică numai `Date`, nu și temporizatoarele.
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** O promisiune rezolvată din afară — pentru o cerere „în zbor” pe care testul o termină când vrea. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
