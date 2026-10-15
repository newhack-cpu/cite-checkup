import { writeFileSync } from 'node:fs';
import { parseReference } from '../../../src/lib/verify/extract.ts';
import { verifyReference } from '../../../src/lib/verify/verify.ts';
import { scoreCandidate } from '../../../src/lib/verify/match.ts';
import { mapCrossref } from '../../../src/lib/verify/sources/crossref.ts';

const root = new URL('./', import.meta.url);
const authors = [{ family: 'LeCun', given: 'Yann' }, { family: 'Bengio', given: 'Yoshua' }, { family: 'Hinton', given: 'Geoffrey' }];
const base = { title: ['Deep learning'], author: authors, issued: {'date-parts': [[2015]]}, 'container-title': ['Nature'], type: 'journal-article' };
let current;
let calls;
// All upstream responses are deterministic fixtures. This harness makes no network request.
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url.hostname + url.pathname);
  if (current.failureStatus) return new Response('{}', { status: current.failureStatus });
  if (url.hostname === 'api.crossref.org') {
    return Response.json({ message: url.pathname === '/works' ? { items: current.items ?? [] } : current.record });
  }
  if (url.hostname === 'api.openalex.org') return Response.json({ doi: 'https://doi.org/' + current.record.DOI, title: current.record.title[0], is_retracted: true });
  throw new Error('Unexpected fixture request: ' + url.hostname);
};

const scenarios = [
  {
    id: 'title-mismatch-can-be-verified',
    record: { ...base, DOI: '10.9999/audit-title', title: ['Alpha beta gamma delta epsilon zeta eta theta iota kappa'] },
    raw: 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Alpha beta gamma. Nature, 521(7553), 436-444. DOI: 10.9999/audit-title',
  },
  {
    id: 'second-third-author-order-not-detected',
    record: { ...base, DOI: '10.9999/audit-order' },
    raw: 'LeCun, Y., Hinton, G., & Bengio, Y. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/audit-order',
  },
  {
    id: 'invented-coauthors-not-detected',
    record: { ...base, DOI: '10.9999/audit-authors' },
    raw: 'LeCun, Y., Smith, J., & Brown, K. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/audit-authors',
  },
  {
    id: 'crossref-retracted-prefix-without-update-metadata',
    record: { ...base, DOI: '10.9999/audit-retraction', title: ['RETRACTED: Deep learning'] },
    raw: 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/audit-retraction',
  },
  {
    id: 'upstream-403-becomes-not-found',
    failureStatus: 403,
    raw: 'Smith, J. (2020). Scholarly citation verification under restricted database access. Journal of Research, 2(1), 1-10.',
  },
  {
    id: 'budget-zero-single-source-becomes-not-found',
    record: base,
    items: [],
    budget: 0,
    raw: 'Smith, J. (2020). Verifiable citation checking across journal metadata collections. Journal of Research, 2(1), 1-10.',
  },
];
const results = [];
for (const scenario of scenarios) {
  current = scenario;
  calls = [];
  const parsed = parseReference(scenario.raw, results.length + 1);
  const result = await verifyReference(parsed, { openalexBudget: { left: scenario.budget ?? 20 } });
  results.push({ id: scenario.id, raw: scenario.raw, verdict: result.verdict, confidence: result.confidence, summary: result.summary, issues: result.issues, notes: result.notes, fields: result.fields, calls, score: scenario.record ? scoreCandidate(parsed, mapCrossref(scenario.record)) : undefined });
}
const output = { ranAt: new Date().toISOString(), mode: 'offline mocked upstream fixtures; not an accuracy benchmark', results };
writeFileSync(new URL('edge-case-results.json', root), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));

