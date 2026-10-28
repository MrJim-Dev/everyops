/**
 * A small local stand-in for Cloud Storage, for QA only: point STORAGE_EMULATOR_HOST at it and nothing is written to
 * a real bucket. It answers what @google-cloud/storage does in EveryOps: simple (multipart) and resumable uploads,
 * downloads (with Range), metadata, delete and copy. Objects live in a folder on disk.
 *
 *   node scripts/storage-stand-in.mjs 4461 /tmp/everyops-storage
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

const port = Number(process.argv[2] ?? 4461);
const root = process.argv[3] ?? "/tmp/everyops-storage";
const sessions = new Map();

/** CRC32C (Castagnoli), base64 big-endian, the way Cloud Storage reports it; the client checks it after uploads. */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32c(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return out.toString("base64");
}

const pathOf = (bucket, name) => join(root, bucket, name);
const metaOf = (bucket, name) => `${pathOf(bucket, name)}.__meta.json`;
function save(bucket, name, bytes, meta) {
  const file = pathOf(bucket, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  const full = {
    kind: "storage#object",
    bucket,
    name,
    id: `${bucket}/${name}`,
    size: String(bytes.length),
    md5Hash: createHash("md5").update(bytes).digest("base64"),
    crc32c: crc32c(bytes),
    contentType: meta.contentType ?? "application/octet-stream",
    metadata: meta.metadata ?? {},
    cacheControl: meta.cacheControl,
    timeCreated: new Date().toISOString(),
    updated: new Date().toISOString(),
    generation: String(Date.now()),
  };
  writeFileSync(metaOf(bucket, name), JSON.stringify(full));
  return full;
}
const load = (bucket, name) =>
  existsSync(metaOf(bucket, name)) ? JSON.parse(readFileSync(metaOf(bucket, name), "utf8")) : null;

const body = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
const json = (res, status, data, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
};

/** multipart/related: a JSON metadata part, then the media part. */
function multipart(buffer, type) {
  const boundary = `--${/boundary="?([^";]+)"?/.exec(type)?.[1]}`;
  const parts = [];
  let at = buffer.indexOf(boundary);
  while (at >= 0) {
    const next = buffer.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = buffer.subarray(at + boundary.length, next);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) parts.push(part.subarray(split + 4, part.length - 2));
    at = next;
  }
  return { meta: JSON.parse(parts[0]?.toString("utf8") || "{}"), media: parts[1] ?? Buffer.alloc(0) };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;
  try {
    let m = /^\/upload(?:\/storage\/v1)?\/b\/([^/]+)\/o$/.exec(path);
    if (m && req.method === "POST") {
      const bucket = m[1];
      const type = url.searchParams.get("uploadType");
      const data = await body(req);
      if (type === "multipart") {
        const { meta, media } = multipart(data, req.headers["content-type"] ?? "");
        const name = meta.name ?? url.searchParams.get("name");
        return json(res, 200, save(bucket, name, media, meta));
      }
      if (type === "resumable") {
        const meta = data.length ? JSON.parse(data.toString("utf8")) : {};
        const name = meta.name ?? url.searchParams.get("name");
        const id = randomUUID();
        sessions.set(id, {
          bucket,
          name,
          meta: { ...meta, contentType: meta.contentType ?? req.headers["x-upload-content-type"] },
          chunks: [],
        });
        const location = `http://localhost:${port}/upload/storage/v1/b/${bucket}/o?uploadType=resumable&upload_id=${id}`;
        res.writeHead(200, {
          location,
          "access-control-allow-origin": req.headers.origin ?? "*",
          "access-control-expose-headers": "location",
        });
        return res.end();
      }
    }
    if (m && (req.method === "PUT" || req.method === "POST") && url.searchParams.get("upload_id")) {
      const session = sessions.get(url.searchParams.get("upload_id"));
      if (!session) return json(res, 404, { error: { message: "No such upload" } });
      session.chunks.push(await body(req));
      const range = req.headers["content-range"];
      const total = range ? /\/(\d+|\*)$/.exec(range)?.[1] : undefined;
      const have = session.chunks.reduce((n, c) => n + c.length, 0);
      if (total && total !== "*" && have < Number(total)) {
        res.writeHead(308, { range: `bytes=0-${have - 1}`, "access-control-allow-origin": "*" });
        return res.end();
      }
      sessions.delete(url.searchParams.get("upload_id"));
      return json(res, 200, save(session.bucket, session.name, Buffer.concat(session.chunks), session.meta), {
        "access-control-allow-origin": req.headers.origin ?? "*",
      });
    }
    if (m && req.method === "OPTIONS") {
      res.writeHead(200, {
        "access-control-allow-origin": req.headers.origin ?? "*",
        "access-control-allow-methods": "PUT, POST, OPTIONS",
        "access-control-allow-headers": "content-type, content-range",
      });
      return res.end();
    }
    const list = /^(?:\/storage\/v1)?\/b\/([^/]+)\/o$/.exec(path);
    if (list && req.method === "GET") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const items = [];
      const walk = (dir, rel) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const name = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(join(dir, entry.name), name);
          else if (!entry.name.endsWith(".__meta.json") && name.startsWith(prefix))
            items.push(load(list[1], name));
        }
      };
      walk(join(root, list[1]), "");
      return json(res, 200, { kind: "storage#objects", items: items.filter(Boolean) });
    }
    m =
      /^(?:\/download)?(?:\/storage\/v1)?\/b\/([^/]+)\/o\/(.+?)(\/(?:copyTo|rewriteTo)\/b\/([^/]+)\/o\/(.+))?$/.exec(
        path,
      );
    if (m) {
      const bucket = m[1];
      const name = decodeURIComponent(m[2]);
      if (m[3] && req.method === "POST") {
        const meta = load(bucket, name);
        if (!meta) return json(res, 404, { error: { code: 404, message: "Not found" } });
        await body(req);
        const copied = save(m[4], decodeURIComponent(m[5]), readFileSync(pathOf(bucket, name)), meta);
        return json(
          res,
          200,
          m[3].includes("rewriteTo")
            ? { kind: "storage#rewriteResponse", done: true, resource: copied }
            : copied,
        );
      }
      const meta = load(bucket, name);
      if (req.method === "DELETE") {
        if (!meta) return json(res, 404, { error: { code: 404, message: "Not found" } });
        rmSync(pathOf(bucket, name));
        rmSync(metaOf(bucket, name));
        res.writeHead(204);
        return res.end();
      }
      if (!meta) return json(res, 404, { error: { code: 404, message: "Not found" } });
      if (url.searchParams.get("alt") === "media" || path.startsWith("/download/")) {
        const bytes = readFileSync(pathOf(bucket, name));
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
          res.writeHead(206, {
            "content-type": meta.contentType,
            "content-range": `bytes ${start}-${end}/${bytes.length}`,
          });
          return res.end(bytes.subarray(start, end + 1));
        }
        res.writeHead(200, { "content-type": meta.contentType, "content-length": bytes.length });
        return res.end(bytes);
      }
      return json(res, 200, meta);
    }
    json(res, 404, { error: { code: 404, message: `Stand-in doesn't answer ${req.method} ${path}` } });
  } catch (error) {
    json(res, 500, { error: { code: 500, message: String(error) } });
  }
}).listen(port, () => console.log(`Cloud Storage stand-in on :${port}, files in ${root}`));
