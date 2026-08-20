// lib/log — console output. info always; debug only with VERBOSE=1.
// Detailed errors go to errors/events.jsonl (lib/errorLog), not the console.

import { VERBOSE } from "../config";

export const debug = (...args: unknown[]): void => {
  if (VERBOSE) console.log(...args);
};

export const info = (...args: unknown[]): void => console.log(...args);