/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full backend API base URL (e.g. https://your-backend.onrender.com/api).
   *  Falls back to the relative '/api' path when unset - see src/api/client.ts. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
