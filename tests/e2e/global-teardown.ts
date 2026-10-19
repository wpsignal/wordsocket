import { wp } from "./env";
import { PARKED_PLUGINS_FILE } from "./global-setup";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";

/** Reactivate the plugins the global setup parked, so the E2E site is left as it was found. */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(PARKED_PLUGINS_FILE)) return;
  const parked = JSON.parse(await readFile(PARKED_PLUGINS_FILE, "utf8")) as string[];
  for (const name of parked) {
    try {
      wp("plugin", "activate", name);
    } catch {
      // Gone since the run started: nothing to put back.
    }
  }
  await rm(PARKED_PLUGINS_FILE, { force: true });
}
