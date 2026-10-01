import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {planDynamicResearch} from '../src/dynamicResearch/planner.js';
import {scenarios,replayScenario,simulatedDelaysMs} from '../evaluation/dynamicResearchEfficiency/fixture.js';

if(!process.argv[2])throw Error('Usage: node backend/scripts/compare-dynamic-research-efficiency.js /path/to/baseline/backend/src/dynamicResearch/planner.js');
const baseline=await import(pathToFileURL(resolve(process.argv[2])).href);
const reports=[];
for(const scenario of scenarios) {
  const pairs=[];
  for(let i=0;i<5;i++) {
    // Alternate order to reduce fixed first-run bias. All provider work is synthetic.
    const run=plan=>replayScenario(plan,scenario,{delays:simulatedDelaysMs});
    const [before,after]=i%2===0?[await run(baseline.planDynamicResearch),await run(planDynamicResearch)]
      :await (async()=>{const after=await run(planDynamicResearch);return [await run(baseline.planDynamicResearch),after];})();
    assert.deepEqual(before.attemptedItineraries,after.attemptedItineraries);
    assert.deepEqual(before.result.statistics,after.result.statistics);
    assert.deepEqual(before.result.places,after.result.places);
    assert.deepEqual(before.result.webResearch,after.result.webResearch);
    assert.ok(after.calls.selection<before.calls.selection);
    pairs.push({before,after});
  }
  const summarize=side=>{
    const runs=pairs.map(p=>p[side]),first=runs[0];
    for(const run of runs)assert.deepEqual(run.calls,first.calls);
    const times=runs.map(r=>r.simulatedWallMs).sort((a,b)=>a-b);
    return {calls:first.calls,googleCallsExcludingIntent:first.googleCallsExcludingIntent,
      historyBytes:first.historyBytes,simulatedWallMs:{minimum:times[0],median:times[2],maximum:times[4]}};
  };
  reports.push({scenario:scenario.name,before:summarize('before'),after:summarize('after')});
}
console.log(JSON.stringify({kind:'offline-synthetic-orchestration-replay',repetitions:5,simulatedDelaysMs,
  limitations:'No network, real model, real routing or intent parser runs here. Identical synthetic evidence, decisions, revisions and outputs; timing is injected latency plus local scheduling, never measured provider latency. Initial intent parsing is excluded.',reports},null,2));
