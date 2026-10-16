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
test('replacing a place refreshes its POI data and both adjacent route details and walking totals',async()=>{
  const originalDetail=service().detail;
  const fake=service({
    async detail({id}) { if(id==='newpoint') return {id,name:'新选景点',city:'上海',type:'风景名胜',location:'121.50,31.22',businessArea:'新片区',rating:'4.7',source:'fake map',queriedAt:'2099-10-16T00:00:00Z'};return originalDetail({id}); },
    async route(origin,destination) { const legWalk=origin.id==='newpoint'||destination.id==='newpoint'?800:400;return {durationMinutes:30,walkingMeters:legWalk,distanceMeters:null,mode:'transit',routeDetails:{kind:'transit',segments:[{kind:'transit',walking:{distanceMeters:legWalk,durationMinutes:5,steps:[]},buslines:[{name:`line-${origin.id}-${destination.id}`,departureStop:'上车站',arrivalStop:'下车站',viaStops:[]}],entrance:null,exit:null}]},source:'fake map',queriedAt:'2099-10-16T00:00:00Z'}; },
  });
  const first=await generatePlans(fake,input());
  const replacement=await generatePlans(fake,{...input(),places:[{...input().places[0],id:'newpoint'}]});
  for(const [before,after] of first.variants.map((row,index)=>[row,replacement.variants[index]])){
    assert.equal(before.events.find(row=>row.kind==='visit').placeDetails.businessArea,null);
    assert.equal(after.events.find(row=>row.kind==='visit').placeDetails.businessArea,'新片区');
    const routeEvents=after.events.filter(row=>row.kind==='transfer'&&row.routeDetails);
    assert.ok(routeEvents.some(row=>row.routeDetails.segments[0].buslines[0].name.includes('station-newpoint')));
    assert.ok(routeEvents.some(row=>row.routeDetails.segments[0].buslines[0].name.includes('newpoint-')));
    const replacementLegs=routeEvents.filter(row=>row.routeDetails.segments[0].buslines[0].name.includes('newpoint'));
    assert.equal(replacementLegs.length,2);
    assert.ok(replacementLegs.every(row=>row.walkingMeters===800));
    assert.ok(after.totalWalkingMeters>before.totalWalkingMeters);
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

test('POI detail keeps useful AMap business fields and filters placeholders and unsafe photo URLs',async()=>{
  const gateway={status:()=>({}),async call(_provider,name){assert.equal(name,'maps_search_detail');return {source:'AMap MCP',queriedAt:'2026-10-16T00:00:00Z',data:{id:'poi1',name:'餐厅',city:'上海市',type:'餐饮服务',location:'121.48,31.23',address:'南京路',business_area:'人民广场',alias:'老店',rating:'4.6',cost:'人均 ¥88',opentime:'10:00-22:00',photos:[{title:'门面',url:'https://img.example.com/front.jpg'},{url:'http://img.example.com/insecure.jpg'},{url:'https://img.example.com/p.jpg?key=secret'}]}};}};
  const detail=await createLiveService(gateway).detail({city:'上海',id:'poi1'});
  assert.equal(detail.businessArea,'人民广场');assert.equal(detail.alias,'老店');assert.equal(detail.rating,'4.6');assert.equal(detail.referenceConsumption,'人均 ¥88');assert.equal(detail.openingText,'10:00-22:00');assert.deepEqual(detail.photos,[{title:'门面',url:'https://img.example.com/front.jpg'}]);
  gateway.call=async()=>({source:'AMap MCP',queriedAt:'now',data:{id:'poi1',name:'餐厅',city:'上海',location:'121.48,31.23',address:'',business_area:'暂无',alias:'--',rating:'0',cost:'',opentime:'未知',photos:[]}});
  const sparse=await createLiveService(gateway).detail({city:'上海',id:'poi1'});
  assert.equal(sparse.businessArea,null);assert.equal(sparse.alias,null);assert.equal(sparse.rating,null);assert.equal(sparse.referenceConsumption,null);assert.equal(sparse.openingText,null);assert.deepEqual(sparse.photos,[]);
});

test('transit route preserves the selected path segments and alternatives without inventing total distance',async()=>{
  const calls=[];
  const gateway={status:()=>({}),async call(_provider,name){calls.push(name);if(name==='maps_direction_walking')return {source:'AMap MCP',queriedAt:'now',data:{route:{origin:'x',destination:'y',paths:[{distance:'3000',duration:'1800',steps:[{instruction:'向东步行',road:'中山东一路',distance:'120',duration:'100'}]}]}}};return {source:'AMap MCP',queriedAt:'now',data:{route:{distance:'99999',transits:[
    {duration:'3000',walking_distance:'600',segments:[{walking:{distance:'100',duration:'60',steps:[{instruction:'步行至站点',road:'支路',distance:'100',duration:'60'}]},bus:{buslines:[{name:'path A',departure_stop:{name:'A1'},arrival_stop:{name:'A2'},via_stops:[]}]},entrance:{name:'A口'},exit:{name:'B口'}}]},
    {duration:'3600',walking_distance:'300',segments:[{walking:{distance:'120',duration:'90',steps:[{instruction:'沿路前往',road:'某路',distance:'120',duration:'90'},{instruction:'已到站口',distance:'0',duration:'0'}]},bus:{buslines:[{name:'地铁 2 号线',departure_stop:{name:'南京东路'},arrival_stop:{name:'人民广场'},via_stops:[{name:'陆家嘴'}]},{name:'公交 20 路',departure_stop:{name:'南京东路'},arrival_stop:{name:'人民广场'},via_stops:[]}]},entrance:{},exit:{}},{walking:{distance:'180',duration:'120',steps:[]},bus:{buslines:[{name:'地铁 1 号线',departure_stop:{name:'人民广场'},arrival_stop:{name:'陕西南路'},via_stops:[]}]},entrance:{name:'C口'}}]}
  ]}}};}};
  const route=await createLiveService(gateway).route({id:'a',location:'121.4,31.2',name:'起点'},{id:'b',location:'121.5,31.2',name:'终点'},'上海','gentle');
  assert.deepEqual(calls,['maps_direction_walking','maps_direction_transit_integrated']);assert.equal(route.durationMinutes,60);assert.equal(route.walkingMeters,300);assert.equal(route.distanceMeters,null);assert.equal(route.routeDetails.segments.length,2);
  assert.deepEqual(route.routeDetails.segments[0].buslines.map(row=>row.name),['地铁 2 号线','公交 20 路']);assert.equal(route.routeDetails.segments[0].buslines[0].departureStop,'南京东路');assert.equal(route.routeDetails.segments[0].buslines[0].durationMinutes,null);assert.equal(route.routeDetails.segments[0].entrance,null);assert.equal(route.routeDetails.segments[1].buslines[0].arrivalStop,'陕西南路');assert.equal(route.routeDetails.segments[0].walking.steps[0].distanceMeters,120);assert.equal(route.routeDetails.segments[0].walking.steps[1].distanceMeters,0);assert.equal(route.routeDetails.segments[0].walking.steps[1].durationMinutes,0);
  const walkingService=createLiveService({status:()=>({}),async call(){return {source:'AMap MCP',queriedAt:'now',data:{route:{origin:'x',destination:'y',paths:[{distance:'500',duration:'120',steps:[{instruction:'沿路直行',road:'外滩步道',distance:'500',duration:'120'}]}]}}};}});
  const walking=await walkingService.route({id:'a',name:'起点',location:'121.4,31.2'},{id:'b',name:'终点',location:'121.401,31.2'},'上海','gentle');assert.equal(walking.mode,'walking');assert.equal(walking.durationMinutes,2);assert.equal(walking.routeDetails.segments[0].steps[0].road,'外滩步道');
});

test('around search checks at most six details and filters wrong-city and out-of-radius candidates',async()=>{
  const rows={
    anchor:{id:'anchor',name:'人民广场',city:'上海市',location:'121.480,31.230',address:'中心'},
    p1:{id:'p1',name:'近餐馆',city:'上海市',location:'121.483,31.230',address:'A'},
    p2:{id:'p2',name:'跨城结果',city:'南京市',location:'121.481,31.230',address:'B'},
    p3:{id:'p3',name:'中餐馆',city:'上海',location:'121.488,31.230',address:'C'},
    p4:{id:'p4',name:'范围外',city:'上海',location:'121.500,31.230',address:'D'},
    p5:{id:'p5',name:'近咖啡馆',city:'上海',location:'121.484,31.230',address:'E'},
    p6:{id:'p6',name:'另一餐馆',city:'上海',location:'121.485,31.230',address:'F'},
    p7:{id:'p7',name:'第七候选',city:'上海',location:'121.482,31.230',address:'G'},
  };
  let detailCalls=0;let aroundArgs;
  const gateway={status:()=>({}),async call(_provider,name,args){if(name==='maps_search_detail'){detailCalls++;return {source:'AMap MCP',queriedAt:'now',data:rows[args.id]};}if(name==='maps_around_search'){aroundArgs=args;return {source:'AMap MCP',queriedAt:'now',data:{pois:['p1','p2','p3','p4','p5','p6','p7'].map(id=>({id,name:rows[id].name,address:rows[id].address}))}};}throw new Error(name);}};
  const result=await createLiveService(gateway).around({city:'上海',anchorId:'anchor',keywords:'餐厅'});
  assert.equal(detailCalls,7);assert.equal(result.checkedCount,6);assert.equal(aroundArgs.radius,'1000');assert.equal(aroundArgs.location,'121.480,31.230');assert.deepEqual(result.candidates.map(row=>row.id),['p1','p5','p6']);assert.equal(result.rejectedCount,2);
  await assert.rejects(createLiveService(gateway).around({city:'上海',anchorId:'anchor',keywords:'餐厅',radius:6000}),error=>error.code==='INVALID_RADIUS');
});
