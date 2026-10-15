import test from 'node:test';
import assert from 'node:assert/strict';
import { runQueries } from '../skills/weekend-rush/scripts/query-tools.mjs';
import { renderTrip, assessItinerary } from '../skills/weekend-rush/scripts/render-trip.mjs';
import { PublicError } from '../server/mcp-gateway.mjs';

const event = (id,kind,date,start,end,extra={}) => ({id,kind,title:id,startAt:`${date}T${start}:00+08:00`,endAt:`${date}T${end}:00+08:00`,costCents:0,costStatus:'estimate',source:'测试估算',...extra});
const card = () => ({title:'建筑与美食',generatedAt:'2026-10-15T22:00:00+08:00',constraints:{budgetCents:100000,mustVisitIds:['bund']},plans:[{name:'推荐',events:[event('bund','visit','2026-10-17','10:00','11:00',{placeId:'bund',costCents:null,costStatus:'unknown',openingStatus:'unknown'}),event('lunch1','meal','2026-10-17','11:00','12:00'),event('rest','rest','2026-10-17','12:00','12:30'),event('hotel','stay','2026-10-17','20:00','23:00'),event('street','visit','2026-10-18','10:00','11:00'),event('lunch2','meal','2026-10-18','11:00','12:00')]}]});
test('query batches keep independent results and never invent data after failure',async()=>{
  const calls=[];const result=await runQueries({async search(input){calls.push(input.city);throw new PublicError('QUOTA','受限');},async stations(city){calls.push(city);return {stations:[{name:'杭州东',code:'HGH'}]};}},{queries:[{id:'search',operation:'search',input:{city:'上海'}},{id:'stations',operation:'stations',input:{city:'杭州'}},{id:'unknown',operation:'constructor'}]});
  assert.equal(result.ok,false);assert.deepEqual(calls,['上海','杭州']);assert.equal(result.results[0].code,'QUOTA');assert.equal(result.results[0].result,undefined);assert.equal(result.results[1].result.stations[0].code,'HGH');assert.equal(result.results[2].code,'UNKNOWN_OPERATION');
});
test('itinerary renderer distinguishes unknown totals and incomplete meal/lodging plans',()=>{
  const complete=assessItinerary(card())[0];assert.deepEqual(complete.completeness,[]);assert.equal(complete.validation.feasible,false);assert.equal(complete.validation.totalCostCents,null);
  const incomplete=card();incomplete.plans[0].events=incomplete.plans[0].events.filter(row=>!['meal','stay','rest'].includes(row.kind));
  const report=assessItinerary(incomplete)[0];assert.equal(report.completeness.length,4);
  const html=renderTrip(card());assert.match(html,/费用待确认/);assert.match(html,/预算无法完整验证/);
});
test('unsafe venue text and URL credentials do not become executable HTML',()=>{
  const input=card();input.title='<script>alert(1)</script>';input.plans[0].events[0].title='<img src=x onerror=alert(2)>';input.plans[0].events[0].sourceUrl='javascript:alert(3)';
  let html=renderTrip(input);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('href="javascript:'));
  input.plans[0].events[0].sourceUrl='https://example.com/?key=credential';html=renderTrip(input);assert.ok(!html.includes('key=credential'));
});
test('a hard-conflict itinerary is visibly blocked rather than labeled fully feasible',()=>{
  const input=card();input.constraints.budgetCents=1;input.plans[0].events[1].costCents=1000;
  assert.match(renderTrip(input),/存在硬约束冲突，不可直接采用/);
  assert.throws(()=>renderTrip({...input,plans:[]}),/1–2/);
});
