import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { comparePlans, normalizeTickets, parseCoordinates, resolvePoiCandidates, routeMetrics, validatePlan } from '../skills/weekend-rush/scripts/trip-utils.mjs';

const query = { date: '2026-10-17', fromStationCode: 'HGH', toStationCode: 'AOH', earliestStartTime: 6, latestStartTime: 12, queriedAt: '2026-10-15T20:00:00+08:00' };
const ticket = (overrides = {}) => ({ start_train_code: 'G100', train_no: 'g100', start_date: '2026-10-16', arrive_date: '2026-10-16', start_time: '09:30', arrive_time: '10:10', lishi: '00:40', from_station: '杭州东', to_station: '上海虹桥', from_station_telecode: 'HGH', to_station_telecode: 'AOH', prices: [{ seat_name: '二等座', num: '有', price: 87 }, { seat_name: '一等座', num: '候补', price: 140 }, { seat_name: '商务座', num: '无', price: 306 }], ...overrides });

test('filters station mismatches before limiting and records rejection reasons', () => {
  const result = normalizeTickets([ticket({ start_train_code: 'A', start_time: '10:00', arrive_time: '10:40' }), ticket({ start_train_code: 'WRONG', to_station_telecode: 'SNH' }), ticket({ start_train_code: 'B', start_time: '09:00', arrive_time: '09:50', lishi: '00:50' })], query, { limit: 1 });
  assert.equal(result.totalExactMatches, 2);
  assert.equal(result.tickets.length, 1);
  assert.equal(result.tickets[0].trainCode, 'B');
  assert.equal(result.rejected[0].reason, 'station-mismatch');
});

test('uses boarding date rather than upstream origin run date and rolls arrival across midnight', () => {
  const result = normalizeTickets([ticket({ start_time: '23:30', arrive_time: '00:10' })], { ...query, date: '2026-12-31', earliestStartTime: '23:00', latestStartTime: '23:59' });
  assert.equal(result.tickets[0].travelDate, '2026-12-31');
  assert.equal(result.tickets[0].departureAt, '2026-12-31T23:30:00+08:00');
  assert.equal(result.tickets[0].arrivalAt, '2027-01-01T00:10:00+08:00');
  assert.equal(result.tickets[0].upstreamOriginRunDate, '2026-10-16');
});

test('keeps different journey segments distinct and sorts before limiting', () => {
  const rows = [ticket({ start_train_code: 'G200', start_time: '10:00', arrive_time: '10:50', lishi: '00:50', to_station_telecode: 'SNH' }), ticket({ start_train_code: 'G300', start_time: '08:30', arrive_time: '09:20', lishi: '00:50', to_station_telecode: 'SNH' }), ticket({ start_train_code: 'G100', start_time: '09:00', arrive_time: '09:40' })];
  const result = normalizeTickets(rows, { ...query, earliestStartTime: 8, latestStartTime: 11 }, { limit: 2 });
  assert.deepEqual(result.tickets.map(item => item.trainCode), ['G100']);
});

test('replays the captured 12306 mismatch and keeps only the exact query stations', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/tickets-observed-station-date.json', import.meta.url), 'utf8'));
  const result = normalizeTickets(fixture.raw, fixture.query, { limit: 1 });
  assert.equal(result.totalExactMatches, 1);
  assert.equal(result.tickets[0].trainCode, 'G269');
  assert.equal(result.tickets[0].travelDate, fixture.query.date);
  assert.equal(result.tickets[0].upstreamOriginRunDate, '2026-10-18');
  assert.equal(result.rejected[0].trainCode, 'D111');
});

test('preserves available, waitlist, sold-out and unknown seat states distinctly', () => {
  const result = normalizeTickets([ticket({ start_time: '23:30', arrive_time: '00:10', prices: [{ seat_name: '二等座', num: '有', price: 87 }, { seat_name: '一等座', num: '候补', price: 140 }, { seat_name: '商务座', num: '无', price: 300 }, { seat_name: '其他', num: '?', price: null }] })], { ...query, earliestStartTime: '23:00', latestStartTime: '23:59' });
  assert.deepEqual(result.tickets[0].seats.map(seat => seat.status), ['available', 'waitlist', 'sold-out', 'unknown']);
  assert.equal(result.tickets[0].hasAvailableSeat, true);
});

test('rejects a train when the returned arrival clock contradicts its duration', () => {
  const result = normalizeTickets([ticket({ start_time: '09:00', arrive_time: '10:30', lishi: '00:50' })], query);
  assert.equal(result.tickets.length, 0);
  assert.equal(result.rejected[0].reason, 'arrival-duration-mismatch');
});

test('rejects invalid query date and requires exact station codes', () => {
  assert.throws(() => normalizeTickets([], { ...query, date: '2026-02-30' }), /valid calendar date/);
  assert.throws(() => normalizeTickets([], { date: query.date }), /Exact.*required/);
});

