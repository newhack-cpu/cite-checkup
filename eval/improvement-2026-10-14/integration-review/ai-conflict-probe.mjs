import { writeFileSync } from 'node:fs';
import { prepareAIReferences } from '../../../src/lib/ai/index.ts';
import { parseReference } from '../../../src/lib/verify/extract.ts';
import { verifyReference } from '../../../src/lib/verify/verify.ts';
process.env.DEEPSEEK_API_KEY='offline-fixture-never-real';process.env.DEEPSEEK_BASE_URL='https://api.deepseek.com';
const record={DOI:'10.9999/ai-conflict',title:['Deep learning'],author:[{family:'LeCun',given:'Yann'},{family:'Bengio',given:'Yoshua'},{family:'Hinton',given:'Geoffrey'}],issued:{'date-parts':[[2015]]},'container-title':['Nature'],type:'journal-article'};
let fields;
let raw;
globalThis.fetch=async input=>{
const u=new URL(String(input));
if(u.hostname==='api.deepseek.com')return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'fixture',type:'function',function:{name:'verify_references',arguments:JSON.stringify({references:[{sourceIndex:1,raw,...fields}]})}}]}}]});
if(u.hostname==='api.crossref.org')return Response.json({message:record});
if(u.hostname==='api.openalex.org')return Response.json({doi:'https://doi.org/'+record.DOI,title:record.title[0],is_retracted:false});
throw Error('Unexpected fixture host');};
const outputs=[];
for(const [id,reference,extracted] of [
['year-conflict-hidden','LeCun, Y., Bengio, Y., & Hinton, G. (2020). Deep learning. Nature, 521(7553), 2015-2020. DOI: 10.9999/ai-conflict',{year:2015}],
['venue-conflict-hidden','LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature Medicine, 521(7553), 436-444. DOI: 10.9999/ai-conflict',{venue:'Nature'}]
]){raw=reference;fields=extracted;const standard=await verifyReference(parseReference(raw,1),{openalexBudget:{left:20}});const prepared=await prepareAIReferences(raw);const ai=await verifyReference(prepared.refs[0],{openalexBudget:{left:20}});outputs.push({id,raw,extracted,standard:{verdict:standard.verdict,issues:standard.issues},ai:{verdict:ai.verdict,issues:ai.issues}});}
writeFileSync(new URL('ai-conflict-results.json',import.meta.url),JSON.stringify(outputs,null,2));console.log(JSON.stringify(outputs,null,2));
