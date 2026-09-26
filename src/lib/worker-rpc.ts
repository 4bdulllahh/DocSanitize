import { ProcessingError, type ProcessingErrorCode } from "./errors";

/*
 * Tiny typed RPC over postMessage. A worker exposes an object of async functions with
 * `exposeWorkerApi`; the page calls them through `createWorkerClient`. Binary results are
 * transferred (not copied) in both directions.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, (...args: any[]) => unknown>;

interface Request {
  id: number;
  op: string;
  args: unknown[];
}

type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string; code?: ProcessingErrorCode };

/** Every ArrayBuffer reachable from a value (typed arrays, arrays, plain objects). */
export function transferablesOf(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  } else if (value instanceof ArrayBuffer) {
    found.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) transferablesOf(v, found);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) transferablesOf(v, found);
  }
  return [...found];
}

/** Call inside a worker module. */
export function exposeWorkerApi(api: Api) {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  scope.onmessage = async (event: MessageEvent<Request>) => {
    const { id, op, args } = event.data;
    try {
      const fn = api[op];
      if (!fn) throw new Error(`Unknown operation: ${op}`);
      const result = await fn(...args);
      scope.postMessage({ id, ok: true, result } satisfies Response, transferablesOf(result));
    } catch (error) {
      scope.postMessage({
        id,
        ok: false,
        message: error instanceof Error ? error.message : "Something went wrong while processing this file.",
        code: error instanceof ProcessingError ? error.code : undefined,
      } satisfies Response);
    }
  };
}

type Client<T extends Api> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>;
};

/**
 * Typed proxy for a worker's API. The worker is created on first use and restarted after a crash.
 * Arguments' buffers are transferred to the worker, so callers must pass bytes they own.
 */
export function createWorkerClient<T extends Api>(create: () => Worker): Client<T> {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  const getWorker = () => {
    if (worker) return worker;
    worker = create();
    worker.onmessage = (event: MessageEvent<Response>) => {
      const res = event.data;
      const task = pending.get(res.id);
      if (!task) return;
      pending.delete(res.id);
      if (res.ok) task.resolve(res.result);
      else task.reject(res.code ? new ProcessingError(res.message, res.code) : new Error(res.message));
    };
    worker.onerror = (event) => {
      for (const task of pending.values()) task.reject(new Error(event.message || "The processing engine crashed."));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  };

  return new Proxy({} as Client<T>, {
    get: (_, op: string) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          pending.set(id, { resolve, reject });
          getWorker().postMessage({ id, op, args } satisfies Request, transferablesOf(args));
        }),
  });
}
