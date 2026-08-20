// main — entry point: creates the HTTP client and runs the crawl.

import { createClient, errMessage } from "./lib/http";
import { run } from "./scrape/run";

async function main(): Promise<void> {
  const client = createClient();
  try {
    await run(client);
  } catch (err) {
    console.error(`\nFatal error: ${errMessage(err)}`);
    process.exitCode = 1;
  }
}

main();