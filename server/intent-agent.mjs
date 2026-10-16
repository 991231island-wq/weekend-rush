import { validatePlan, comparePlans } from '../skills/weekend-rush/scripts/trip-utils.mjs';
import { PublicError } from './mcp-gateway.mjs';
import { generatePlans } from './planner.mjs';

const fields = ['originCity', 'destinationCity', 'departureDate', 'returnDate', 'earliestLeaveTime', 'latestHomeTime', 'budgetCny', 'foodDailyCny', 'hotelCny', 'transitDailyCny', 'homeTransferMinutes'];
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const addOneDay = value => new Date(Date.parse(`${value}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const cityKey = value => String(value ?? '').replace(/市$/, '').trim();
const pick = (value, max = 60) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function publicToolResult(value) {
  if (value instanceof PublicError) return { ok: false, error: value.message, code: value.code };
  return { ok: false, error: '查询未成功；未使用猜测数据。', code: 'TOOL_FAILED' };
}

function toolSchemas() {
  const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
  return [
    { type: 'function', function: { name: 'search_rail', description: '查询已确认的去程或返程精确车站区间，只返回真实查询结果。', parameters: object({ direction: { type: 'string', enum: ['outbound', 'return'] } }) } },
    { type: 'function', function: { name: 'search_places', description: '在目的城市搜索车站主体、住宿位置参考或游览候选。城市固定为本次目的城市。', parameters: object({ kind: { type: 'string', enum: ['station', 'hotel', 'attraction'] }, keywords: { type: 'string' } }) } },
    { type: 'function', function: { name: 'search_around', description: '围绕已查到的真实地点搜索附近餐馆或休息点。', parameters: object({ anchorId: { type: 'string' }, keywords: { type: 'string' }, radius: { type: 'integer' } }) } },
    { type: 'function', function: { name: 'get_place_detail', description: '查询本次真实搜索结果中的地点详情。', parameters: object({ id: { type: 'string' } }) } },
    { type: 'function', function: { name: 'get_route', description: '查询已核实地点之间的公交或步行路线。', parameters: object({ originId: { type: 'string' }, destinationId: { type: 'string' }, pace: { type: 'string', enum: ['coverage', 'gentle'] } }) } },
    { type: 'function', function: { name: 'get_weather', description: '查询目的城市天气，只用于服务返回的预报日期。', parameters: object({}) } },
    { type: 'function', function: { name: 'validate_plan', description: '用确定性校验器核对活动时间、预算、必去点和到家时间。', parameters: object({ plan: { type: 'object' }, budgetCents: { type: 'integer' }, latestHomeAt: { type: 'string' }, mustVisitIds: { type: 'array', items: { type: 'string' } } }) } },
    { type: 'function', function: { name: 'compare_versions', description: '比较前后两个已生成的行程版本并保护已完成活动。', parameters: object({ previous: { type: 'object' }, next: { type: 'object' }, completedIds: { type: 'array', items: { type: 'string' } } }) } },
    { type: 'function', function: { name: 'finish_research', description: '已经查询足够真实证据，可以结束数据搜索。', parameters: object({ done: { type: 'boolean' } }) } },
  ];
}

export async function extractIntent(client, { message, supplied = {}, today }) {
  if (typeof message !== 'string' || !message.trim() || message.length > 1600) throw new PublicError('INVALID_MESSAGE', '请用 1–1600 个字描述这次周末出行。');
  const provided = Object.fromEntries(fields.map(key => [key, pick(supplied[key], key.endsWith('City') ? 20 : 40)]));
  let ai = {};
  const enoughExplicitFields = Boolean(provided.originCity && provided.destinationCity && provided.departureDate);
  if (!enoughExplicitFields) {
    const parsed = await client.json([
      { role: 'system', content: `你是中国周末旅行助手的需求整理器。今天是 ${today}（Asia/Shanghai）。只解析用户明确表达的信息；没有把握的字段返回 null，不要猜目的地、日期或预算。首版固定一人、一个目的城市、两天一晚、公共交通。只返回 JSON 对象，字段为 originCity,destinationCity,departureDate,returnDate,earliestLeaveTime,latestHomeTime,budgetCny,foodDailyCny,hotelCny,transitDailyCny,homeTransferMinutes,preferences,foodKeywords。日期用 YYYY-MM-DD，时间用 HH:mm，金额用数字；preferences 和 foodKeywords 为简短中文字符串。若只给出第一天日期，可把次日作为返程日。` },
      { role: 'user', content: JSON.stringify({ message: message.trim(), today, supplied: provided }) },
    ], { request: { max_tokens: 650 } });
    ai = parsed.value ?? {};
  }
  const intent = Object.fromEntries(fields.map(key => [key, provided[key] !== '' ? provided[key] : ai[key] ?? '']));
  intent.departureDate = validDate(intent.departureDate) ? intent.departureDate : '';
  if (!intent.returnDate && intent.departureDate) intent.returnDate = addOneDay(intent.departureDate);
  if (!validDate(intent.returnDate)) intent.returnDate = '';
  intent.originCity = pick(intent.originCity, 20); intent.destinationCity = pick(intent.destinationCity, 20);
  intent.earliestLeaveTime = clockPattern.test(intent.earliestLeaveTime) ? intent.earliestLeaveTime : '06:00';
  intent.latestHomeTime = clockPattern.test(intent.latestHomeTime) ? intent.latestHomeTime : '22:00';
  intent.budgetCny = Number.isFinite(Number(intent.budgetCny)) && Number(intent.budgetCny) > 0 ? Number(intent.budgetCny) : 1000;
  intent.foodDailyCny = intent.foodDailyCny !== '' && Number.isFinite(Number(intent.foodDailyCny)) && Number(intent.foodDailyCny) >= 0 ? Number(intent.foodDailyCny) : 120;
  intent.hotelCny = intent.hotelCny !== '' && Number.isFinite(Number(intent.hotelCny)) && Number(intent.hotelCny) >= 0 ? Number(intent.hotelCny) : 260;
  intent.transitDailyCny = intent.transitDailyCny !== '' && Number.isFinite(Number(intent.transitDailyCny)) && Number(intent.transitDailyCny) >= 0 ? Number(intent.transitDailyCny) : 30;
  intent.homeTransferMinutes = intent.homeTransferMinutes !== '' && Number.isInteger(Number(intent.homeTransferMinutes)) && Number(intent.homeTransferMinutes) >= 0 ? Number(intent.homeTransferMinutes) : 45;
  intent.preferences = pick(ai.preferences || message, 240) || '第一次到访，经典地标与本地体验平衡安排';
  intent.foodKeywords = pick(ai.foodKeywords, 30) || '本地特色餐厅';
  const required = ['originCity', 'destinationCity', 'departureDate', 'returnDate'];
  const missing = required.filter(key => !intent[key]);
  const dayOffset = intent.departureDate ? (Date.parse(`${intent.departureDate}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`)) / 86400000 : null;
  intent.dayOffset = dayOffset;
  if (dayOffset !== null && dayOffset < 0) missing.push('departureDate');
  if (intent.returnDate && intent.departureDate && Date.parse(`${intent.returnDate}T00:00:00+08:00`) - Date.parse(`${intent.departureDate}T00:00:00+08:00`) !== 86400000) missing.push('returnDate');
  if (dayOffset !== null && dayOffset > 60) throw new PublicError('DATE_TOO_FAR', '日期超过当前首版可规划范围。请选未来 60 天内的两天一晚日期。');
  return { intent, missing: [...new Set(missing)], dayOffset };
}

async function callService(service, method, args) {
  try { return await service[method](args); }
  catch (error) { throw error instanceof PublicError ? error : new PublicError('QUERY_FAILED', '数据查询暂时失败，未补造结果。', 502); }
}

function slimEvidence(evidence) {
  return evidence.map(row => {
    let data = row.data;
    if (row.kind === 'rail') {
      const options = row.category === 'return' ? data.tickets.slice(-6) : data.tickets.slice(0, 6);
      data = { tickets: options.map(ticket => {
        const seat = ticket.seats.filter(option => option.status === 'available' && option.priceCny != null).sort((a, b) => a.priceCny - b.priceCny)[0];
        return { id: ticket.id, trainCode: ticket.trainCode, departureAt: ticket.departureAt, arrivalAt: ticket.arrivalAt, from: ticket.from?.name, to: ticket.to?.name, seats: seat ? [{ name: seat.name, status: seat.status, priceCny: seat.priceCny }] : [] };
      }), from: data.from, to: data.to, source: data.source, queriedAt: data.queriedAt };
    }
    else if (data?.candidates) data = { ...data, candidates: data.candidates.slice(0, 12) };
    else if (data?.stations) data = { ...data, stations: data.stations.slice(0, 20) };
    return { evidenceId: row.id, kind: row.kind, category: row.category ?? null, source: data?.source ?? null, queriedAt: data?.queriedAt ?? null, data };
  });
}

export function railCandidatesWithinHardTimes(evidence, intent) {
  const earliestDeparture = Date.parse(`${intent.departureDate}T${intent.earliestLeaveTime}:00+08:00`) + (Number(intent.homeTransferMinutes) + 45) * 60000;
  const latestArrival = Date.parse(`${intent.returnDate}T${intent.latestHomeTime}:00+08:00`) - (Number(intent.homeTransferMinutes) + 30) * 60000;
  const earliestReturnDeparture = Date.parse(`${intent.returnDate}T15:00:00+08:00`);
  return evidence.map(row => {
    if (row.kind !== 'rail') return row;
    const eligible = row.data.tickets.filter(ticket => {
      const windowOk = row.category === 'outbound'
        ? Date.parse(ticket.departureAt) >= earliestDeparture
        : Date.parse(ticket.departureAt) >= earliestReturnDeparture && Date.parse(ticket.arrivalAt) <= latestArrival;
      return windowOk && ticket.seats.some(seat => seat.status === 'available' && seat.priceCny != null);
    });
    eligible.sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt));
    const tickets = row.category === 'return' ? eligible.slice(-6) : eligible.slice(0, 6);
    return { ...row, data: { ...row.data, tickets } };
  });
}

export function selectRailTicket(tickets, direction) {
  if (!['outbound', 'return'].includes(direction)) throw new PublicError('INVALID_DIRECTION', '只支持去程或返程。');
  const options = tickets.map(ticket => ({
    ticket,
    seat: ticket.seats.filter(row => row.status === 'available' && row.priceCny != null).sort((a, b) => a.priceCny - b.priceCny || a.name.localeCompare(b.name))[0],
  })).filter(row => row.seat);
  options.sort((a, b) => {
    const time = Date.parse(a.ticket.departureAt) - Date.parse(b.ticket.departureAt);
    return (direction === 'outbound' ? time : -time) || a.seat.priceCny - b.seat.priceCny || a.ticket.id.localeCompare(b.ticket.id);
  });
  return options[0] ?? null;
}

export function weatherForTrip(weather, intent) {
  if (!weather || !Array.isArray(weather.forecasts)) return weather ?? null;
  const dates = new Set([intent.departureDate, intent.returnDate]);
  return { ...weather, forecasts: weather.forecasts.filter(row => dates.has(row.date)) };
}

function chooseStation(stations, preferred) {
  const exact = stations.find(row => row.name === preferred);
  if (exact) return exact;
  const candidates = stations.filter(row => /(?:东|南|北|西|虹桥|站)$/.test(row.name));
  return candidates[0] ?? stations[0];
}

const hubPreferences = { 杭州: '杭州东', 上海: '上海虹桥', 广州: '广州南', 武汉: '武汉', 北京: '北京南', 南京: '南京南', 成都: '成都东', 重庆: '重庆北', 深圳: '深圳北', 长沙: '长沙南', 西安: '西安北' };

export async function ensureFeasibleRailStations(service, intent, proposal, stationRows) {
  const preferred = {
    origin: chooseStation(stationRows[0].stations, hubPreferences[intent.originCity] ?? `${intent.originCity}站`),
    destination: chooseStation(stationRows[1].stations, hubPreferences[intent.destinationCity] ?? `${intent.destinationCity}站`),
  };
  const pairs = [{ origin: proposal.origin, destination: proposal.destination }];
  if (preferred.origin.code !== proposal.origin.code || preferred.destination.code !== proposal.destination.code) pairs.push(preferred);
  for (const pair of pairs) {
    let outbound; let inbound;
    try {
      [outbound, inbound] = await Promise.all([
        service.tickets({ date: intent.departureDate, fromCity: intent.originCity, toCity: intent.destinationCity, fromStationCode: pair.origin.code, toStationCode: pair.destination.code }),
        service.tickets({ date: intent.returnDate, fromCity: intent.destinationCity, toCity: intent.originCity, fromStationCode: pair.destination.code, toStationCode: pair.origin.code }),
      ]);
    } catch (error) {
      if (error instanceof PublicError && ['MAP_AUTH', 'QUOTA'].includes(error.code)) throw error;
      if (intent.dayOffset + 1 <= 14) continue;
      return proposal;
    }
    const rows = railCandidatesWithinHardTimes([{ kind: 'rail', category: 'outbound', data: outbound }, { kind: 'rail', category: 'return', data: inbound }], intent);
    if (rows.every(row => row.data.tickets.length > 0)) {
      if (pair.destination.code === proposal.destination.code && pair.origin.code === proposal.origin.code) return proposal;
      return { ...proposal, ...pair, stationKeyword: pair.destination.name, summary: `按实际车次可用时段，建议使用${pair.origin.name}与${pair.destination.name}往返。` };
    }
  }
  return proposal;
}

async function stationStrategy(client, intent, originStations, destinationStations) {
  const result = await client.json([
    { role: 'system', content: '你要为一人周末两天一晚公共交通行程选铁路车站并规划有限的搜索关键词。只能选输入列表里的车站 code。目的地的地图车站查询要使用选中站名；酒店只作位置参考，不得声称已订或价格已查。最多 3 个游览关键词，覆盖用户偏好；默认优先城市地标、文化与自然体验。只返回 JSON：originStationCode,destinationStationCode,stationKeyword,hotelKeyword,attractionKeywords（字符串数组，最多3项）,recommendedPace（coverage或gentle）,summary。' },
    { role: 'user', content: JSON.stringify({ intent, originStations: originStations.stations, destinationStations: destinationStations.stations }) },
  ], { request: { max_tokens: 700 } });
  const value = result.value;
  const origin = originStations.stations.find(row => row.code === value.originStationCode) ?? chooseStation(originStations.stations, intent.originCity === '杭州' ? '杭州东' : `${intent.originCity}站`);
  const destination = destinationStations.stations.find(row => row.code === value.destinationStationCode) ?? chooseStation(destinationStations.stations, intent.destinationCity === '上海' ? '上海虹桥' : `${intent.destinationCity}站`);
  return {
    origin, destination,
    stationKeyword: pick(value.stationKeyword, 40) || destination.name,
    hotelKeyword: pick(value.hotelKeyword, 40) || '酒店',
    attractionKeywords: Array.isArray(value.attractionKeywords) ? value.attractionKeywords.slice(0, 3).map(row => pick(row, 40)).filter(Boolean) : [],
    recommendedPace: value.recommendedPace === 'gentle' ? 'gentle' : 'coverage',
    summary: pick(value.summary, 220),
  };
}

export async function research(client, service, intent, strategy, stationRows, onProgress = async () => {}) {
  const evidence = [];
  const queried = new Set();
  const placeIds = new Set();
  const add = (kind, data, category = null) => {
    const row = { id: `E${String(evidence.length + 1).padStart(3, '0')}`, kind, category, data };
    evidence.push(row);
    for (const candidate of data?.candidates ?? []) if (candidate.id) placeIds.add(candidate.id);
    return row;
  };
  add('stations', stationRows[0], intent.originCity); add('stations', stationRows[1], intent.destinationCity);
  const tools = toolSchemas();
  const toolMessages = [
    { role: 'system', content: `你是周末旅行的资料查询 Agent。只能使用提供的工具获取事实，不得虚构车次、票价、地点或开放信息。已确定出发站 ${strategy.origin.name}(${strategy.origin.code}) → ${strategy.destination.name}(${strategy.destination.code})，目的城市 ${intent.destinationCity}。请查询去程、返程，搜索目的地车站、一个酒店位置参考、适合用户偏好的游览地点，并按需要查天气/周边/路线。车票工具里的两个方向由日期固定。地点只可在该城市，候选必须通过详情才能进入最终计划。最后调用 finish_research。` },
    { role: 'user', content: JSON.stringify({ intent, stationOptions: { from: stationRows[0].stations.slice(0, 35), to: stationRows[1].stations.slice(0, 35) }, strategy: { originCode: strategy.origin.code, destinationCode: strategy.destination.code, stationKeyword: strategy.stationKeyword, hotelKeyword: strategy.hotelKeyword, attractionKeywords: strategy.attractionKeywords } }) },
  ];
  let calls = 0;
  const toolNames = new Set(tools.map(row => row.function.name));
  async function execute(name, args) {
    if (name === 'finish_research') return { done: true };
    if (name === 'search_rail') {
      const direction = args.direction;
      if (!['outbound', 'return'].includes(direction)) throw new PublicError('INVALID_DIRECTION', '只支持去程或返程。');
      const date = direction === 'outbound' ? intent.departureDate : intent.returnDate;
      const reverse = direction === 'return';
      let data;
      try { data = await callService(service, 'tickets', { date, fromCity: reverse ? intent.destinationCity : intent.originCity, toCity: reverse ? intent.originCity : intent.destinationCity, fromStationCode: reverse ? strategy.destination.code : strategy.origin.code, toStationCode: reverse ? strategy.origin.code : strategy.destination.code }); }
      catch (error) {
        if (!(error instanceof PublicError) || error.code !== 'OUTSIDE_SALE_WINDOW') throw error;
        data = { tickets: [], from: { name: reverse ? strategy.destination.name : strategy.origin.name }, to: { name: reverse ? strategy.origin.name : strategy.destination.name }, source: '12306 MCP', tool: 'get-tickets', queriedAt: new Date().toISOString(), availability: 'not-yet-open', notice: error.message };
      }
      queried.add(`rail:${direction}`); add('rail', data, direction);
      return { ...data, tickets: data.tickets.slice(0, 30) };
    }
    if (name === 'search_places') {
      const category = args.kind;
      if (!['station', 'hotel', 'attraction'].includes(category)) throw new PublicError('INVALID_CATEGORY', '地点搜索类别不支持。');
      const keywords = pick(args.keywords, 50) || ({ station: strategy.stationKeyword, hotel: strategy.hotelKeyword, attraction: strategy.attractionKeywords[0] || '城市景点' })[category];
      const data = await callService(service, 'search', { city: intent.destinationCity, keywords });
      queried.add(`places:${category}`); add('places', data, category);
      return { ...data, candidates: data.candidates.slice(0, 12) };
    }
    if (name === 'search_around') {
      const anchorId = pick(args.anchorId, 40); if (!placeIds.has(anchorId)) throw new PublicError('UNKNOWN_POI', '周边搜索中心必须来自本次地点查询。');
      const data = await callService(service, 'around', { city: intent.destinationCity, anchorId, keywords: pick(args.keywords, 30) || intent.foodKeywords, radius: Number.isInteger(args.radius) ? Math.min(3000, Math.max(100, args.radius)) : 1000 });
      add('around', data); for (const row of data.candidates) placeIds.add(row.id); return data;
    }
    if (name === 'get_place_detail') {
      const id = pick(args.id, 40); if (!placeIds.has(id)) throw new PublicError('UNKNOWN_POI', '只能查本次搜索返回的地点。');
      const data = await callService(service, 'detail', { city: intent.destinationCity, id }); add('place-detail', data); return data;
    }
    if (name === 'get_route') {
      const originId = pick(args.originId, 40), destinationId = pick(args.destinationId, 40);
      if (!placeIds.has(originId) || !placeIds.has(destinationId)) throw new PublicError('UNKNOWN_POI', '路线两端必须来自本次查询结果。');
      const [origin, destination] = await Promise.all([service.detail({ city: intent.destinationCity, id: originId }), service.detail({ city: intent.destinationCity, id: destinationId })]);
      const data = await service.route(origin, destination, intent.destinationCity, args.pace === 'gentle' ? 'gentle' : 'coverage'); add('route', data); return data;
    }
    if (name === 'get_weather') { const data = await callService(service, 'weather', intent.destinationCity); add('weather', data); queried.add('weather'); return data; }
    if (name === 'validate_plan') return validatePlan(args.plan, { budgetCents: args.budgetCents, latestHomeAt: args.latestHomeAt, mustVisitIds: args.mustVisitIds });
    if (name === 'compare_versions') return comparePlans(args.previous, args.next, args.completedIds);
    throw new PublicError('UNKNOWN_OPERATION', '不支持此查询工具。');
  }
  await onProgress('正在查询真实车次、地点与周边信息…');
  let finished = false;
  for (let turn = 0; turn < 5 && calls < 12; turn++) {
    const response = await client.complete(toolMessages, { request: { tools, tool_choice: 'auto', max_tokens: 1200 } });
    const message = response.message;
    if (!Array.isArray(message.tool_calls) || !message.tool_calls.length) break;
    toolMessages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      if (calls++ >= 12) break;
      const name = call.function?.name;
      if (!toolNames.has(name)) { toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(publicToolResult(new PublicError('UNKNOWN_OPERATION', '不支持此查询工具。'))) }); continue; }
      let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      try {
        const value = await execute(name, args);
        toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(value).slice(0, 16000) });
      } catch (error) { toolMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(publicToolResult(error)) }); }
      if (name === 'finish_research') { finished = true; break; }
    }
    if (finished) break;
  }
  // Complete a small fixed research set if the model ends early or omits a source.
  for (const direction of ['outbound', 'return']) if (!queried.has(`rail:${direction}`)) await execute('search_rail', { direction });
  if (!queried.has('places:station')) await execute('search_places', { kind: 'station', keywords: strategy.stationKeyword });
  if (!queried.has('places:hotel')) await execute('search_places', { kind: 'hotel', keywords: strategy.hotelKeyword });
  if (!queried.has('places:attraction')) for (const keyword of (strategy.attractionKeywords.length ? strategy.attractionKeywords : ['城市景点']).slice(0, 2)) await execute('search_places', { kind: 'attraction', keywords: keyword });
  if (!queried.has('weather') && intent.dayOffset <= 7) { try { await execute('get_weather', {}); } catch { /* Weather remains unknown outside returned dates or on source failure. */ } }
  return evidence;
}

function finalSelectionPrompt(intent, strategy, evidence) {
  const railConstraint = intent.dayOffset + 1 > 14 ? '至少返程日车票尚未进入预售期，不得提及具体车次或已查询的发车时间。' : '往返车次与席别已由规则按时间窗口和有票状态选好，不需要输出车票。';
  return [
    { role: 'system', content: `你要从提供的已查证地点中提出一份周末行程草案。不得发明地点 ID、营业状态或价格。${railConstraint}每个地点 ID 都必须来自对应候选；车站 POI 必须是目的城市铁路站主体，酒店只是位置参考。最多选 4 个景点，首个为必去；门票未知返回 null。只返回 JSON：summary,recommendedPace,stationPoiId,lodgingPoiId,places（元素含 id,required,durationMinutes,reason）。` },
    { role: 'user', content: JSON.stringify({ intent, strategy: { origin: strategy.origin, destination: strategy.destination, recommendedPace: strategy.recommendedPace, summary: strategy.summary }, evidence: slimEvidence(evidence.filter(row => row.kind !== 'rail')) }) },
  ];
}
function recordEvidence(plans, initial = []) {
  const index = new Map();
  const entries = [];
  const register = (object, label = null) => {
    if (!object || typeof object !== 'object' || !object.source || !object.queriedAt) return null;
    const key = JSON.stringify([object.source, object.queriedAt, object.tool ?? '']);
    if (!index.has(key)) {
      const evidenceId = `E${String(entries.length + 1).padStart(3, '0')}`;
      index.set(key, evidenceId); entries.push({ id: evidenceId, source: object.source, queriedAt: object.queriedAt, tool: object.tool ?? null, label });
    }
    return index.get(key);
  };
  for (const row of initial) {
    const label = row.kind === 'rail' ? `${row.category === 'outbound' ? '去程' : '返程'}车次候选` : row.kind === 'places' ? `${row.category}地点候选` : row.kind === 'weather' ? '天气查询' : `${row.kind}查询`;
    register(row.data, label);
  }
  for (const plan of plans.variants) for (const event of plan.events ?? []) {
    event.evidenceId = register(event, event.kind === 'train' ? '车票信息' : event.kind === 'transfer' ? '路线信息' : null);
    if (event.placeDetails) event.placeDetails.evidenceId = register(event.placeDetails, '地点详情');
  }
  return entries;
}

export async function generateIntentPlans({ service, client, input, onProgress = async () => {} }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await onProgress('正在整理你的出行意向…');
  const { intent, missing } = await extractIntent(client, { message: input.message, supplied: input.fields, today });
  if (missing.length) return { kind: 'need-input', intent, missing, question: `还需要补齐：${missing.map(key => ({ originCity: '出发城市', destinationCity: '目的城市', departureDate: '出发日期', returnDate: '返程日期' })[key] ?? key).join('、')}。你可以一次发给我。` };
  if (cityKey(intent.originCity) === cityKey(intent.destinationCity)) throw new PublicError('SAME_CITY', '出发城市与目的城市相同，请告诉我实际出发城市。');
  const [originStations, destinationStations] = await Promise.all([service.stations(intent.originCity), service.stations(intent.destinationCity)]);
  await onProgress('正在选择合适车站…');
  const proposedStrategy = await stationStrategy(client, intent, originStations, destinationStations);
  const strategy = await ensureFeasibleRailStations(service, intent, proposedStrategy, [originStations, destinationStations]);
  const evidence = await research(client, service, intent, strategy, [originStations, destinationStations], onProgress);
  await onProgress('正在核对地点并编排行程…');
  const selectableEvidence = railCandidatesWithinHardTimes(evidence, intent);
  const selected = (await client.json(finalSelectionPrompt(intent, strategy, selectableEvidence), { request: { max_tokens: 700 } })).value;
  const findCandidates = category => evidence.filter(row => row.kind === 'places' && row.category === category).flatMap(row => row.data.candidates);
  const stationCandidate = findCandidates('station').find(row => row.id === selected.stationPoiId);
  const hotelCandidate = findCandidates('hotel').find(row => row.id === selected.lodgingPoiId);
  const allPlaces = findCandidates('attraction');
  const chosenPlaces = Array.isArray(selected.places) ? selected.places.slice(0, 4) : [];
  const outboundEvidence = selectableEvidence.find(row => row.kind === 'rail' && row.category === 'outbound')?.data;
  const returnEvidence = selectableEvidence.find(row => row.kind === 'rail' && row.category === 'return')?.data;
  const outboundSelection = selectRailTicket(outboundEvidence?.tickets ?? [], 'outbound');
  const returnSelection = selectRailTicket(returnEvidence?.tickets ?? [], 'return');
  const outbound = outboundSelection?.ticket;
  const inbound = returnSelection?.ticket;
  const outboundSeat = outboundSelection?.seat;
  const returnSeat = returnSelection?.seat;
  const selectionFailures = [
    !stationCandidate && 'station-poi', !hotelCandidate && 'hotel-poi', !chosenPlaces.length && 'attraction-list',
    chosenPlaces.some(row => !allPlaces.some(place => place.id === row.id)) && 'attraction-poi',
  ].filter(Boolean);
  if (selectionFailures.length) {
    const error = new PublicError('MODEL_SELECTION_NOT_GROUNDED', '模型选出的车次或地点无法与真实查询结果匹配。为避免生成虚构内容，本次没有覆盖旧行程；请稍后重试。', 502);
    error.selectionFailures = selectionFailures;
    throw error;
  }
  const ticketWindowClosed = intent.dayOffset + 1 > 14 && (!outbound || !inbound);
  if ((!outbound || !inbound || !outboundSeat || !returnSeat) && !ticketWindowClosed) throw new PublicError('NO_FEASIBLE_RAIL', '在已核实车站与时间限制下，没有满足条件的有票往返车次。请调整时间，或在车票开售后重新查询。', 409);
  const [stationDetail, hotelDetail, ...placeDetails] = await Promise.all([
    service.detail({ city: intent.destinationCity, id: stationCandidate.id }),
    service.detail({ city: intent.destinationCity, id: hotelCandidate.id }),
    ...chosenPlaces.map(row => service.detail({ city: intent.destinationCity, id: row.id })),
  ]);
  const rawPlanInput = {
    originCity: intent.originCity, destinationCity: intent.destinationCity,
    departureDate: intent.departureDate, returnDate: intent.returnDate,
    earliestLeaveTime: intent.earliestLeaveTime, latestHomeTime: intent.latestHomeTime,
    budgetCny: intent.budgetCny, foodDailyCny: intent.foodDailyCny, hotelCny: intent.hotelCny, transitDailyCny: intent.transitDailyCny,
    homeTransferMinutes: intent.homeTransferMinutes,
    ticketStatus: ticketWindowClosed ? 'not-yet-open' : 'available',
    fromStationName: strategy.origin.name, toStationName: strategy.destination.name,
    fromStationCode: strategy.origin.code, toStationCode: strategy.destination.code,
    outboundTicketId: outbound.id, returnTicketId: inbound.id, outboundSeat: outboundSeat.name, returnSeat: returnSeat.name,
    stationPoiId: stationDetail.id, overnightPoiId: hotelDetail.id,
    foodKeywords: intent.foodKeywords,
    places: chosenPlaces.map((row, index) => ({ id: row.id, required: index === 0 || row.required === true, durationMinutes: Number.isInteger(row.durationMinutes) ? Math.max(15, Math.min(240, row.durationMinutes)) : 90, admissionCny: '', reason: pick(row.reason, 220) })),
  };
  let plans = await generatePlans(service, rawPlanInput);
  plans.preferences = intent.preferences;
  plans.summary = ticketWindowClosed ? `按${strategy.destination.name}及实时地点资料编排${intent.destinationCity}行程；车票尚未开售，城际时段仅作参考。` : pick(selected.summary, 240) || strategy.summary || `为你安排${intent.destinationCity}两天一晚，兼顾真实车次、城市地标与周边餐饮。`;
  plans.ticketStatus = ticketWindowClosed ? 'not-yet-open' : 'available';
  plans.recommendedVariant = selected.recommendedPace === 'gentle' || strategy.recommendedPace === 'gentle' ? 'gentle' : 'coverage';
  plans.intent = { ...intent, participants: 1 };
  plans.weather = weatherForTrip(evidence.find(row => row.kind === 'weather')?.data, intent);
  plans.assumptions = ['人数按 1 人；车票使用查询时的有票席别，未购买。', '住宿为地点位置参考；没有实际房价或预订信息。', '餐厅来自所选地点附近的实时搜索；参考消费不等于当天成交价。', '开放时间与预约状态需按出行日再次确认；高德营业文本不视为当日核实。', '住处接驳时间和费用依据用户输入估算。'];
  if (ticketWindowClosed) plans.assumptions[0] = '车票超出预售期；去返城际段仅以 3 小时参考时间块占位，不代表真实车次时刻、余票或票价；开售后须重新查询并调整。';
  plans.evidence = recordEvidence(plans, evidence);
  return { kind: 'trip', intent, rawPlanInput, plans };
}

export async function parseAdjustment(client, message, trip) {
  const parsed = await client.json([
    { role: 'system', content: '把用户对现有行程的修改意向归类。只返回 JSON：action 为 less-walking / later-departure / replace-restaurant / complete-event / unsupported；eventId 仅在用户明确指定时填写；minutes 对晚出发可取整数；reason 为简短中文。不要执行预订或购买。' },
    { role: 'user', content: JSON.stringify({ message: String(message).slice(0, 500), currentSummary: trip.plans.summary, eventIds: (trip.plans.variants.find(row => row.id === trip.plans.recommendedVariant)?.events ?? []).map(row => ({ id: row.id, title: row.title, kind: row.kind })) }) },
  ], { request: { max_tokens: 300 } });
  const value = parsed.value ?? {};
  const text = message.toLowerCase();
  if (/少走|少步|轻松|不累|步行少/.test(text)) value.action = 'less-walking';
  else if (/晚一小时|晚点出发|晚出发/.test(text)) { value.action = 'later-departure'; value.minutes = Number(value.minutes) || 60; }
  else if (/换.*餐|换家|换一个餐厅|换个餐馆/.test(text)) value.action = 'replace-restaurant';
  return value;
}

export async function applyAdjustment({ service, client, trip, message, eventId, onProgress = async () => {} }) {
  const parsed = eventId ? { action: 'complete-event', eventId, reason: '标记为已完成' } : await parseAdjustment(client, message, trip);
  const previous = trip.plans.variants.find(row => row.id === trip.plans.recommendedVariant) ?? trip.plans.variants[0];
  if (parsed.action === 'unsupported') throw new PublicError('UNSUPPORTED_ADJUSTMENT', '这次修改还不在首版范围。可以试试“少走路”“晚一小时”“换家餐馆”，或点行程上的“已逛完”。');
  let next;
  if (parsed.action === 'less-walking') {
    next = structuredClone(trip.plans);
    next.recommendedVariant = 'gentle';
    next.version = trip.currentVersion + 1;
    next.changeSummary = ['切换为少步行方案；已保留原始多覆盖方案供比较。'];
  } else if (parsed.action === 'complete-event') {
    const target = (previous.events ?? []).find(row => row.id === parsed.eventId);
    if (!target) throw new PublicError('EVENT_NOT_FOUND', '这项活动不在当前版本中，请重新打开行程后选择。', 409);
    next = structuredClone(trip.plans);
    const active = next.variants.find(row => row.id === next.recommendedVariant) ?? next.variants[0];
    const event = active.events.find(row => row.id === parsed.eventId);
    event.completed = true;
    next.version = trip.currentVersion + 1;
    next.changeSummary = [`保留“${target.title}”的原时间段并标记为已完成。`];
  } else {
    await onProgress(parsed.action === 'later-departure' ? '正在重新核对较晚车次…' : '正在搜索替代餐馆并重排行程…');
    const input = structuredClone(trip.rawPlanInput);
    if (parsed.action === 'later-departure') {
      const tickets = await service.tickets({ date: input.departureDate, fromCity: input.originCity, toCity: input.destinationCity, fromStationCode: input.fromStationCode, toStationCode: input.toStationCode });
      const old = tickets.tickets.find(row => row.id === input.outboundTicketId);
      const threshold = Date.parse(old?.departureAt ?? '') + Math.min(180, Math.max(30, Number(parsed.minutes) || 60)) * 60000;
      const replacement = tickets.tickets.find(row => Date.parse(row.departureAt) >= threshold && row.seats.some(seat => seat.status === 'available' && seat.priceCny != null));
      const seat = replacement?.seats.find(row => row.name === input.outboundSeat && row.status === 'available' && row.priceCny != null) ?? replacement?.seats.find(row => row.status === 'available' && row.priceCny != null);
      if (!replacement || !seat) throw new PublicError('NO_LATER_TRAIN', '没有查到满足“晚一小时”的后续有票车次，原计划仍保留。');
      input.outboundTicketId = replacement.id; input.outboundSeat = seat.name;
    } else if (parsed.action === 'replace-restaurant') {
      const selected = previous.events.find(row => row.kind === 'rest' && row.placeDetails)?.placeDetails?.id;
      input.restaurantAvoidIds = [...new Set([...(input.restaurantAvoidIds ?? []), selected].filter(Boolean))];
    }
    next = await generatePlans(service, input);
    next.preferences = trip.plans.preferences; next.summary = trip.plans.summary; next.recommendedVariant = trip.plans.recommendedVariant;
    next.intent = trip.plans.intent; next.assumptions = trip.plans.assumptions; next.weather = trip.plans.weather; next.evidence = recordEvidence(next, trip.plans.evidence ?? []);
    next.version = trip.currentVersion + 1;
    next.changeSummary = parsed.action === 'later-departure' ? ['重新查询并采用了更晚的去程车次；预算、目的地和其他安排沿用上一版。'] : ['重新查询餐饮周边候选，并调整受影响的到店路线和时间；原版本保留。'];
    trip.rawPlanInput = input;
  }
  next.version ??= trip.currentVersion + 1;
  next.previousVersion = trip.currentVersion;
  trip.currentVersion = next.version;
  trip.plans = next;
  trip.history.push(structuredClone(next));
  return next;
}
