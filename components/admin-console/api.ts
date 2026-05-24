export async function getJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;
    throw new Error(reason);
  }

  return data;
}

export async function postJson(
  url: string,
  payload: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST"
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;
    throw new Error(reason);
  }

  return data;
}

export async function postFormData(url: string, formData: FormData) {
  const response = await fetch(url, { method: "POST", body: formData });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason =
      typeof data?.error === "string"
        ? data.error
        : data?.error
          ? JSON.stringify(data.error)
          : `Request failed: ${response.status}`;

    const error = new Error(reason) as Error & { payload?: unknown };
    error.payload = data;
    throw error;
  }

  return data;
}
