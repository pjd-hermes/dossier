// Starts what the end-to-end tests run against, without running any tests: the
// fake AI, job and Google servers, a fresh `dossier_e2e` database with the demo
// data, and the built app (`yarn build` first). For someone, or an agent
// (.claude/skills/exploratory-test), to use the app by hand. Stop with Ctrl-C.
//
//   yarn e2e:serve        then open http://localhost:3100, password: e2e-password

import { spawn, type ChildProcess } from "node:child_process";

import { APP_PORT, appEnv, FAKE_AI_PORT, FAKE_GOOGLE_PORT, FAKE_JOBS_PORT, PASSWORD, resetData } from "./support";

const children: ChildProcess[] = [];
const start = (command: string, args: string[], env: Record<string, string> = {}) => {
  const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env }, shell: false });
  children.push(child);
  return child;
};
const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", () => (stop(), process.exit(0)));
process.on("SIGTERM", () => (stop(), process.exit(0)));

async function waitFor(url: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} didn't come up`);
}

start("node", ["e2e/fake-ai.mts"], { FAKE_AI_PORT: String(FAKE_AI_PORT) });
start("node", ["e2e/fake-jobs.mts"], { FAKE_JOBS_PORT: String(FAKE_JOBS_PORT) });
start("node", ["e2e/fake-google.mts"], { FAKE_GOOGLE_PORT: String(FAKE_GOOGLE_PORT) });
await Promise.all([FAKE_AI_PORT, FAKE_JOBS_PORT, FAKE_GOOGLE_PORT].map((port) => waitFor(`http://localhost:${port}/health`)));

const env = { ...appEnv(), HOSTNAME: "127.0.0.1" };
// Migrates the e2e database and the standalone server's static files, as playwright.config.ts does.
await new Promise<void>((resolve, reject) =>
  start("sh", ["-c", "yarn prisma migrate deploy && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/"], env).on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("migrate failed")),
  ),
);
await resetData();
start("node", [".next/standalone/server.js"], env);
await waitFor(`http://localhost:${APP_PORT}/login`);
console.log(`\nDossier is up at http://localhost:${APP_PORT} (password: ${PASSWORD}) with demo data and fake AI, job sources and Google.\n`);
