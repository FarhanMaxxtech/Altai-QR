const API_BASE = 'https://altai-qr-production-fdfc.up.railway.app';
import { getAuthToken, clearAuth } from './authStorage';

export async function apiFetch(path, options = {}) {
  const token = getAuthToken();

  const url = `${API_BASE}${path}`;

  console.log("=== API FETCH ===");
  console.log("Request URL:", url);
  console.log("Token:", token);

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  console.log("Status:", res.status);
  console.log("Final URL:", res.url);

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