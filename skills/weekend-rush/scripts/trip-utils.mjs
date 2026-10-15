#!/usr/bin/env node

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value, label = 'date') {
  if (typeof value !== 'string' || !datePattern.test(value)) throw new TypeError(`${label} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new RangeError(`${label} is not a valid calendar date`);
  return value;
}

function minutesFromClock(value, label, allowEndOfDay = false) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''));
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || minute > 59 || hour > 23 && !(allowEndOfDay && hour === 24 && minute === 0)) throw new TypeError(`${label} must use HH:mm`);
  return hour * 60 + minute;
}

function durationMinutes(value) {
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  const match = /^(\d{1,3}):(\d{2})$/.exec(String(value ?? ''));
  if (!match || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clockAt(date, minutes) {
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCMinutes(start.getUTCMinutes() + minutes);
  return `${start.toISOString().slice(0, 10)}T${start.toISOString().slice(11, 16)}:00+08:00`;
}

function normalizeSeat(seat) {
  const raw = String(seat.num ?? '').trim();
  const lower = raw.toLowerCase();
  let status = 'unknown';
  let quantity = null;
  if (/^\d+$/.test(raw)) {
    quantity = Number(raw);
    status = quantity > 0 ? 'available' : 'sold-out';
  } else if (/^(有|充足|少量|available)$/i.test(raw)) status = 'available';
  else if (/候补|waitlist/i.test(raw)) status = 'waitlist';
  else if (/^(无|售罄|无票|sold.?out)$/i.test(raw)) status = 'sold-out';
  return { name: seat.seat_name ?? seat.name ?? '未知席别', status, quantity, priceCny: Number.isFinite(Number(seat.price)) ? Number(seat.price) : null, upstreamStatus: raw || lower || null };
}

function unpackRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.tickets)) return raw.tickets;
  return [];
}

/** Normalize a 12306 MCP response without trusting its origin-run date or endpoint scope. */
export function normalizeTickets(raw, query, { limit = 10 } = {}) {
  assertDate(query.date, 'query.date');
  const from = query.fromStationCode;
  const to = query.toStationCode;
  if (!from || !to) throw new TypeError('Exact fromStationCode and toStationCode are required');
  const earliest = query.earliestStartTime == null ? null : minutesFromClock(String(query.earliestStartTime).includes(':') ? query.earliestStartTime : `${String(query.earliestStartTime).padStart(2, '0')}:00`, 'earliestStartTime');
  const latest = query.latestStartTime == null ? null : minutesFromClock(String(query.latestStartTime).includes(':') ? query.latestStartTime : `${String(query.latestStartTime).padStart(2, '0')}:00`, 'latestStartTime', true);
  const rejected = [];
  const normalized = [];
  for (const row of unpackRows(raw)) {
    const trainCode = row.start_train_code ?? row.train_code ?? row.code ?? null;
    if (row.from_station_telecode !== from || row.to_station_telecode !== to) {
      rejected.push({ trainCode, reason: 'station-mismatch', actualFrom: row.from_station_telecode ?? null, actualTo: row.to_station_telecode ?? null });
      continue;
    }
    let start;
    let duration;
    try { start = minutesFromClock(row.start_time, 'start_time'); duration = durationMinutes(row.lishi ?? row.durationMinutes); }
    catch { duration = null; }
    if (start == null || duration == null) {
      rejected.push({ trainCode, reason: 'invalid-time-or-duration' });
      continue;
    }
    let arrivalClockVerified = null;
    if (row.arrive_time != null && row.arrive_time !== '') {
      try { arrivalClockVerified = minutesFromClock(row.arrive_time, 'arrive_time') === (start + duration) % 1440; }
      catch { arrivalClockVerified = false; }
      if (!arrivalClockVerified) {
        rejected.push({ trainCode, reason: 'arrival-duration-mismatch' });
        continue;
      }
    }
    if ((earliest != null && start < earliest) || (latest != null && start > latest)) {
      rejected.push({ trainCode, reason: 'outside-time-window' });
      continue;
    }
    const seats = (Array.isArray(row.prices) ? row.prices : []).map(normalizeSeat);
    normalized.push({
      id: `${query.date}:${trainCode}:${from}:${to}`,
      trainCode,
      trainNo: row.train_no ?? null,
      travelDate: query.date,
      departureAt: clockAt(query.date, start),
      arrivalAt: clockAt(query.date, start + duration),
      durationMinutes: duration,
      arrivalClockVerified,
      from: { name: row.from_station ?? null, code: from },
      to: { name: row.to_station ?? null, code: to },
      seats,
      hasAvailableSeat: seats.some(seat => seat.status === 'available'),
      source: '12306 MCP',
      queriedAt: query.queriedAt ?? null,
      upstreamOriginRunDate: row.start_date ?? null,
    });
  }
  normalized.sort((a, b) => a.departureAt.localeCompare(b.departureAt) || String(a.trainCode).localeCompare(String(b.trainCode)));
  return { requested: { date: query.date, fromStationCode: from, toStationCode: to }, totalExactMatches: normalized.length, tickets: normalized.slice(0, Math.max(0, limit)), rejected };
}

function unpackPois(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.pois)) return result.pois;
  if (Array.isArray(result?.return)) return result.return;
  return [];
}

/** Resolve a place only when one POI is selected or unambiguous. */
export function resolvePoiCandidates(result, { poiId, district, typecode } = {}) {
  const candidates = unpackPois(result).map(poi => ({ id: poi.id ?? null, name: poi.name ?? null, address: poi.address ?? null, district: poi.district ?? null, typecode: poi.typecode ?? null, location: poi.location ?? null, source: '高德地图' }));
  let matches = candidates;
  if (poiId) matches = matches.filter(poi => poi.id === poiId);
  if (district) matches = matches.filter(poi => `${poi.district ?? ''} ${poi.address ?? ''}`.includes(district));
  if (typecode) matches = matches.filter(poi => poi.typecode === typecode);
  const valid = matches.filter(poi => poi.id && poi.name);
  if (valid.length === 1) return { status: 'resolved', poi: valid[0], candidates };
  if (valid.length === 0) return { status: 'not-found', poi: null, candidates };
  return { status: 'ambiguous', poi: null, candidates: valid };
}

export function parseCoordinates(location) {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(location ?? ''));
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { lng, lat };
}

export function routeMetrics({ distanceMeters, durationSeconds }) {
  const distance = Number(distanceMeters);
  const duration = Number(durationSeconds);
  return { distanceMeters: Number.isFinite(distance) && distance >= 0 ? distance : null, distanceKm: Number.isFinite(distance) && distance >= 0 ? Math.round(distance / 10) / 100 : null, durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null, durationMinutes: Number.isFinite(duration) && duration >= 0 ? Math.ceil(duration / 60) : null };
}

function parseInstant(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO timestamp with timezone`);
  return parsed;
}

