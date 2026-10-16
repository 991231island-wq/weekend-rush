import test from 'node:test';
import assert from 'node:assert/strict';
import { runQueries } from '../skills/weekend-rush/scripts/query-tools.mjs';
import { renderTrip, assessItinerary } from '../skills/weekend-rush/scripts/render-trip.mjs';
import { PublicError } from '../server/mcp-gateway.mjs';
import { createInformationPorts } from '../skills/weekend-rush/scripts/information-ports.mjs';

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
test('legacy itinerary cards keep route summaries when ordered route details are absent',()=>{
  const input=card();input.plans[0].events[0].mode='transit';input.plans[0].events[0].distanceMeters=null;
  const html=renderTrip(input);assert.match(html,/仅有路线汇总/);assert.doesNotMatch(html,/展开逐段乘车与步行指引/);
});
test('query bridge exposes the bounded around operation and keeps its metadata',async()=>{
  let seen;
  const result=await runQueries({async around(input){seen=input;return {candidates:[{id:'food'}],source:'AMap MCP',queriedAt:'2026-10-16T00:00:00Z'};}},{operation:'around',input:{city:'上海',anchorId:'bund',keywords:'餐厅',radius:1000}});
  assert.equal(result.ok,true);assert.deepEqual(seen,{city:'上海',anchorId:'bund',keywords:'餐厅',radius:1000});assert.equal(result.results[0].result.candidates[0].id,'food');
});
test('unconnected food, lodging, admission and opening ports report their state without fabricated data',async()=>{
  const ports=createInformationPorts();
  const sources=ports.status();
  assert.deepEqual(sources.map(row=>row.kind),['meal-price','hotel-rate','admission','opening-hours']);
  assert.ok(sources.every(row=>row.connected===false));
  await assert.rejects(ports.lookup({kind:'hotel-rate',city:'上海',date:'2026-10-17',placeName:'测试酒店'}),error=>error.code==='SOURCE_NOT_CONNECTED');
  const result=await runQueries({informationStatus:ports.status,informationLookup:ports.lookup},{queries:[{operation:'information-sources'},{operation:'information-lookup',input:{kind:'admission',city:'上海',date:'2026-10-17',placeName:'测试景点'}}]});
  assert.equal(result.results[0].result[0].connected,false);
  assert.equal(result.results[1].code,'SOURCE_NOT_CONNECTED');
  assert.equal(result.results[1].result,undefined);
});
test('connected information port requires dated, sourced evidence and never changes budget by itself',async()=>{
  const query=async()=>({status:'found',items:[{label:'标准票',amountCents:8000,source:'场馆官网',sourceUrl:'https://venue.example.com/ticket',queriedAt:'2026-10-16T10:00:00+08:00',validForDate:'2026-10-17'}]});
  const ports=createInformationPorts({admission:{name:'场馆官网适配器',query}});
  const evidence=await ports.lookup({kind:'admission',city:'上海',date:'2026-10-17',placeName:'测试景点'});
  assert.equal(evidence.items[0].amountCents,8000);
  const input=card();input.plans[0].events[0].informationEvidence=[evidence];
  const before=assessItinerary(input)[0].validation;
  assert.equal(before.totalCostCents,null);
  const html=renderTrip(input);assert.match(html,/标准票：¥80.00/);assert.match(html,/适用 2026-10-17/);assert.match(html,/不会自动计入预算/);
  const bad=createInformationPorts({admission:{query:async()=>({status:'found',items:[{...evidence.items[0],sourceUrl:'https://venue.example.com/?token=secret'}]})}});
  await assert.rejects(bad.lookup({kind:'admission',city:'上海',date:'2026-10-17',placeName:'测试景点'}),error=>error.code==='INFORMATION_RESPONSE');
});
test('itinerary cards show route details and label map reference fields without overstating them',()=>{
  const input=card();input.weather={city:'上海',source:'AMap MCP',queriedAt:'2026-10-16T00:00:00Z',forecasts:[{date:'2026-10-17',dayweather:'晴',nightweather:'多云',daytemp:'22',nighttemp:'15',daywind:'东风',daypower:'≤3'}]};
  input.plans[0].events[0].mode='transit';input.plans[0].events[0].routeDetails={kind:'transit',segments:[{kind:'transit',walking:{distanceMeters:120,durationMinutes:3,steps:[{instruction:'沿中山东一路步行',road:'中山东一路',distanceMeters:120}]},buslines:[{name:'地铁 2 号线',departureStop:'南京东路',arrivalStop:'人民广场',viaStops:['陆家嘴']},{name:'公交 20 路',departureStop:null,arrivalStop:null,viaStops:[]}],entrance:null,exit:null}]};
  input.plans[0].events[0].placeDetails={businessArea:'人民广场',rating:'4.6',referenceConsumption:'人均 ¥88',openingText:'10:00-22:00',photos:[{title:'门店',url:'https://img.example.com/place.jpg'}]};
  const html=renderTrip(input);assert.match(html,/地铁 2 号线/);assert.match(html,/公交 20 路/);assert.match(html,/同一段择一/);assert.match(html,/上车站未返回/);assert.match(html,/途经 陆家嘴/);assert.match(html,/中山东一路/);assert.match(html,/商圈：人民广场/);assert.match(html,/非已确认价格/);assert.match(html,/未按出行日期核实/);assert.match(html,/图片：<a href="https:\/\/img\.example\.com\/place\.jpg"/);assert.match(html,/门店/);assert.match(html,/晴 \/ 多云/);assert.match(html,/风力≤3/);
  input.weather.forecasts=[];assert.match(renderTrip(input),/超出当前返回的预报日期，天气未知/);
});
