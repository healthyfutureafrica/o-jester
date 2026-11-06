export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fields?: Record<string, string>; requiredPlan?: string } & Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Language sent to the API so server-generated text and errors come back localised. */
let apiLang = "en";
export function setApiLang(lang: string) {
  apiLang = lang;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: {
      "X-OJ-Client": "web",
      "X-OJ-Lang": apiLang,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    const fallback = apiLang === "fr" ? "La requête a échoué. Veuillez réessayer." : "Request failed. Please try again.";
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? fallback, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return apiLang === "fr" ? "Une erreur s'est produite." : "Something went wrong.";
}
