const BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001/api/v1';

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

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('vp_token');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw data;
  }
  return data;
}