/** Validate an AI-proposed plan; missing data is a warning/blocker, never a pass. */
export function validatePlan(plan, constraints = {}) {
  const errors = [];
  const warnings = [];
  const events = Array.isArray(plan.events) ? plan.events : [];
  const seenIds = new Set();
  const ordered = [];
  let totalCents = 0;
  let knownCost = true;
  for (const event of events) {
    if (!event.id || seenIds.has(event.id)) errors.push({ code: 'duplicate-or-missing-id', eventId: event.id ?? null });
    if (event.id) seenIds.add(event.id);
    let start; let end;
    try { start = parseInstant(event.startAt, 'event.startAt'); end = parseInstant(event.endAt, 'event.endAt'); }
    catch { errors.push({ code: 'invalid-event-time', eventId: event.id ?? null }); continue; }
    if (end <= start) errors.push({ code: 'non-positive-duration', eventId: event.id });
    ordered.push({ id: event.id, start, end });
    if (!Number.isInteger(event.costCents) || event.costCents < 0 || event.costStatus === 'unknown') {
      knownCost = false;
      warnings.push({ code: 'cost-unknown', eventId: event.id });
    } else {
      totalCents += event.costCents;
      if (event.costStatus === 'estimate') warnings.push({ code: 'cost-estimated', eventId: event.id });
    }
    if (event.bookingStatus === 'required-unconfirmed' || event.bookingStatus === 'unknown') warnings.push({ code: 'booking-unconfirmed', eventId: event.id });
    if (event.openingStatus === 'unknown') warnings.push({ code: 'opening-hours-unknown', eventId: event.id });
  }
  ordered.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) if (ordered[i].start < ordered[i - 1].end) errors.push({ code: 'event-overlap', eventId: ordered[i].id, overlapsWith: ordered[i - 1].id });
  const expected = constraints.mustVisitIds ?? [];
  for (const id of expected) if (!events.some(event => event.placeId === id || event.id === id)) errors.push({ code: 'must-visit-missing', placeId: id });
  if (Number.isInteger(constraints.budgetCents) && totalCents > constraints.budgetCents) errors.push({ code: 'budget-exceeded', totalCents, budgetCents: constraints.budgetCents });
  if (constraints.latestHomeAt && plan.arrivalHomeAt) {
    if (parseInstant(plan.arrivalHomeAt, 'arrivalHomeAt') > parseInstant(constraints.latestHomeAt, 'latestHomeAt')) errors.push({ code: 'home-deadline-missed' });
  } else if (constraints.latestHomeAt) warnings.push({ code: 'home-arrival-unknown' });
  if (constraints.budgetCents != null && !knownCost) warnings.push({ code: 'budget-not-fully-verifiable' });
  return { valid: errors.length === 0, feasible: errors.length === 0 && warnings.length === 0, errors, warnings, totalCostCents: knownCost ? totalCents : null, knownCostCents: totalCents };
}

