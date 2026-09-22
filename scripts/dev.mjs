#!/usr/bin/env node
/**
 * Dev orchestrator: builds/launches the Rust backend (MovieBox-Tui/server),
 * the Archlast Cine API (api/, NestJS) and the Next.js dev server together,
 * restarting none of them if their port is already serving.
 *
 * Env overrides: MB_BACKEND_URL (default http://127.0.0.1:9797),
 * MOVIEBOX_SERVER_PORT (default 9797), MOVIEBOX_PROXY_BASE (default
 * http://localhost:3000 — the external origin that browsers use, needed to
 * rewrite DASH manifest URLs when running behind the Next dev server),
 * API_PORT (default 4100, the Nest service), JWT_SECRET, DATABASE_URL,
 * REDIS_URL.
 *
 * The Archlast Cine API needs Postgres + Redis; when they are not running the
 * script still boots everything and prints `docker compose up -d db redis`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Minimal .env loader (no dependency): the compose file already reads the
 * same file, so `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` overrides and the
 * matching DATABASE_URL / REDIS_URL stay in one place. Existing process env
 * always wins.
 */
function loadDotEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no .env — defaults below apply */
  }
}
loadDotEnv(join(ROOT, ".env"));

const HOST = "127.0.0.1";
const PORT = Number(process.env.MOVIEBOX_SERVER_PORT ?? 9797);
const WEB_PORT = 3000;
const MANIFEST = fileURLToPath(new URL("../MovieBox-Tui/server/Cargo.toml", import.meta.url));
const BACKEND_URL = process.env.MB_BACKEND_URL ?? `http://${HOST}:${PORT}`;

const API_DIR = join(ROOT, "api");
const API_PORT = Number(process.env.API_PORT ?? 4100);
const API_URL = `http://${HOST}:${API_PORT}`;
const PG_PORT = process.env.POSTGRES_HOST_PORT ?? "5432";
const REDIS_HOST_PORT = process.env.REDIS_HOST_PORT ?? "6379";
const DATABASE_URL =
  process.env.DATABASE_URL ?? `postgres://moviebox:moviebox@127.0.0.1:${PG_PORT}/moviebox`;
const REDIS_URL = process.env.REDIS_URL ?? `redis://127.0.0.1:${REDIS_HOST_PORT}`;
const SCRAPER_PORT = Number(process.env.SCRAPER_PORT ?? 9798);
const SCRAPER_URL = `http://${HOST}:${SCRAPER_PORT}`;
const MANGA_API_PORT = Number(process.env.MANGA_API_PORT ?? 8080);
const MANGA_API_URL = process.env.MANGA_API_URL ?? `http://${HOST}:${MANGA_API_PORT}`;
const MANGA_DIR = join(ROOT, "manga-scrapper");
const MANGA_PROJECT = join(
  MANGA_DIR,
  "src",
  "Services",
  "MangaScrapper",
  "MangaScrapper.Api",
  "MangaScrapper.Api.csproj",
);
const MANGA_INFRA_HINT = "docker compose up -d mongo-manga rabbitmq-manga flaresolverr";
const COMPOSE_HINT = "docker compose up -d db redis";

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(700);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function prefix(child, tag) {
  child.stdout?.on("data", (d) => process.stdout.write(`[${tag}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${tag}] ${d}`));
  child.on("exit", (code) => {
    process.stderr.write(`[${tag}] exited (${code})\n`);
  });
}

if (!existsSync(MANIFEST)) {
  console.error(
    "MovieBox-Tui/server not found. Clone the backend fork next to this repo:\n" +
      "  git clone https://github.com/algochad/MovieBox-Tui\n" +
      "or run: npm run sync:backend",
  );
  process.exit(1);
}

const children = [];
const shutdown = () => {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 400).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/** Newest mtime (ms) of any file under `dir`. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const mtime = statSync(join(entry.parentPath ?? entry.path, entry.name)).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/** dist/main.js is stale when any source or config is newer than the build. */
function apiBuildStale() {
  const main = join(API_DIR, "dist", "main.js");
  if (!existsSync(main)) return true;
  const built = statSync(main).mtimeMs;
  const configs = [
    join(API_DIR, "package.json"),
    join(API_DIR, "tsconfig.json"),
    join(API_DIR, "tsconfig.build.json"),
  ]
    .filter(existsSync)
    .map((file) => statSync(file).mtimeMs);
  const newest = Math.max(
    newestMtime(join(API_DIR, "src")),
    newestMtime(join(API_DIR, "prisma")),
    ...configs,
  );
  return newest > built;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    prefix(child, "api:setup");
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      process.stderr.write(`[api:setup] ${error.message}\n`);
      resolve(1);
    });
  });
}

