const API_BASE = 'https://altai-qr-production.up.railway.app';


export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('authToken');

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

  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    window.location.href = "/login";
    return;
  }

  return res;
}