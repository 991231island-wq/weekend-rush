import { normalizeTickets, parseCoordinates } from './trip-utils.mjs';
import { PublicError } from './mcp-gateway.mjs';
import { createInformationPorts } from './information-ports.mjs';

export const todayShanghai = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function dateInput(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new PublicError('INVALID_DATE', '请选择有效的出行日期。');
  return value;
}
export function textInput(value, label, max = 60) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new PublicError('INVALID_INPUT', `请填写${label}（不超过 ${max} 字）。`);
  return value.trim();
}
const cityKey = value => String(value ?? '').replace(/市$/, '').trim();
const meta = ({ source, queriedAt, cacheHit, tool }) => ({ source, queriedAt, cacheHit, tool });
const placeholder = /^(?:暂无(?:信息|数据)?|未知|不详|无|--+|null|undefined|0(?:\.0+)?)$/i;
function optionalText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return !text || placeholder.test(text) ? null : text;
}
function safePhotoUrl(value) {
  try {
    const url = new URL(value);
    const hasCredential = [...url.searchParams.keys()].some(key => /^(?:key|token|secret|api[-_]?key)$/i.test(key));
    if (url.protocol !== 'https:' || url.username || url.password || hasCredential) return null;
    return url.href;
  } catch { return null; }
}
function photosOf(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map(row => {
    const url = safePhotoUrl(row?.url);
    return url ? { title: optionalText(row.title ?? row.name), url } : null;
  }).filter(Boolean);
}
function meters(value) {
  const number = numericMetric(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}
function minutesFromSeconds(value) {
  const number = numericMetric(value);
  return Number.isFinite(number) && number >= 0 ? Math.ceil(number / 60) : null;
}
function numericMetric(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function routeSteps(value) {
  return (Array.isArray(value) ? value : []).map(row => ({
    instruction: optionalText(row?.instruction), road: optionalText(row?.road),
    distanceMeters: meters(row?.distance), durationMinutes: minutesFromSeconds(row?.duration),
    orientation: optionalText(row?.orientation), action: optionalText(row?.action), assistantAction: optionalText(row?.assistant_action),
  }));
}
function walkingSegment(row, origin, destination) {
  return {
    kind: 'walking', origin: optionalText(row?.origin) ?? origin ?? null, destination: optionalText(row?.destination) ?? destination ?? null,
    distanceMeters: meters(row?.distance), durationMinutes: minutesFromSeconds(row?.duration),
    steps: routeSteps(row?.steps),
  };
}
function transitSegments(value) {
  return (Array.isArray(value) ? value : []).map(row => {
    const buslines = (Array.isArray(row?.bus?.buslines) ? row.bus.buslines : []).map(line => ({
      name: optionalText(line?.name), departureStop: optionalText(line?.departure_stop?.name), arrivalStop: optionalText(line?.arrival_stop?.name),
      distanceMeters: meters(line?.distance), durationMinutes: minutesFromSeconds(line?.duration),
      viaStops: (Array.isArray(line?.via_stops) ? line.via_stops : []).map(stop => optionalText(stop?.name)).filter(Boolean),
    }));
    const railway = row?.railway && (optionalText(row.railway.name) || optionalText(row.railway.trip))
      ? { name: optionalText(row.railway.name), trip: optionalText(row.railway.trip) } : null;
    return {
      kind: railway ? 'railway' : buslines.length ? 'transit' : 'walking',
      walking: walkingSegment(row?.walking, null, null), buslines, railway,
      entrance: optionalText(row?.entrance?.name), exit: optionalText(row?.exit?.name),
    };
  });
}
function straightLineMeters(first, second) {
  const a = parseCoordinates(first); const b = parseCoordinates(second);
  if (!a || !b) return null;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat); const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function createLiveService(gateway, { informationProviders = {} } = {}) {
  const information = createInformationPorts(informationProviders);
  async function stations(city) {
    city = textInput(city, '城市', 20);
    const result = await gateway.call('rail', 'get-stations-code-in-city', { city }, 3600000);
    if (!Array.isArray(result.data)) throw new PublicError('STATION_LOOKUP_FAILED', '车站查询返回异常，请确认城市名称。', 502);
    const rows = result.data.filter(row => /^[A-Z]{3}$/.test(row.station_code)).map(row => ({ name: row.station_name, code: row.station_code }));
    if (!rows.length) throw new PublicError('NO_STATIONS', '未找到该城市的车站，请检查城市名称。');
    return { stations: rows, ...meta(result) };
  }
  async function tickets(input) {
    const date = dateInput(input.date);
    const today = todayShanghai();
    const offset = (Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`)) / 86400000;
    if (offset < 0 || offset > 14) throw new PublicError('OUTSIDE_SALE_WINDOW', '当前只查询今天起 15 天内的车次，请调整日期。');
    const [origins, destinations] = await Promise.all([stations(input.fromCity), stations(input.toCity)]);
    const from = origins.stations.find(row => row.code === input.fromStationCode);
    const to = destinations.stations.find(row => row.code === input.toStationCode);
    if (!from || !to || from.code === to.code) throw new PublicError('INVALID_STATIONS', '请先选择城市内的精确起终车站。');
    const result = await gateway.call('rail', 'get-tickets', { date, fromStation: from.code, toStation: to.code, trainFilterFlags: 'GD', earliestStartTime: 0, latestStartTime: 24, sortFlag: 'startTime', limitedNum: 0, format: 'json' }, 60000);
    if (!Array.isArray(result.data)) throw new PublicError('TICKET_RESPONSE', '12306 未返回可解析车次。请检查日期、区间或稍后重试。', 502);
    const normalized = normalizeTickets(result.data, { date, fromStationCode: from.code, toStationCode: to.code, queriedAt: result.queriedAt }, { limit: 200 });
    const supported = normalized.tickets.filter(row => /^[GD]/.test(row.trainCode));
    const unique = [...new Map(supported.filter(row => Date.parse(row.departureAt) > Date.now()).map(row => [row.id, row])).values()];
    return { tickets: unique, from, to, rejectedCount: normalized.rejected.length + normalized.tickets.length - supported.length, ...meta(result), notice: '仅保留精确车站的 G/D 车次；余票和票价以查询时为准，不代表已购票。' };
  }
  async function search(input) {
    const city = textInput(input.city, '目的城市', 20);
    const keywords = textInput(input.keywords, '地点关键词', 50);
    const result = await gateway.call('amap', 'maps_text_search', { keywords, city }, 120000);
    if (!Array.isArray(result.data?.pois)) throw new PublicError('POI_RESPONSE', '地点搜索返回异常。', 502);
    return { candidates: result.data.pois.slice(0, 12).map(row => ({ id: row.id, name: row.name, address: row.address, typecode: row.typecode })).filter(row => row.id && row.name), ...meta(result), notice: '请选择具体地点；选择后会再核对城市与坐标。' };
  }
  async function detail(input) {
    const id = textInput(input.id, '地点 ID', 40);
    if (!/^[A-Za-z0-9]+$/.test(id)) throw new PublicError('INVALID_POI', '地点 ID 格式无效。');
    const city = textInput(input.city, '目的城市', 20);
    const result = await gateway.call('amap', 'maps_search_detail', { id }, 300000);
    const row = result.data;
    if (!row?.id || !row.name || !parseCoordinates(row.location)) throw new PublicError('POI_DETAIL_MISSING', '该地点没有有效坐标，请选择其他具体地点。');
    if (cityKey(row.city) !== cityKey(city)) throw new PublicError('POI_WRONG_CITY', `该地点位于${row.city || '未知城市'}，与目的城市不符，请重新选择。`);
    return {
      id: row.id, name: row.name, address: optionalText(row.address) ?? '', city: row.city, type: row.type, location: row.location,
      businessArea: optionalText(row.business_area ?? row.businessArea), alias: optionalText(row.alias), photos: photosOf(row.photos),
      rating: optionalText(row.rating), referenceConsumption: optionalText(row.cost ?? row.biz_ext?.cost),
      openingText: optionalText(row.opentime ?? row.opentime2 ?? row.biz_ext?.opentime), ...meta(result),
    };
  }
  async function around(input) {
    const city = textInput(input.city, '目的城市', 20);
    const anchorId = textInput(input.anchorId, '中心地点', 40);
    if (!/^[A-Za-z0-9]+$/.test(anchorId)) throw new PublicError('INVALID_POI', '中心地点 ID 格式无效。');
    const keywords = textInput(input.keywords, '周边关键词', 30);
    const radius = input.radius == null || input.radius === '' ? 1000 : Number(input.radius);
    if (!Number.isInteger(radius) || radius < 100 || radius > 5000) throw new PublicError('INVALID_RADIUS', '周边半径须为 100–5000 米。');
    const anchor = await detail({ city, id: anchorId });
    const result = await gateway.call('amap', 'maps_around_search', { location: anchor.location, radius: String(radius), keywords }, 120000);
    if (!Array.isArray(result.data?.pois)) throw new PublicError('AROUND_RESPONSE', '周边搜索返回异常。', 502);
    const checked = [];
    const seen = new Set([anchor.id]);
    let detailChecks = 0;
    let rejectedCount = 0;
    for (const candidate of result.data.pois) {
      if (detailChecks >= 6) break;
      if (!candidate?.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      detailChecks++;
      try {
        const place = await detail({ city, id: candidate.id });
        const distanceMeters = straightLineMeters(anchor.location, place.location);
        if (distanceMeters == null || distanceMeters > radius || cityKey(place.city) !== cityKey(city)) { rejectedCount++; continue; }
        checked.push({ ...place, distanceMeters });
      } catch (error) {
        if (error.code === 'MAP_AUTH' || error.code === 'QUOTA') throw error;
        rejectedCount++;
      }
    }
    checked.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return {
      anchor: { id: anchor.id, name: anchor.name, address: anchor.address, location: anchor.location }, radiusMeters: radius,
      candidates: checked.slice(0, 3), checkedCount: detailChecks, rejectedCount, ...meta(result),
      notice: '半径为直线范围，不等于步行距离；采用前请查询实际路线。参考消费、营业文本和图片均以来源返回为准，营业与预约尚未按出行日核实。',
    };
  }
  async function weather(city) {
    city = textInput(city, '目的城市', 20);
    const result = await gateway.call('amap', 'maps_weather', { city }, 600000);
    if (!Array.isArray(result.data?.forecasts)) throw new PublicError('WEATHER_RESPONSE', '天气数据暂不可用。', 502);
    return { city: result.data.city, forecasts: result.data.forecasts, ...meta(result), notice: '仅适用于返回的预报日期，超出范围不作预测。' };
  }
  async function route(origin, destination, city, pace = 'coverage') {
    if (origin.id === destination.id) return { durationMinutes: 0, distanceMeters: 0, walkingMeters: 0, mode: 'same-place', source: '同一已选地点', queriedAt: new Date().toISOString(), fareCents: null };
    if (!parseCoordinates(origin.location) || !parseCoordinates(destination.location)) throw new PublicError('INVALID_COORDINATES', '请先确认路线两端的具体地点。');
    const args = { origin: origin.location, destination: destination.location };
    let walk;
    try {
      const response = await gateway.call('amap', 'maps_direction_walking', args, 300000);
      const path = response.data?.route?.paths?.filter(row => Number(row.duration) > 0 && Number(row.distance) > 0).sort((a, b) => Number(a.duration) - Number(b.duration))[0];
      if (path) walk = { mode: 'walking', durationMinutes: Math.ceil(Number(path.duration) / 60), distanceMeters: Number(path.distance), walkingMeters: Number(path.distance), fareCents: 0, routeDetails: { kind: 'walking', segments: [walkingSegment(path, response.data.route.origin, response.data.route.destination)] }, ...meta(response) };
    } catch (error) { if (error.code === 'MAP_AUTH' || error.code === 'QUOTA') throw error; }
    const walkLimit = pace === 'gentle' ? 800 : 2200;
    if (walk && walk.walkingMeters <= walkLimit) return walk;
    try {
      const response = await gateway.call('amap', 'maps_direction_transit_integrated', { ...args, city, cityd: city }, 300000);
      const paths = response.data?.route?.transits?.filter(row => Number(row.duration) > 0 && Number.isFinite(Number(row.walking_distance))) ?? [];
      paths.sort((a, b) => pace === 'gentle' ? Number(a.walking_distance) - Number(b.walking_distance) || Number(a.duration) - Number(b.duration) : Number(a.duration) - Number(b.duration));
      if (paths.length) return { mode: 'transit', durationMinutes: Math.ceil(Number(paths[0].duration) / 60), distanceMeters: null, walkingMeters: Number(paths[0].walking_distance), fareCents: null, routeDetails: { kind: 'transit', segments: transitSegments(paths[0].segments) }, ...meta(response) };
    } catch (error) { if (error.code === 'MAP_AUTH' || error.code === 'QUOTA') throw error; }
    throw new PublicError('NO_ROUTE', `未取得符合步行偏好的路线：${origin.name} → ${destination.name}。`);
  }
  return { stations, tickets, search, detail, around, weather, route,
    informationStatus: information.status, informationLookup: information.lookup,
    status: () => ({ today: todayShanghai(), ...gateway.status(), informationSources: information.status() }) };
}
