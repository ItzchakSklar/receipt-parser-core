import axios from 'axios';

// '/api' is a relative same-origin path, correct for local dev (Vite proxy) and the
// docker-compose/nginx setup where frontend and backend share an origin. On
// Vercel+Render, frontend and backend are on different domains, so
// VITE_API_BASE_URL must be set to the full backend URL (e.g.
// https://smartreceipt-backend.onrender.com/api) at build time.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('smartreceipt_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('smartreceipt_token');
      localStorage.removeItem('smartreceipt_user');
      localStorage.removeItem('smartreceipt_business');
      window.location.reload();
    }
    return Promise.reject(error);
  },
);
