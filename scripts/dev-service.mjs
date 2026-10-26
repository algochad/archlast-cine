#!/usr/bin/env node
/**
 * Thin launcher used by every workspace's `dev` script so `turbo run dev` can
 * start the whole stack safely:
 *
 *   node scripts/dev-service.mjs [--port N] [--need BIN] [--env K=V]... -- <cmd> [args]
 *
 *  - loads the repo-root `.env` (process env always wins),
 *  - `--port N`  : if something already listens on N, reuse it and exit 0,
 *  - `--need BIN`: if BIN is not on PATH, print a hint and exit 0 (the rest of
 *                  the stack keeps running),
 *  - `--env K=V` : default for K when it is not already set.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(path) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(700);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const opts = sep === -1 ? argv : argv.slice(0, sep);
const cmd = sep === -1 ? [] : argv.slice(sep + 1);
if (!cmd.length) {
  console.error("dev-service: missing `-- <command>`");
  process.exit(2);
}

loadDotEnv(join(ROOT, ".env"));
let port;
const needs = [];
for (let i = 0; i < opts.length; i += 1) {
  if (opts[i] === "--port") port = Number(opts[++i]);
  else if (opts[i] === "--need") needs.push(opts[++i]);
  else if (opts[i] === "--env") {
    const [k, ...rest] = opts[++i].split("=");
    if (process.env[k] === undefined) process.env[k] = rest.join("=");
  }
}

const tag = process.env.npm_package_name ?? cmd[0];
for (const bin of needs) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
  if (probe.status !== 0) {
    console.log(`[${tag}] \`${bin}\` is not installed — skipping this service.`);
    process.exit(0);
  }
}
if (port && (await portOpen(port))) {
  console.log(`[${tag}] something is already listening on :${port} — reusing it.`);
  process.exit(0);
}

const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env: process.env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
