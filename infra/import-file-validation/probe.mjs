import * as api from '../../packages/importers/dist/index.js';
import { corpus, executeCorpus } from './corpus.mjs';
import { executeOfxCorpus } from '../ofx-parser/corpus.mjs';

const started = globalThis.performance.now();
const results = executeCorpus(api, corpus());
const ofxStarted = globalThis.performance.now();
const ofxResults = await executeOfxCorpus(api);
console.log(
  JSON.stringify({
    results,
    ofx_results: ofxResults,
    ofx_duration_ms: globalThis.performance.now() - ofxStarted,
    duration_ms: globalThis.performance.now() - started,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
  }),
);
