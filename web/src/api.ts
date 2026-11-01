const BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? '/api/v1' : 'http://127.0.0.1:3001/api/v1');

export type ApiError = {
  message: string | string[] | Record<string, unknown>;
  alertCode?: string;
  statusCode?: number;
};

export function errorMessage(err: unknown) {
  const message = (err as ApiError)?.message;
  if (typeof message === 'string' && message) return message;
  if (Array.isArray(message)) return message.join(', ');
  if (message && typeof message === 'object') return JSON.stringify(message);
  return 'Ошибка запроса';
}

const readCache = new Map<string, unknown>();
const readInflight = new Map<string, Promise<unknown>>();
let readEpoch = 0;

function isRead(options: RequestInit) {
  return (options.method ?? 'GET').toUpperCase() === 'GET';
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw { message: 'Сервер не отвечает' } satisfies ApiError;
  }
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
    throw { message: 'Вместо данных пришла страница. API не отвечает.' } satisfies ApiError;
  }
  let data = {} as T & ApiError;
  if (text) {
    try {
      data = JSON.parse(text) as T & ApiError;
    } catch {
      throw { message: 'Сервер вернул не данные' } satisfies ApiError;
    }
  }
  if (!res.ok) {
    throw data;
  }
  return data;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!isRead(options)) {
    readEpoch += 1;
    readCache.clear();
    readInflight.clear();
    return request<T>(path, options);
  }
  const cached = readCache.get(path);
  if (cached !== undefined) return cached as T;
  const pending = readInflight.get(path);
  if (pending) return pending as Promise<T>;
  const epoch = readEpoch;
  const promise = request<T>(path, options).then((data) => {
    if (epoch === readEpoch) readCache.set(path, data);
    return data;
  });
  readInflight.set(path, promise);
  try {
    return await promise;
  } finally {
    if (readInflight.get(path) === promise) readInflight.delete(path);
  }
}
