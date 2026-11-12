const API_BASE = 'https://altai-qr-8mks.onrender.com';
import { getAuthToken, clearAuth } from './authStorage';

export async function apiFetch(path, options = {}) {
  const token = getAuthToken();

  const url = `${API_BASE}${path}`;

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

// The login endpoint legitimately returns 401 for bad credentials — that's
// not an expired session, so it must NOT trigger the global logout/redirect.
// Every other route treats 401/403 as "your session is invalid."
const isLoginAttempt = path === '/api/auth/login';

if (!isLoginAttempt && (res.status === 401 || res.status === 403)) {
    clearAuth();
    window.location.href = "/login";
    return;
  }

  return res;
}

export async function apiFetchScanLookupBatch(path, values, body = {}, fallbackPathForValue, signal) {
  const response = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({ values, ...body }),
    ...(signal ? { signal } : {}),
  });
  if (!response) throw new Error('Your session is no longer valid.');

  if (response.status === 404 && fallbackPathForValue) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        const value = values[index];
        try {
          const fallbackResponse = await apiFetch(fallbackPathForValue(value), signal ? { signal } : {});
          if (!fallbackResponse) throw new Error('Your session is no longer valid.');
          const data = await fallbackResponse.json();
          results[index] = fallbackResponse.ok
            ? { value, ok: true, data }
            : { value, ok: false, ...data };
        } catch (error) {
          if (signal?.aborted) throw error;
          results[index] = { value, ok: false, message: 'Could not reach server.' };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, values.length) }, worker));
    return results;
  }

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Could not look up scanned codes.');
  if (!Array.isArray(data.results)) throw new Error('The scan lookup returned an invalid response.');
  return data.results;
}