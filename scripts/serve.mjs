import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve("site");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404).end("Not found");
    } else if (error instanceof URIError) {
      response.writeHead(400).end("Invalid URL");
    } else {
      console.error("Local server error", error);
      response.writeHead(500).end("Local server error");
    }
  }
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () => {
  console.log(`Bob's SVG Studio: http://127.0.0.1:${server.address().port}`);
});
