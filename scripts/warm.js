// Hits all routes so Turbopack pre-compiles them in the background.
// Run after `next dev` is ready.
const routes = ["/", "/my-people", "/update", "/search", "/emails"];
// Next.js may shift to 3001/3002/etc if 3000 is taken — honour $PORT if set
// Use 127.0.0.1 (not localhost) so Node's fetch hits IPv4; on many macOS setups
// localhost resolves to ::1 first while Next listens on IPv4, causing warm.js
// to time out with "Could not reach server" even after "Ready".
const port = process.env.PORT || 3000;
const base = `http://127.0.0.1:${port}`;

async function tryFetch(route, attempt = 1) {
  try {
    const r = await fetch(base + route, { signal: AbortSignal.timeout(120_000) });
    console.log(`  ✓ ${route} (${r.status})`);
  } catch {
    if (attempt < 3) {
      await new Promise(res => setTimeout(res, 3000));
      return tryFetch(route, attempt + 1);
    }
    console.log(`  ✗ ${route} failed`);
  }
}

async function waitForServer(retries = 90) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(base, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      process.stdout.write(i === 0 ? "Waiting for server" : ".");
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  return false;
}

(async () => {
  const ready = await waitForServer();
  if (!ready) { console.log("\nCould not reach server."); process.exit(1); }
  console.log("\n🔥 Pre-compiling all routes...");
  // Sequential so Turbopack isn't overwhelmed
  for (const route of routes) await tryFetch(route);
  console.log("✓ All routes ready — no more compile waits.\n");
})();
