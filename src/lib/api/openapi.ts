/**
 * The public REST API's OpenAPI 3.1 description, served at /api/v1/openapi.json and rendered on /developers.
 * openapi.test.ts checks every path and method here against the route handlers in src/app/api/v1, and against the
 * client in src/lib/api/client.ts. Breaking changes go in a new version (/api/v2); v1 only gains things.
 */

type Param = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description: string;
  schema: object;
};

const pathParam = (name: string, description: string): Param => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});
const query = (name: string, description: string, schema: object = { type: "string" }): Param => ({
  name,
  in: "query",
  description,
  schema,
});

const WORKSPACE = pathParam("id", "Workspace id, from GET /workspaces");
const RECORD = pathParam("recordId", "Record id");
const VIEW = pathParam("viewId", "A document or custom HTML page's tab id, from the schema's pages");
const TYPE = { ...query("type", "Record type id, from the schema"), required: true };
const FILTER = query(
  "filter",
  "FIELD:OP:VALUE, repeatable; all must hold. OP is eq, neq, contains, gt, gte, lt, lte, empty or not_empty. Values: choice labels, linked record names or ids, YYYY-MM-DD, numbers, true/false.",
  { type: "array", items: { type: "string" } },
);
const REV = query("rev", "Only write if the record's rev is still this (or send If-Match)", {
  type: "integer",
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const ok = (description: string, data: object, meta?: object) => ({
  description,
  ...json({
    type: "object",
    required: ["data"],
    properties: { data, ...(meta ? { meta } : {}) },
  }),
});
const error = (description: string) => ({ description, ...json(ref("Error")) });
const errors = {
  "400": error("The request isn't valid (missing or wrong values)"),
  "401": error("No API key, or it was revoked or expired"),
  "403": error("The key or your role can't do this"),
  "404": error("Not found, or outside the key's workspaces"),
  "429": error("Too many requests for this key; see Retry-After"),
};

type Op = {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  "x-permission": string;
  parameters?: Param[];
  requestBody?: object;
  responses: Record<string, object>;
};

const op = (o: Op) => ({ ...o, responses: { ...o.responses, ...errors } });

export const API_VERSION = "1.0.0";

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "EveryOps API",
    version: API_VERSION,
    description:
      "Read and write the records in your EveryOps workspaces. Every write is checked like the app checks it (required fields, valid choices, free booking slots) and runs the workspace's save automations. Times are on each workspace's clock (the schema's timeZone, Asia/Manila unless the owner set another); money is in PHP.",
  },
  servers: [{ url: "https://everyops.app/api/v1" }],
  security: [{ apiKey: [] }],
  tags: [
    { name: "Workspaces", description: "Workspaces the key reaches and what is in them" },
    { name: "Records", description: "Search, read, create, change and delete records" },
    { name: "Pages", description: "Document and custom HTML page text" },
    { name: "Changes", description: "Ask the workspace's owners for a design change" },
  ],
  paths: {
    "/workspaces": {
      get: op({
        operationId: "listWorkspaces",
        summary: "List workspaces",
        tags: ["Workspaces"],
        "x-permission": "any",
        responses: { "200": ok("Workspaces the key reaches", { type: "array", items: ref("Workspace") }) },
      }),
    },
    "/workspaces/{id}": {
      get: op({
        operationId: "getWorkspace",
        summary: "Get a workspace",
        tags: ["Workspaces"],
        "x-permission": "records:read",
        parameters: [WORKSPACE],
        responses: {
          "200": ok("The workspace, your role and the key's permissions there", ref("Workspace")),
        },
      }),
    },
    "/workspaces/{id}/schema": {
      get: op({
        operationId: "getSchema",
        summary: "Describe a workspace",
        description:
          "Record types with every field (id, type, choices, links), record counts, pages and automations.",
        tags: ["Workspaces"],
        "x-permission": "records:read",
        parameters: [WORKSPACE],
        responses: { "200": ok("The workspace's design", ref("Schema")) },
      }),
    },
    "/workspaces/{id}/records": {
      get: op({
        operationId: "listRecords",
        summary: "List records",
        description:
          "Records of one type, newest first unless sorted. Follow meta.nextCursor for the next page.",
        tags: ["Records"],
        "x-permission": "records:read",
        parameters: [
          WORKSPACE,
          TYPE,
          query("q", "Text to search for in the record's title"),
          FILTER,
          query("sort", "A field id, or createdAt; prefix - for descending (default -createdAt)"),
          query("limit", "Records a page, 1 to 50 (default 25)", {
            type: "integer",
            minimum: 1,
            maximum: 50,
          }),
          query("cursor", "meta.nextCursor from the previous page"),
        ],
        responses: {
          "200": ok(
            "A page of records",
            { type: "array", items: ref("Record") },
            {
              type: "object",
              properties: { total: { type: "integer" }, nextCursor: { type: ["string", "null"] } },
            },
          ),
        },
      }),
      post: op({
        operationId: "createRecord",
        summary: "Create a record",
        tags: ["Records"],
        "x-permission": "records:write",
        parameters: [WORKSPACE],
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["type", "values"],
            properties: { type: { type: "string" }, values: ref("Values") },
          }),
        },
        responses: { "201": ok("The saved record, with its rev", ref("Record"), ref("WriteMeta")) },
      }),
    },
    "/workspaces/{id}/records/{recordId}": {
      get: op({
        operationId: "getRecord",
        summary: "Get a record",
        description: "Every field, the records linked to it (an order's lines) and its rev.",
        tags: ["Records"],
        "x-permission": "records:read",
        parameters: [WORKSPACE, RECORD],
        responses: { "200": ok("The record", ref("Record")) },
      }),
      patch: op({
        operationId: "updateRecord",
        summary: "Update a record",
        description:
          "Changes the fields you send; others stay. Send the rev you read: if someone saved the record since, nothing is written and you get 409 with the record as it is now.",
        tags: ["Records"],
        "x-permission": "records:write",
        parameters: [WORKSPACE, RECORD],
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["values"],
            properties: { values: ref("Values"), rev: { type: "integer" } },
          }),
        },
        responses: {
          "200": ok("The saved record, with its new rev", ref("Record"), ref("WriteMeta")),
          "409": error("The rev is stale; error.details.current is the record now"),
        },
      }),
      delete: op({
        operationId: "deleteRecord",
        summary: "Delete a record",
        description: "Deletes the record and its line items.",
        tags: ["Records"],
        "x-permission": "records:write",
        parameters: [WORKSPACE, RECORD, REV],
        responses: {
          "204": { description: "Deleted" },
          "409": error("The rev is stale; error.details.current is the record now"),
        },
      }),
    },
    "/workspaces/{id}/aggregate": {
      get: op({
        operationId: "aggregate",
        summary: "Count and total records",
        description:
          "Exact count, sum, avg, min or max, optionally grouped by a field or by day, week or month.",
        tags: ["Records"],
        "x-permission": "records:read",
        parameters: [
          WORKSPACE,
          TYPE,
          query("metric", "count (default), sum, avg, min or max", {
            type: "string",
            enum: ["count", "sum", "avg", "min", "max"],
          }),
          query("field", "The number or money field for sum, avg, min and max"),
          FILTER,
          query("groupBy", "A field to group by"),
          query("dateField", "A date field to group by, with bucket"),
          query("bucket", "day, week or month", { type: "string", enum: ["day", "week", "month"] }),
        ],
        responses: { "200": ok("The value, or one per group", { type: "object" }) },
      }),
    },
    "/workspaces/{id}/pages/{viewId}": {
      get: op({
        operationId: "getPage",
        summary: "Read a page",
        tags: ["Pages"],
        "x-permission": "pages:read",
        parameters: [WORKSPACE, VIEW],
        responses: { "200": ok("The page's markdown or HTML", ref("Page")) },
      }),
      put: op({
        operationId: "putPage",
        summary: "Replace a page's text",
        description:
          "Document pages need staff or above; custom HTML pages are shown to the public, so only owners and admins may change them. The previous text is kept as a version.",
        tags: ["Pages"],
        "x-permission": "pages:write",
        parameters: [WORKSPACE, VIEW],
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["text"],
            properties: { text: { type: "string", maxLength: 1000000 } },
          }),
        },
        responses: {
          "200": ok("Saved", {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              type: { type: "string" },
              characters: { type: "integer" },
              updatedAt: { type: "string", format: "date-time" },
            },
          }),
          "413": error("The text is longer than 1,000,000 characters"),
        },
      }),
    },
    "/workspaces/{id}/change-requests": {
      post: op({
        operationId: "proposeChange",
        summary: "Propose a design change",
        description:
          "Leaves a request (a new field, page or automation) for the owners and admins, who review it under History. Nothing changes until they apply it.",
        tags: ["Changes"],
        "x-permission": "design:propose",
        parameters: [WORKSPACE],
        requestBody: {
          required: true,
          ...json({
            type: "object",
            required: ["request"],
            properties: { request: { type: "string", maxLength: 2000 } },
          }),
        },
        responses: {
          "201": ok("Saved for review", {
            type: "object",
            properties: { requestId: { type: "integer" }, message: { type: "string" } },
          }),
        },
      }),
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "An API key from Account → API keys (eo_live_…). Up to 120 requests a minute per key.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", examples: ["invalid", "not_found", "conflict"] },
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
      Workspace: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: { type: "string", enum: ["owner", "admin", "staff", "viewer"] },
          permissions: { type: "array", items: { type: "string" } },
        },
      },
      Schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          timeZone: { type: "string" },
          currency: { type: "string" },
          recordTypes: { type: "array", items: { type: "object" } },
          pages: { type: "array", items: { type: "object" } },
          automations: { type: "array", items: { type: "object" } },
        },
      },
      Record: {
        type: "object",
        description: "A record's fields by id, plus id, rev and linkedNames (names of linked records).",
        properties: { id: { type: "string" }, rev: { type: "integer" } },
        additionalProperties: true,
      },
      Values: {
        type: "object",
        description:
          "Field ids or names to values: choices by label, links by the linked record's name or id, dates YYYY-MM-DD, times on the workspace's clock, time ranges as {start, end}.",
        additionalProperties: true,
      },
      WriteMeta: {
        type: "object",
        properties: { automations: { type: "array", items: { type: "string" } } },
      },
      Page: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          text: { type: "string" },
          truncated: { type: "boolean" },
        },
      },
    },
  },
} as const;

export type Method = "get" | "post" | "patch" | "put" | "delete";

/** Every operation, in order: for the docs page, the client and the contract test. */
export const operations = Object.entries(openapi.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, o]) => ({
    path,
    method: method as Method,
    ...(o as ReturnType<typeof op>),
  })),
);
