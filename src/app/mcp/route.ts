import { handleMcp } from "@/server/mcp/server";

/** The account's MCP endpoint: every workspace the API key reaches. */
export const POST = (request: Request) => handleMcp(request, { kind: "account" });
export const GET = POST;
export const DELETE = POST;
