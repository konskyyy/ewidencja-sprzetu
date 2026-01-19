// frontend/src/api.js

const DEFAULT_API = "https://tenders-map-api.onrender.com";

export const API_BASE =
  import.meta?.env?.VITE_API_URL ||
  import.meta?.env?.NEXT_PUBLIC_API_URL ||
  DEFAULT_API;

export function setToken(token) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

export function getToken() {
  return localStorage.getItem("token");
}

async function readJson(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Serwer zwrócił niepoprawną odpowiedź.");
  }
  if (!res.ok) {
    throw new Error(data?.error || "Błąd serwera.");
  }
  return data;
}

export async function loginRequest(login, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: login, password }),
  });

  return readJson(res); // { token, user }
}

export async function meRequest() {
  const token = getToken();
  if (!token) throw new Error("Brak tokenu");

  const res = await fetch(`${API_BASE}/api/auth/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  return readJson(res); // { user }
}