const ambiguousBund = { pois: [{ id: 'pudong', name: '外滩', address: '浦东新区住宅区', typecode: '190700', location: '121.49,31.23' }, { id: 'huangpu', name: '外滩', address: '黄浦区中山东一路', typecode: '110200', location: '121.49,31.23' }] };

test('asks the user to choose when a place name resolves to multiple POIs', () => {
  assert.equal(resolvePoiCandidates(ambiguousBund).status, 'ambiguous');
  assert.equal(resolvePoiCandidates({ pois: [{ name: '外滩' }] }).status, 'not-found');
});

test('resolves a POI using stable ID or area and category, never candidate ordering', () => {
  assert.equal(resolvePoiCandidates(ambiguousBund, { poiId: 'huangpu' }).poi.address, '黄浦区中山东一路');
  assert.equal(resolvePoiCandidates(ambiguousBund, { district: '黄浦区', typecode: '110200' }).poi.id, 'huangpu');
});

test('validates coordinates and converts route units for display', () => {
  assert.deepEqual(parseCoordinates('121.49,31.23'), { lng: 121.49, lat: 31.23 });
  assert.equal(parseCoordinates('300,999'), null);
  assert.deepEqual(routeMetrics({ distanceMeters: '5668', durationSeconds: '4534' }), { distanceMeters: 5668, distanceKm: 5.67, durationSeconds: 4534, durationMinutes: 76 });
});

const event = (id, startAt, endAt, extra = {}) => ({ id, placeId: id, startAt, endAt, costCents: 1000, costStatus: 'known', bookingStatus: 'not-required', openingStatus: 'verified', ...extra });

test('flags overlaps, missing costs, budget excess and an impossible home deadline', () => {
  const plan = { events: [event('a', '2026-10-17T09:00:00+08:00', '2026-10-17T11:00:00+08:00'), event('b', '2026-10-17T10:30:00+08:00', '2026-10-17T12:00:00+08:00', { costCents: null })], arrivalHomeAt: '2026-10-18T20:00:00+08:00' };
  const result = validatePlan(plan, { mustVisitIds: ['a', 'missing'], budgetCents: 1500, latestHomeAt: '2026-10-18T19:00:00+08:00' });
  const codes = result.errors.map(item => item.code);
  assert.ok(codes.includes('event-overlap'));
  assert.ok(codes.includes('must-visit-missing'));
  assert.ok(codes.includes('home-deadline-missed'));
  assert.ok(result.warnings.some(item => item.code === 'budget-not-fully-verifiable'));
});

test('blocks declaring feasibility when booking or opening hours remain unknown', () => {
  const result = validatePlan({ events: [event('museum', '2026-10-17T09:00:00+08:00', '2026-10-17T10:00:00+08:00', { bookingStatus: 'required-unconfirmed', openingStatus: 'unknown' })] }, { budgetCents: 5000 });
  assert.equal(result.valid, true);
  assert.equal(result.feasible, false);
  assert.ok(result.warnings.some(item => item.code === 'booking-unconfirmed'));
});

test('does not allow completed events to be removed or moved during re-planning', () => {
  const previous = { events: [event('done', '2026-10-17T09:00:00+08:00', '2026-10-17T10:00:00+08:00'), event('later', '2026-10-17T11:00:00+08:00', '2026-10-17T12:00:00+08:00')] };
  const revised = { events: [previous.events[1]] };
  const result = comparePlans(previous, revised, ['done']);
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, 'completed-event-changed');
});

test('reports additions, removals and retained events with reasons', () => {
  const previous = { events: [event('museum', '2026-10-17T09:00:00+08:00', '2026-10-17T10:00:00+08:00'), event('garden', '2026-10-17T11:00:00+08:00', '2026-10-17T12:00:00+08:00')] };
  const revised = { events: [previous.events[0], event('cafe', '2026-10-17T11:00:00+08:00', '2026-10-17T12:00:00+08:00')], changeReasons: { cafe: '减少步行' } };
  const result = comparePlans(previous, revised);
  assert.equal(result.valid, true);
  assert.deepEqual(result.changes.map(change => change.change), ['kept', 'removed', 'added']);
  assert.equal(result.changes[2].reason, '减少步行');
});

test('labels a time-only revision as moved and preserves the supplied reason', () => {
  const previous = { events: [event('garden', '2026-10-17T10:00:00+08:00', '2026-10-17T11:00:00+08:00')] };
  const next = { events: [event('garden', '2026-10-17T11:00:00+08:00', '2026-10-17T12:00:00+08:00')], changeReasons: { garden: '出发延迟' } };
  const result = comparePlans(previous, next);
  assert.deepEqual(result.changes[0], { eventId: 'garden', change: 'moved', reason: '出发延迟' });
});