export function comparePlans(previous, next, completedIds = []) {
  const before = new Map((previous.events ?? []).map(event => [event.id, event]));
  const after = new Map((next.events ?? []).map(event => [event.id, event]));
  const completed = new Set(completedIds);
  const violations = [];
  for (const id of completed) {
    const oldEvent = before.get(id);
    const newEvent = after.get(id);
    if (!oldEvent || !newEvent || ['startAt', 'endAt', 'placeId', 'title', 'costCents', 'walkingMeters'].some(key => oldEvent[key] !== newEvent[key])) violations.push({ code: 'completed-event-changed', eventId: id });
  }
  const changes = [];
  for (const [id, event] of before) {
    const revised = after.get(id);
    if (!revised) changes.push({ eventId: id, change: completed.has(id) ? 'invalid-removal' : 'removed', reason: next.changeReasons?.[id] ?? null });
    else if (event.startAt !== revised.startAt || event.endAt !== revised.endAt || event.placeId !== revised.placeId || event.walkingMeters !== revised.walkingMeters || event.costCents !== revised.costCents || event.title !== revised.title) {
      const timeOnlyChange = event.startAt !== revised.startAt || event.endAt !== revised.endAt;
      const otherChange = event.placeId !== revised.placeId || event.walkingMeters !== revised.walkingMeters || event.costCents !== revised.costCents || event.title !== revised.title;
      changes.push({ eventId: id, change: completed.has(id) ? 'invalid-change' : timeOnlyChange && !otherChange ? 'moved' : 'changed', reason: next.changeReasons?.[id] ?? null });
    }
    else changes.push({ eventId: id, change: 'kept', reason: null });
  }
  for (const [id] of after) if (!before.has(id)) changes.push({ eventId: id, change: 'added', reason: next.changeReasons?.[id] ?? null });
  return { valid: violations.length === 0, violations, changes };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !args.includes('--input')) {
    console.error('Usage: node scripts/trip-utils.mjs <normalize-tickets|resolve-poi|validate-plan|compare-plans> --input <json-file>');
    process.exitCode = 2;
    return;
  }
  const inputPath = args[args.indexOf('--input') + 1];
  const { readFile } = await import('node:fs/promises');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  let output;
  if (command === 'normalize-tickets') output = normalizeTickets(input.raw, input.query, { limit: input.limit });
  else if (command === 'resolve-poi') output = resolvePoiCandidates(input.result, input.selector);
  else if (command === 'validate-plan') output = validatePlan(input.plan, input.constraints);
  else if (command === 'compare-plans') output = comparePlans(input.previous, input.next, input.completedIds);
  else throw new Error(`Unknown command: ${command}`);
  console.log(JSON.stringify(output, null, 2));
  if (command === 'validate-plan' && !output.valid) process.exitCode = 1;
  if (command === 'compare-plans' && !output.valid) process.exitCode = 1;
}

// Keep the shared helpers loadable by a browser; Node modules belong to the CLI branch.
if (typeof process !== 'undefined' && process.versions?.node && process.argv[1]) {
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
}
