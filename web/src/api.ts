const BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api/v1';

export type ApiError = {
  message: string;
  alertCode?: string;
  statusCode?: number;
};

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
