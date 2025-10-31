const http = require("http");
const path = require("path");
const fs = require("fs");

const port = process.env.PORT || 8080;
const rootDir = path.resolve(__dirname);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const serveFile = (filePath, res) => {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("500 Internal Server Error");
    });
    stream.pipe(res);
  });
};

const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(rootDir, requestPath);
  const normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(rootDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  fs.stat(normalizedPath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      filePath = path.join(normalizedPath, "index.html");
      serveFile(filePath, res);
      return;
    }

    if (!err && stats.isFile()) {
      serveFile(normalizedPath, res);
      return;
    }

    const fallbackPath = path.join(rootDir, "index.html");
    serveFile(fallbackPath, res);
  });
});

server.listen(port, () => {
  console.log(`Static server running on http://localhost:${port}`);
  console.log("Cross-origin isolation headers applied.");
});
