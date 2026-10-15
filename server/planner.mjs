import { validatePlan, parseCoordinates } from '../skills/weekend-rush/scripts/trip-utils.mjs';
import { PublicError } from './mcp-gateway.mjs';
import { dateInput, textInput } from './live-service.mjs';

export function shanghaiISO(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}
const at = (date, clock) => Date.parse(`${date}T${clock}:00+08:00`);
function amount(value, label, max = 100000) {
  const number = Number(value);
  if (value === '' || value == null || !Number.isFinite(number) || number < 0 || number > max) throw new PublicError('INVALID_AMOUNT', `请填写有效的${label}。`);
  return Math.round(number * 100);
}
function minutes(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new PublicError('INVALID_MINUTES', `${label}须为 ${min}–${max} 分钟。`);
  return number;
}
export function normalizePlanInput(input) {
  const departureDate = dateInput(input.departureDate);
  const returnDate = dateInput(input.returnDate);
  if (at(returnDate, '00:00') - at(departureDate, '00:00') !== 86400000) throw new PublicError('TWO_DAY_ONLY', '本版支持相邻两天、单城一晚，请选择次日返程。');
  const earliest = input.earliestLeaveTime;
  const latest = input.latestHomeTime;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(earliest ?? '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(latest ?? '')) throw new PublicError('INVALID_CLOCK', '请选择最早出发和最晚到家的时间。');
  if (!Array.isArray(input.places) || input.places.length < 1 || input.places.length > 6) throw new PublicError('PLACE_COUNT', '请选择 1–6 个具体景点。');
  if (new Set(input.places.map(place => place.id)).size !== input.places.length) throw new PublicError('DUPLICATE_PLACE', '景点不能重复添加。');
  return {
    ...input,
    originCity: textInput(input.originCity, '出发城市', 20),
    destinationCity: textInput(input.destinationCity, '目的城市', 20),
    departureDate, returnDate,
    earliestLeaveAt: shanghaiISO(at(departureDate, earliest)),
    latestHomeAt: shanghaiISO(at(returnDate, latest)),
    budgetCents: amount(input.budgetCny, '每人总预算'),
    foodDailyCents: amount(input.foodDailyCny, '每日餐饮预留'),
    hotelCents: amount(input.hotelCny, '一晚住宿预留'),
    transitDailyCents: amount(input.transitDailyCny, '每日市内交通预留'),
    homeTransferMinutes: minutes(input.homeTransferMinutes, '住处与出发站接驳时间', 0, 240),
    places: input.places.map(place => ({ id: textInput(place.id, '景点 ID', 40), required: place.required === true, durationMinutes: minutes(place.durationMinutes, '游览时间', 15, 240), admissionCents: place.admissionCny === '' || place.admissionCny == null ? null : amount(place.admissionCny, '门票预留') })),
  };
}
function distance(a, b) {
  const x = parseCoordinates(a.location); const y = parseCoordinates(b.location);
  return Math.hypot((x.lng - y.lng) * Math.cos((x.lat + y.lat) * Math.PI / 360), x.lat - y.lat);
}
function availableSeat(ticket, name) {
  const seat = ticket?.seats.find(row => row.name === name && row.status === 'available' && row.priceCny != null);
  if (!ticket || !seat) throw new PublicError('TICKET_CHANGED', '所选车次/席别当前不可用，请重新查询并选择。', 409);
  return seat;
}

export async function generatePlans(service, rawInput) {
  const input = normalizePlanInput(rawInput);
  const forwardQuery = { date: input.departureDate, fromCity: input.originCity, toCity: input.destinationCity, fromStationCode: input.fromStationCode, toStationCode: input.toStationCode };
  const backwardQuery = { date: input.returnDate, fromCity: input.destinationCity, toCity: input.originCity, fromStationCode: input.toStationCode, toStationCode: input.fromStationCode };
  const [forward, backward] = await Promise.all([service.tickets(forwardQuery), service.tickets(backwardQuery)]);
  const outbound = forward.tickets.find(ticket => ticket.id === input.outboundTicketId);
  const inbound = backward.tickets.find(ticket => ticket.id === input.returnTicketId);
  const outboundSeat = availableSeat(outbound, input.outboundSeat);
  const inboundSeat = availableSeat(inbound, input.returnSeat);
  if (Date.parse(inbound.departureAt) <= Date.parse(outbound.arrivalAt)) throw new PublicError('INVALID_TRAIN_ORDER', '返程必须晚于去程到达。');
  const homeDeparture = Date.parse(outbound.departureAt) - (input.homeTransferMinutes + 45) * 60000;
  if (homeDeparture <= Date.now()) throw new PublicError('DEPARTURE_PASSED', '按接驳与进站预留计算，出门时间已过，请选择更晚的去程。');
  if (homeDeparture < Date.parse(input.earliestLeaveAt)) throw new PublicError('OUTBOUND_TOO_EARLY', '所选去程来不及衔接：请预留住处接驳和进站 45 分钟，选择更晚车次或更早出门。');
  const station = await service.detail({ city: input.destinationCity, id: input.stationPoiId });
  const stationNameKey = name => String(name).replace(/(火车)?站$/, '').replace(/\s/g, '');
  if (stationNameKey(station.name) !== stationNameKey(forward.to.name) || !/火车站|铁路/.test(station.type ?? '')) throw new PublicError('STATION_POI_MISMATCH', '目的地车站地图点与所选铁路车站不符，请选择火车站主体，勿选地铁站或出入口。');
  const lodging = await service.detail({ city: input.destinationCity, id: input.overnightPoiId });
  const places = [];
  for (const choice of input.places) places.push({ ...await service.detail({ city: input.destinationCity, id: choice.id }), ...choice });
  const variants = [];
  for (const pace of ['coverage', 'gentle']) {
    try { variants.push(await schedule(service, { input, outbound, inbound, outboundSeat, inboundSeat, station, lodging, places, homeDeparture, pace })); }
    catch (error) {
      if (!(error instanceof PublicError)) throw error;
      variants.push({ id: pace, name: pace === 'coverage' ? '多覆盖方案' : '少步行方案', status: 'unavailable', message: error.message, errorCode: error.code });
    }
  }
  return { generatedAt: new Date().toISOString(), engine: '真实 MCP 数据＋确定性规则规划', variants, railQueries: [forward, backward].map(({ source, queriedAt, cacheHit, rejectedCount }) => ({ source, queriedAt, cacheHit, rejectedCount })), notices: ['车票未购买；余票和价格可能随时变化。', '地图提供常规路线估计，不保证出行日的班次或拥堵情况。', '餐饮、住宿和交通预留为用户估算；门票、营业安排及预约仍需核实。', '住处接驳和景区内部步行尚未查证，到家时间与步行总量均有估算边界。'] };
}

async function schedule(service, context) {
  const { input, outbound, inbound, outboundSeat, inboundSeat, station, lodging, places, homeDeparture, pace } = context;
  const events = [];
  const omitted = [];
  let sequence = 0;
  const prefix = pace === 'coverage' ? 'cover' : 'gentle';
  const add = (title, kind, start, end, extra = {}) => {
    if (end <= start) return;
    events.push({ id: `${prefix}-${++sequence}`, title, kind, startAt: shanghaiISO(start), endAt: shanghaiISO(end), costCents: 0, costStatus: 'known', walkingMeters: 0, bookingStatus: 'not-required', openingStatus: 'verified', ...extra });
  };
  const outTime = Date.parse(outbound.departureAt);
  add('住处 → 出发站（用户估算）', 'transfer', homeDeparture, outTime - 45 * 60000, { source: '用户接驳时间估算', costCents: null, costStatus: 'unknown', note: '本段费用未计入市内预留，请单独核实。' });
  add('进站与候车', 'rest', outTime - 45 * 60000, outTime, { source: '规划预留 45 分钟' });
  add(`${outbound.trainCode} · ${outbound.from.name} → ${outbound.to.name}`, 'train', outTime, Date.parse(outbound.arrivalAt), { costCents: Math.round(outboundSeat.priceCny * 100), source: '12306 MCP', queriedAt: outbound.queriedAt, note: `${outboundSeat.name} · 查询时有票，尚未购买` });
  add('出站缓冲', 'rest', Date.parse(outbound.arrivalAt), Date.parse(outbound.arrivalAt) + 30 * 60000, { source: '规划预留 30 分钟' });
  let remaining = [...places];
  if (pace === 'gentle') {
    const optional = remaining.filter(place => !place.required);
    const retainedOptional = optional.slice(0, 1);
    for (const place of optional.slice(1)) omitted.push({ id: place.id, name: place.name, reason: '少步行方案减少可选点，保留必去点和休息。' });
    remaining = [...remaining.filter(place => place.required), ...retainedOptional];
  }
  let totalWalkingMeters = 0;
  const routeEvent = (leg, from, to, start, budgetCents = 0) => {
    const end = start + leg.durationMinutes * 60000;
    totalWalkingMeters += leg.walkingMeters;
    add(`${from.name} → ${to.name}`, 'transfer', start, end, { placeId: to.id, walkingMeters: leg.walkingMeters, distanceMeters: leg.distanceMeters, mode: leg.mode, source: leg.source, queriedAt: leg.queriedAt, cacheHit: leg.cacheHit, costCents: budgetCents, costStatus: 'estimate', note: budgetCents ? '本项计入当天全部市内交通预留，实际公交票价未取得。' : '市内费用已计入当天交通预留；景区内步行未计入。' });
    return end;
  };
  for (let day = 0; day < 2; day++) {
    const date = day === 0 ? input.departureDate : input.returnDate;
    const endpoint = day === 0 ? lodging : station;
    let position = day === 0 ? station : lodging;
    let cursor = day === 0 ? Date.parse(outbound.arrivalAt) + 30 * 60000 : at(date, '08:30');
    const deadline = day === 0 ? at(date, '21:00') : Date.parse(inbound.departureAt) - 60 * 60000;
    let transportCharged = false;
    let mealCharged = false;
    let lunchTaken = false;
    let visitedSinceRest = 0;
    const addMeal = () => {
      add(day === 1 && !mealCharged ? '早餐与全天餐饮预留' : '附近用餐（餐厅待选择）', 'rest', cursor, cursor + 45 * 60000, { placeId: position.id, source: '用户餐饮预算与用餐时长估算', costCents: mealCharged ? 0 : input.foodDailyCents, costStatus: 'estimate', note: mealCharged ? '已计入当天餐饮预留，餐厅与绕行待确认。' : '此金额覆盖当天全部餐饮，餐厅与实际价格待确认。' });
      cursor += 45 * 60000; mealCharged = true; visitedSinceRest = 0;
    };
    if (day === 1) addMeal();
    const attempted = new Set();
    while (remaining.some(place => !attempted.has(place.id))) {
      const candidates = remaining.filter(place => !attempted.has(place.id)).sort((a, b) => Number(b.required) - Number(a.required) || distance(position, a) - distance(position, b));
      const place = candidates[0]; attempted.add(place.id);
      let go; let exit;
      try { go = await service.route(position, place, input.destinationCity, pace); exit = await service.route(place, endpoint, input.destinationCity, pace); }
      catch (error) {
        if (!(error instanceof PublicError)) throw error;
        if (day === 1) omitted.push({ id: place.id, name: place.name, reason: `路线未查到：${error.message}` });
        continue;
      }
      const needsLunch = !lunchTaken && cursor >= at(date, '11:30');
      const restMinutes = visitedSinceRest >= 2 ? (pace === 'gentle' ? 30 : 20) : 0;
      const reservedMeal = !lunchTaken && cursor + (go.durationMinutes + place.durationMinutes + exit.durationMinutes) * 60000 >= at(date, '11:30') ? 45 : 0;
      const closingBuffer = day === 0 ? 45 : 0;
      if (cursor + (go.durationMinutes + place.durationMinutes + exit.durationMinutes + restMinutes + reservedMeal + closingBuffer) * 60000 > deadline) continue;
      if (needsLunch) { addMeal(); lunchTaken = true; }
      if (restMinutes) { add('休息预留（休息点待确认）', 'rest', cursor, cursor + restMinutes * 60000, { placeId: position.id, source: '规划休息预留' }); cursor += restMinutes * 60000; visitedSinceRest = 0; }
      cursor = routeEvent(go, position, place, cursor, transportCharged ? 0 : input.transitDailyCents); transportCharged = true;
      add(place.name, 'visit', cursor, cursor + place.durationMinutes * 60000, { placeId: place.id, required: place.required, source: place.source, queriedAt: place.queriedAt, costCents: place.admissionCents, costStatus: place.admissionCents == null ? 'unknown' : 'estimate', bookingStatus: 'unknown', openingStatus: 'unknown', note: '地点与坐标已查；游览时长及门票预留由用户填写。营业时段和预约须核实。' });
      cursor += place.durationMinutes * 60000;
      position = place;
      remaining = remaining.filter(item => item.id !== place.id);
      visitedSinceRest++;
    }
    const lastLeg = await service.route(position, endpoint, input.destinationCity, pace);
    if (!lunchTaken && cursor < at(date, '11:30') && at(date, '11:30') + (45 + lastLeg.durationMinutes) * 60000 <= deadline) {
      add('自由休息与机动时间（休息点待确认）', 'rest', cursor, at(date, '11:30'), { placeId: position.id, source: '规划机动时间' });
      cursor = at(date, '11:30');
    }
    if (!lunchTaken && cursor + lastLeg.durationMinutes * 60000 >= at(date, '11:30')) {
      if (cursor + (45 + lastLeg.durationMinutes) * 60000 > deadline) throw new PublicError('MEAL_TIME_MISSING', '行程缺少用餐时间，请换更晚返程或减少地点。');
      addMeal(); lunchTaken = true;
    }
    if (!mealCharged && day === 0) { addMeal(); lunchTaken = true; }
    if (day === 1 && cursor + lastLeg.durationMinutes * 60000 < deadline) {
      const leaveAt = deadline - lastLeg.durationMinutes * 60000;
      add('返程前自由休息与机动时间（休息点待确认）', 'rest', cursor, leaveAt, { placeId: position.id, source: '保留返站路线时长与进站缓冲后的空闲时间' });
      cursor = leaveAt;
    }
    cursor = routeEvent(lastLeg, position, endpoint, cursor, transportCharged ? 0 : input.transitDailyCents);
    if (cursor > deadline) throw new PublicError('DAY_TOO_TIGHT', `${day === 0 ? '第一天无法按计划到达住宿参考点' : '无法预留返程进站时间'}，请调整车次、地点或时长。`);
    if (day === 0) {
      if (cursor < at(date, '18:00')) { add('住宿参考点自由休息', 'rest', cursor, at(date, '18:00'), { placeId: lodging.id, source: '自由缓冲时段，住宿未预订' }); cursor = at(date, '18:00'); }
      if (cursor + 45 * 60000 > deadline) throw new PublicError('DAY_TOO_TIGHT', '抵达住宿参考点后缺少用餐和休息时间，请调整行程。');
      add('晚餐预留（餐厅待选择）', 'rest', cursor, cursor + 45 * 60000, { placeId: lodging.id, source: '用餐时长估算', costCents: 0, costStatus: 'estimate', note: '已计入当天餐饮预留。' }); cursor += 45 * 60000;
      add(`住宿参考：${lodging.name}`, 'stay', cursor, at(input.returnDate, '08:30'), { placeId: lodging.id, source: '高德地点＋用户住宿预算', queriedAt: lodging.queriedAt, costCents: input.hotelCents, costStatus: 'estimate', bookingStatus: 'required-unconfirmed', note: '仅为路线参考点，未查询房价或预订。' });
    } else {
      add('进站、安检与候车', 'rest', cursor, Date.parse(inbound.departureAt), { source: '至少预留 60 分钟' });
    }
  }
  for (const place of remaining) if (!omitted.some(row => row.id === place.id)) omitted.push({ id: place.id, name: place.name, reason: place.required ? '必去点无法装入现有时间窗口。' : '时间不足，移除可选点。' });
  add(`${inbound.trainCode} · ${inbound.from.name} → ${inbound.to.name}`, 'train', Date.parse(inbound.departureAt), Date.parse(inbound.arrivalAt), { source: '12306 MCP', queriedAt: inbound.queriedAt, costCents: Math.round(inboundSeat.priceCny * 100), note: `${inboundSeat.name} · 查询时有票，尚未购买` });
  const arrivalHome = Date.parse(inbound.arrivalAt) + (30 + input.homeTransferMinutes) * 60000;
  add('出站与回家（用户估算）', 'transfer', Date.parse(inbound.arrivalAt), arrivalHome, { source: '30 分钟出站预留＋用户接驳估算', costCents: null, costStatus: 'unknown', note: '住处接驳费用未知，不包含在目的城市交通预留内。' });
  const plan = { id: pace, name: pace === 'coverage' ? '多覆盖方案' : '少步行方案', events, omitted, arrivalHomeAt: shanghaiISO(arrivalHome), totalWalkingMeters, walkingNotice: '仅汇总地图路线中的步行；景区内、车站内与住处接驳步行未完整计入。' };
  const validation = validatePlan(plan, { mustVisitIds: places.filter(place => place.required).map(place => place.id), budgetCents: input.budgetCents, latestHomeAt: input.latestHomeAt });
  return { ...plan, status: validation.valid ? 'draft' : 'conflict', validation, budgetCents: input.budgetCents, costNotice: '已知票价＋用户预留小计；未知费用尚未计全，不代表总预算满足。' };
}
