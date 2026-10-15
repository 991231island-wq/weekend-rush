import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveService, dateInput, todayShanghai } from '../server/live-service.mjs';
import { generatePlans, normalizePlanInput } from '../server/planner.mjs';
import { PublicError } from '../server/mcp-gateway.mjs';
import { createLiveServer } from '../scripts/serve-live.mjs';
import { validatePlan } from '../skills/weekend-rush/scripts/trip-utils.mjs';

const input = () => ({ originCity:'杭州',destinationCity:'上海',fromStationCode:'HGH',toStationCode:'AOH',departureDate:'2099-10-17',returnDate:'2099-10-18',outboundTicketId:'out',returnTicketId:'back',outboundSeat:'二等座',returnSeat:'二等座',stationPoiId:'station',overnightPoiId:'hotel',places:[{id:'bund',required:true,durationMinutes:90,admissionCny:''}],budgetCny:1000,foodDailyCny:120,hotelCny:260,transitDailyCny:30,homeTransferMinutes:45,earliestLeaveTime:'06:00',latestHomeTime:'21:00' });
const points = {station:{id:'station',name:'上海虹桥站',type:'交通设施服务;火车站',location:'121.32,31.20'},hotel:{id:'hotel',name:'住宿参考',location:'121.47,31.23'},bund:{id:'bund',name:'外滩',location:'121.49,31.23'}};
const seat = {name:'二等座',status:'available',priceCny:87};
function service(overrides={}) {
  return { async tickets(query) {const back=query.fromCity==='上海';return {tickets:[{id:back?'back':'out',trainCode:back?'G2':'G1',from:{name:query.fromCity+'虹桥'},to:{name:back?'杭州东':'上海虹桥'},departureAt:`${query.date}T${back?'17:00':'08:30'}:00+08:00`,arrivalAt:`${query.date}T${back?'18:00':'09:30'}:00+08:00`,seats:[seat],queriedAt:'2099-10-15T00:00:00Z'}],to:{name:back?'杭州东':'上海虹桥'},source:'fake rail',queriedAt:'2099-10-15T00:00:00Z',rejectedCount:0};},async detail({id}){return {...points[id],source:'fake map',queriedAt:'2099-10-15T00:00:00Z'};},async route(){return {durationMinutes:30,walkingMeters:400,distanceMeters:2000,mode:'transit',source:'fake map',queriedAt:'2099-10-15T00:00:00Z'};},...overrides};
}
test('rejects impossible calendar dates, nonconsecutive nights and duplicate POIs',()=>{
  assert.throws(()=>dateInput('2026-02-30'),/有效/);
  assert.throws(()=>normalizePlanInput({...input(),returnDate:'2099-10-19'}),/相邻/);
  assert.throws(()=>normalizePlanInput({...input(),places:[input().places[0],input().places[0]]}),/重复/);
});
test('live plans retain unknown fees and booking checks, reserve lunch separately from breakfast',async()=>{
  const result=await generatePlans(service(),input());
  for(const plan of result.variants){
    assert.equal(plan.status,'draft'); assert.equal(plan.validation.feasible,false); assert.equal(plan.validation.totalCostCents,null);
    assert.equal(plan.validation.knownCostCents,73400);
    const meals=plan.events.filter(row=>row.source==='用户餐饮预算与用餐时长估算');
    assert.equal(meals.filter(row=>row.startAt.startsWith('2099-10-18')).length,2);
    assert.equal(plan.events.filter(row=>row.kind==='visit').length,1);
    assert.ok(plan.events.every((row,index)=>!index||Date.parse(row.startAt)>=Date.parse(plan.events[index-1].endAt)));
  }
});
test('an early train and a sold-out selected seat are rejected before planning',async()=>{
  await assert.rejects(generatePlans(service(),{...input(),earliestLeaveTime:'08:00'}),error=>error.code==='OUTBOUND_TOO_EARLY');
  const fake=service(); const original=fake.tickets;
  fake.tickets=async query=>{const result=await original(query);result.tickets[0].seats=[{...seat,status:'sold-out'}];return result;};
  await assert.rejects(generatePlans(fake,input()),error=>error.code==='TICKET_CHANGED');
});
test('wrong station POI is rejected; routes do not substitute guesses when tools fail',async()=>{
  await assert.rejects(generatePlans(service({async detail(){return {...points.station,type:'地铁站'};}}),input()),error=>error.code==='STATION_POI_MISMATCH');
  await assert.rejects(generatePlans(service({async detail(){return {...points.station,name:'上海虹桥站(北出站口)'};}}),input()),error=>error.code==='STATION_POI_MISMATCH');
  const result=await generatePlans(service({async route(){throw new PublicError('NO_ROUTE','路线未取得');}}),input());
  assert.ok(result.variants.every(row=>row.status==='unavailable'));
});
test('budget and arrive-home conflicts remain visible as hard failures',async()=>{
  const result=await generatePlans(service(),{...input(),budgetCny:100,latestHomeTime:'18:30'});
  for(const plan of result.variants){assert.equal(plan.status,'conflict');assert.ok(plan.validation.errors.some(row=>row.code==='budget-exceeded'));assert.ok(plan.validation.errors.some(row=>row.code==='home-deadline-missed'));}
});
test('passing a POI in a transfer does not count as visiting it',()=>{
  const result=validatePlan({events:[{id:'transfer',kind:'transfer',placeId:'bund',startAt:'2099-10-17T09:00:00+08:00',endAt:'2099-10-17T10:00:00+08:00',costCents:0}]},{mustVisitIds:['bund']});
  assert.ok(result.errors.some(row=>row.code==='must-visit-missing'));
});
test('POI details require the selected city and route units come from actual tool values',async()=>{
  const gateway={status:()=>({}),async call(provider,name){return {source:'fixture',queriedAt:'2026-10-15T00:00:00Z',data:name==='maps_search_detail'?{id:'x',name:'外滩',city:'南京市',location:'118.8,32.1'}:name==='maps_direction_walking'?{route:{paths:[{distance:'3000',duration:'2400'}]}}:{route:{distance:'9000',transits:[{walking_distance:'900',duration:'1200'},{walking_distance:'400',duration:'1800'}]}}};}};
  const live=createLiveService(gateway);
  await assert.rejects(live.detail({id:'x',city:'上海'}),error=>error.code==='POI_WRONG_CITY');
  const route=await live.route(points.station,points.bund,'上海','gentle');assert.equal(route.walkingMeters,400);assert.equal(route.durationMinutes,30);assert.equal(route.fareCents,null);
});
test('rail service validates station membership, requests all rows, then filters exact stations',async()=>{
  let args;
  const gateway={status:()=>({}),async call(provider,name,input){
    if(name==='get-stations-code-in-city')return {data:[{station_name:input.city==='杭州'?'杭州东':'上海虹桥',station_code:input.city==='杭州'?'HGH':'AOH'}]};
    args=input;
    return {queriedAt:new Date().toISOString(),data:[{start_train_code:'G1',from_station_telecode:'HZH',to_station_telecode:'AOH',start_time:'23:00',arrive_time:'23:40',lishi:'00:40'},{start_train_code:'G2',from_station_telecode:'HGH',to_station_telecode:'AOH',start_time:'23:00',arrive_time:'23:40',lishi:'00:40'}]};
  }};
  const live=createLiveService(gateway);const query={date:todayShanghai(),fromCity:'杭州',toCity:'上海',fromStationCode:'HGH',toStationCode:'AOH'};
  const result=await live.tickets(query);assert.equal(args.limitedNum,0);assert.equal(result.rejectedCount,1);assert.ok(result.tickets.every(row=>row.trainCode==='G2'));
  await assert.rejects(live.tickets({...query,fromStationCode:'BAD'}),error=>error.code==='INVALID_STATIONS');
});
test('HTTP service rejects foreign origins, invalid JSON, and does not expose a credential',async t=>{
  const app=createLiveServer({service:{status:()=>({mapKeyConfigured:true}),stations:async city=>({city})}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.server.address().port}`;
  assert.deepEqual(await (await fetch(url+'/api/status')).json(),{mapKeyConfigured:true});
  assert.equal((await fetch(url+'/api/stations',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/stations',{method:'POST',headers:{'content-type':'application/json'},body:'broken'})).status,400);
  assert.deepEqual(await (await fetch(url+'/api/stations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({city:'上海'})})).json(),{city:'上海'});
  assert.equal((await fetch(url+'/live.js')).status,200);
});
