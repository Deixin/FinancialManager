import * as api from '../../packages/importers/dist/index.js';
import { corpus, executeCorpus } from './corpus.mjs';

const started = globalThis.performance.now();
const results = executeCorpus(api, corpus());
console.log(
  JSON.stringify({
    results,
    duration_ms: globalThis.performance.now() - started,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
  }),
);
