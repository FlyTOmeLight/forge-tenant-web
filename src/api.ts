import { demo } from "./prototype";
let csrf = "";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  redirect = true,
): Promise<T> {
  if (demo) return (await demo.request(path, options)) as T;
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method))
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && redirect)
    window.location.assign("/auth/login");
  if (!response.ok)
    throw new APIError(
      body?.error?.message || "服务暂不可用，请稍后重试",
      response.status,
    );
  return body as T;
}
export function mutate<T>(
  path: string,
  method: string,
  body: unknown,
  version?: number,
): Promise<T> {
  return api<T>(path, {
    method,
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      ...(version !== undefined ? { "If-Match": String(version) } : {}),
    },
    body: JSON.stringify(body),
  });
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试";