/** First-run install + prisma generate + build (skipped when dist is fresh). */
async function prepareApi() {
  if (!existsSync(join(API_DIR, "node_modules"))) {
    console.log("Installing Archlast Cine API dependencies (api/)…");
    if ((await run("npm", ["ci", "--prefix", "api"])) !== 0) return false;
  }
  const generated = join(API_DIR, "node_modules", ".prisma", "client", "index.js");
  const schema = join(API_DIR, "prisma", "schema.prisma");
  if (!existsSync(generated) || statSync(schema).mtimeMs > statSync(generated).mtimeMs) {
    if ((await run("npm", ["run", "prisma:generate", "--prefix", "api"])) !== 0) return false;
  }
  if (apiBuildStale()) {
    console.log("Building Archlast Cine API (api/)…");
    if ((await run("npm", ["run", "build", "--prefix", "api"])) !== 0) return false;
  }
  return true;
}

/** Poll /v1/health until it answers or `timeoutMs` elapses. */
async function waitForApiHealth(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${API_URL}/v1/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

async function startApi() {
  if (!existsSync(API_DIR)) return;
  if (await portOpen(API_PORT)) {
    console.log(`Archlast Cine API already listening on ${HOST}:${API_PORT} — reusing it.`);
    return;
  }
  if (!(await prepareApi())) {
    console.error("Archlast Cine API unavailable (api/ install or build failed) — continuing.");
    return;
  }

  const api = spawn(process.execPath, [join(API_DIR, "dist", "main.js")], {
    env: {
      ...process.env,
      API_HOST: process.env.API_HOST ?? HOST,
      API_PORT: String(API_PORT),
      JWT_SECRET: process.env.JWT_SECRET ?? "moviebox-dev-secret",
      DATABASE_URL,
      REDIS_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(api);
  prefix(api, "api");

  const health = await waitForApiHealth(120_000);
  if (health?.ok) {
    console.log(`Archlast Cine API ready on ${API_URL} (db + redis ok).`);
    return;
  }
  console.error(
    `Archlast Cine API degraded (${health ? `db=${health.db} redis=${health.redis}` : "no response in 120s"}).`,
  );
  console.error(`Start Postgres + Redis with: ${COMPOSE_HINT}`);
}

async function startScraper() {
  if (await portOpen(SCRAPER_PORT)) {
    console.log(`Anime scraper already listening on ${HOST}:${SCRAPER_PORT} — reusing it.`);
    return;
  }
  
  const goBinary = join(ROOT, "scripts/anime-scraper/anime-scraper");
  const goSource = join(ROOT, "scripts/anime-scraper/main.go");
  
  // Build Go binary if source is newer or binary doesn't exist
  if (!existsSync(goBinary) || statSync(goSource).mtimeMs > statSync(goBinary).mtimeMs) {
    console.log("Building anime scraper Go binary…");
    const build = spawn("go", ["build", "-o", goBinary, "."], {
      cwd: join(ROOT, "scripts/anime-scraper"),
      stdio: ["ignore", "pipe", "pipe"],
    });
    prefix(build, "scraper:build");
    await new Promise((resolve) => build.on("exit", resolve));
    if (!existsSync(goBinary)) {
      console.error("Anime scraper Go build failed — is Go installed?");
      return;
    }
  }
  
  console.log(`Starting anime scraper sidecar on ${HOST}:${SCRAPER_PORT}…`);
  const scraper = spawn(goBinary, [], {
    env: {
      ...process.env,
      SCRAPER_PORT: String(SCRAPER_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(scraper);
  prefix(scraper, "scraper");

  const ready = await new Promise((resolve) => {
    const until = Date.now() + 30_000;
    const poll = async () => {
      if (await portOpen(SCRAPER_PORT)) return resolve(true);
      if (Date.now() > until || scraper.exitCode != null) return resolve(false);
      setTimeout(poll, 500);
    };
    void poll();
  });
  if (!ready) {
    console.error("Anime scraper failed to become ready.");
    return;
  }
  console.log(`Anime scraper ready on ${SCRAPER_URL}`);
}

/** Poll the MangaScrapper /health endpoint until it answers or timeoutMs. */
async function waitForMangaHealth(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${MANGA_API_URL}/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function startMangaApi() {
  if (!existsSync(MANGA_PROJECT)) return;
  if (await portOpen(MANGA_API_PORT)) {
    console.log(`Manga API already listening on ${HOST}:${MANGA_API_PORT} — reusing it.`);
    return;
  }
  try {
    await import("node:util").then(({ promisify }) =>
      promisify(spawn)("dotnet", ["--version"], { stdio: "ignore" }),
    );
  } catch {
    console.error("Manga API unavailable (dotnet SDK not installed) — continuing.");
    console.error("Start the manga stack instead: docker compose -f docker-compose.dev.yml up -d manga-api");
    return;
  }

  console.log(`Starting MangaScrapper API on ${HOST}:${MANGA_API_PORT}…`);
  // --no-launch-profile: launchSettings.json would pin its own port and
  // ignore ASPNETCORE_URLS.
  const manga = spawn("dotnet", ["run", "--project", MANGA_PROJECT, "--no-launch-profile"], {
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Development",
      ASPNETCORE_URLS: `http://${HOST}:${MANGA_API_PORT}`,
      MongoDB__ConnectionString: process.env.MANGA_MONGO_URL ?? "mongodb://localhost:27017",
      MongoDB__DatabaseName: "manga-scrap",
      FlareSolverr__Host: process.env.FLARESOLVERR_HOST ?? "http://localhost:8191",
      Messaging__RabbitMQ__Host: process.env.MANGA_RABBITMQ_HOST ?? "localhost",
      Messaging__RabbitMQ__Port: "5672",
      Messaging__RabbitMQ__Username: "guest",
      Messaging__RabbitMQ__Password: "guest",
      Scrapper__ImageStoragePath: join(MANGA_DIR, "images"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(manga);
  prefix(manga, "manga");

  const ready = await waitForMangaHealth(180_000);
  if (!ready) {
    console.error("Manga API failed to become healthy — is its infra running?");
    console.error(`Start it with: ${MANGA_INFRA_HINT}`);
    return;
  }
  console.log(`Manga API ready on ${MANGA_API_URL}`);
}

async function main() {
  const already = await portOpen(PORT);
  if (already) {
    console.log(`Backend already listening on ${HOST}:${PORT} — reusing it.`);
  } else {
    console.log(`Building & starting Rust backend on ${HOST}:${PORT}…`);
    const backend = spawn("cargo", ["run", "--manifest-path", MANIFEST], {
      env: {
        ...process.env,
        MOVIEBOX_SERVER_HOST: HOST,
        MOVIEBOX_SERVER_PORT: String(PORT),
        MOVIEBOX_REGION: process.env.MOVIEBOX_REGION ?? "ph",
        MOVIEBOX_PROXY_BASE: process.env.MOVIEBOX_PROXY_BASE ?? `http://localhost:${WEB_PORT}`,
        RUST_LOG: process.env.RUST_LOG ?? "warn",
        MANGA_API_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(backend);
    prefix(backend, "backend");

    const ready = await new Promise((resolve) => {
      const until = Date.now() + 180_000;
      const poll = async () => {
        if (await portOpen(PORT)) return resolve(true);
        if (Date.now() > until || backend.exitCode != null) return resolve(false);
        setTimeout(poll, 500);
      };
      void poll();
    });
    if (!ready) {
      console.error("Backend failed to become ready — is cargo installed?");
      shutdown();
      return;
    }
    console.log("Backend ready.");
  }

  await startApi();

  await startScraper();

  await startMangaApi();

  const web = spawn("next", ["dev", "-p", String(WEB_PORT)], {
    env: { ...process.env, MB_BACKEND_URL: BACKEND_URL, API_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(web);
  prefix(web, "web");
  console.log(
    `Web: http://localhost:${WEB_PORT} (backend: ${BACKEND_URL}, api: ${API_URL})`,
  );
}

void main();
