import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("smartreceipt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("smartreceipt_token");
      localStorage.removeItem("smartreceipt_user");
      localStorage.removeItem("smartreceipt_business");
      window.location.reload();
    }
    return Promise.reject(error);
  },
);
