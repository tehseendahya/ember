#!/usr/bin/env node
// Starts `next dev` and `warm.js` together, cleans up both on exit.
const { spawn } = require("child_process");
const path = require("path");
const root = path.resolve(__dirname, "..");

const nextBin = require.resolve("next/dist/bin/next");
const server = spawn(
  process.execPath,
  [nextBin, "dev"],
  { stdio: "inherit", cwd: root }
);

const warmer = spawn(process.execPath, [path.join(__dirname, "warm.js")], {
  stdio: "inherit",
  cwd: root,
});

function shutdown() {
  server.kill("SIGTERM");
  warmer.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// If next dev exits (crash/restart), exit so the terminal shows the error
server.on("exit", (code) => process.exit(code ?? 0));
