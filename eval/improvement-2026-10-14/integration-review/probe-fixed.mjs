import { writeFileSync } from 'node:fs';
import { prepareAIReferences } from '../../../src/lib/ai/index.ts';
import { parseReference } from '../../../src/lib/verify/extract.ts';
import { verifyReference } from '../../../src/lib/verify/verify.ts';
import { buildFixedList } from '../../../src/lib/report.ts';

process.env.DEEPSEEK_API_KEY = 'offline-fixture-never-real';
process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
process.env.DEEPSEEK_MODEL = 'offline-fixture';
const raw = 'LeCun, Y., Smith, J., & Brown, K. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/ai-author-audit';
const record = { DOI: '10.9999/ai-author-audit', title: ['Deep learning'], author: [{family:'LeCun',given:'Yann'}, {family:'Bengio',given:'Yoshua'}, {family:'Hinton',given:'Geoffrey'}], issued:{'date-parts':[[2015]]}, 'container-title':['Nature'], type:'journal-article' };
let active = record;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if(url.hostname === 'api.deepseek.com') return Response.json({ choices:[{ finish_reason:'tool_calls', message:{role:'assistant',tool_calls:[{id:'call-fixture',type:'function',function:{name:'verify_references',arguments:JSON.stringify({references:[{sourceIndex:1,raw,authors:'LeCun, Y.',title:'Deep learning',venue:'Nature',year:2015,doi:'10.9999/ai-author-audit'}]})}}]}}] });
  if(url.hostname === 'api.crossref.org') return Response.json({ message: url.pathname === '/works' ? {items:[active]} : active });
  if(url.hostname === 'api.openalex.org') return Response.json(url.pathname === '/works' ? {results:[]} : {doi:'https://doi.org/'+active.DOI,title:active.title[0],is_retracted:false});
  throw new Error('Unexpected fixture host');
};
const standard = await verifyReference(parseReference(raw,1),{openalexBudget:{left:20}});
const prepared = await prepareAIReferences(raw);
const ai = await verifyReference(prepared.refs[0],{openalexBudget:{left:20}});
active = {...record, DOI:'10.9999/near-audit',title:['Alpha beta gamma delta epsilon zeta']};
const nearRef = parseReference('LeCun, Y., Bengio, Y., & Hinton, G. (2015). Alpha beta gamma delta theta iota. Nature, 521(7553), 436-444.',1);
const near = await verifyReference(nearRef,{openalexBudget:{left:20}});
const output={mode:'offline upstream fixtures only; no network',aiAuthorOmission:{raw,standard:{verdict:standard.verdict,issues:standard.issues,authors:standard.parsed.authorsGuess},ai:{verdict:ai.verdict,issues:ai.issues,authors:ai.parsed.authorsGuess}},nearCandidateExport:{raw:nearRef.raw,verdict:near.verdict,summary:near.summary,confidence:near.confidence,suggestion:near.suggestion,export:buildFixedList([nearRef],new Map([[1,near]]))}};
writeFileSync(new URL('./probe-fixed-results.json', import.meta.url),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));

