/**
 * A small typed client for the EveryOps REST API (/api/v1), one method per operation in openapi.ts (the contract
 * test keeps them in step). It has no dependencies, so it can be copied into any script running on Node 18+, Deno,
 * Bun or a browser:
 *
 *   const eo = new EveryOps(process.env.EVERYOPS_API_KEY!);
 *   const { data } = await eo.listRecords("my-workspace", { type: "bookings", filter: ["status:eq:Confirmed"] });
 */

export type ApiRecord = { id: string; rev?: number; [field: string]: unknown };
export type Values = Record<string, unknown>;
export type ListOptions = {
  type: string;
  q?: string;
  filter?: string[];
  sort?: string;
  limit?: number;
  cursor?: string;
};
export type AggregateOptions = {
  type: string;
  metric?: "count" | "sum" | "avg" | "min" | "max";
  field?: string;
  filter?: string[];
  groupBy?: string;
  dateField?: string;
  bucket?: "day" | "week" | "month";
};

/** A failed request: status, the API's error code and message, and details (the current record on a 409). */
export class EveryOpsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class EveryOps {
  constructor(
    private readonly key: string,
    private readonly baseUrl = "https://everyops.app/api/v1",
  ) {}

  private async request<T>(
    method: string,
    path: string,
    init: { query?: object; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(init.query ?? {}))
      for (const one of Array.isArray(v) ? v : [v])
        if (one !== undefined && one !== null) url.searchParams.append(k, String(one));
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => null);
    if (!res.ok)
      throw new EveryOpsError(
        res.status,
        json?.error?.code ?? "error",
        json?.error?.message ?? res.statusText,
        json?.error?.details,
      );
    return json as T;
  }

  private ws = (id: string) => `/workspaces/${encodeURIComponent(id)}`;

  listWorkspaces() {
    return this.request<{ data: { id: string; name: string; role: string; permissions: string[] }[] }>(
      "GET",
      "/workspaces",
    );
  }
  getWorkspace(id: string) {
    return this.request<{ data: { id: string; name: string; role: string; permissions: string[] } }>(
      "GET",
      this.ws(id),
    );
  }
  getSchema(id: string) {
    return this.request<{ data: Record<string, unknown> }>("GET", `${this.ws(id)}/schema`);
  }
  listRecords(id: string, options: ListOptions) {
    return this.request<{ data: ApiRecord[]; meta: { total: number; nextCursor: string | null } }>(
      "GET",
      `${this.ws(id)}/records`,
      { query: options },
    );
  }
  /** Every record matching, following the cursor page by page. */
  async *allRecords(id: string, options: Omit<ListOptions, "cursor">) {
    let cursor: string | undefined;
    do {
      const page = await this.listRecords(id, { ...options, limit: options.limit ?? 50, cursor });
      yield* page.data;
      cursor = page.meta.nextCursor ?? undefined;
    } while (cursor);
  }
  createRecord(id: string, type: string, values: Values) {
    return this.request<{ data: ApiRecord; meta?: { automations: string[] } }>(
      "POST",
      `${this.ws(id)}/records`,
      {
        body: { type, values },
      },
    );
  }
  getRecord(id: string, recordId: string) {
    return this.request<{ data: ApiRecord }>("GET", `${this.ws(id)}/records/${encodeURIComponent(recordId)}`);
  }
  /** Pass the rev you read to refuse the write (409, EveryOpsError.details.current) if someone saved it since. */
  updateRecord(id: string, recordId: string, values: Values, rev?: number) {
    return this.request<{ data: ApiRecord; meta?: { automations: string[] } }>(
      "PATCH",
      `${this.ws(id)}/records/${encodeURIComponent(recordId)}`,
      { body: { values, ...(rev ? { rev } : {}) } },
    );
  }
  deleteRecord(id: string, recordId: string, rev?: number) {
    return this.request<void>("DELETE", `${this.ws(id)}/records/${encodeURIComponent(recordId)}`, {
      query: { rev },
    });
  }
  aggregate(id: string, options: AggregateOptions) {
    return this.request<{ data: Record<string, unknown> }>("GET", `${this.ws(id)}/aggregate`, {
      query: options,
    });
  }
  getPage(id: string, viewId: string) {
    return this.request<{
      data: { id: string; name: string; type: string; text: string; truncated: boolean };
    }>("GET", `${this.ws(id)}/pages/${encodeURIComponent(viewId)}`);
  }
  putPage(id: string, viewId: string, text: string) {
    return this.request<{
      data: { id: string; name: string; type: string; characters: number; updatedAt: string };
    }>("PUT", `${this.ws(id)}/pages/${encodeURIComponent(viewId)}`, { body: { text } });
  }
  proposeChange(id: string, request: string) {
    return this.request<{ data: { requestId: number; message: string } }>(
      "POST",
      `${this.ws(id)}/change-requests`,
      { body: { request } },
    );
  }
}
