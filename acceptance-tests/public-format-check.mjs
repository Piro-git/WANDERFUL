import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.env.CANDIDATE_ROOT??process.cwd();
const {fetchSourceHTML,parseSourceDocument}=await import(pathToFileURL(`${root}/backend/src/dynamicResearch/sourceDocuments.js`));
const urls=['https://mairie-dieulefit.fr/pratique/fermetures-rues','https://lakedistrict.gov.uk/route/keswick-railway-path/'];
const results=[];
for(const url of urls){let requests=0;try{
 const page=await fetchSourceHTML(url,{generic:true,reserveSource:()=>++requests<=2});
 const doc=parseSourceDocument(page.html,{url:page.url,retrievedAt:new Date().toISOString(),generic:true});
 results.push({url,finalURL:page.url,requests,title:doc.title,htmlBytes:Buffer.byteLength(page.html),sha256:createHash('sha256').update(page.html).digest('hex'),passages:doc.passages.length,entities:doc.entities.length,hasOriginalLanguageRestriction:doc.passages.some(p=>/fermeture|closure|restricted/i.test(p.text)),outcome:'parsed'});
}catch(e){results.push({url,requests,outcome:'unavailable',reason:e.message});}}
console.log(JSON.stringify({scope:'two bounded unauthenticated public HTML format checks; no model extraction or current-route validity claim',checkedAt:new Date().toISOString(),results},null,2));
