import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFeasibleRailStations, extractIntent, railCandidatesWithinHardTimes, research, selectRailTicket, weatherForTrip } from '../server/intent-agent.mjs';
import { PublicError } from '../server/mcp-gateway.mjs';

function fakeClient(value) { return { async json() { return { value }; } }; }

test('intent extraction keeps explicit fields, derives the one-night return date, and applies visible defaults', async () => {
  const result = await extractIntent(fakeClient({ originCity: '宁波', destinationCity: '南京', departureDate: '2026-10-24', preferences: '看历史建筑', foodKeywords: '本地小吃' }), {
    message: '想看历史建筑', today: '2026-10-16', supplied: { originCity: '杭州', budgetCny: '800', earliestLeaveTime: '07:00', latestHomeTime: '22:00' },
  });
  assert.deepEqual(result.missing, []);
  assert.equal(result.intent.originCity, '杭州');
  assert.equal(result.intent.destinationCity, '南京');
  assert.equal(result.intent.departureDate, '2026-10-24');
  assert.equal(result.intent.returnDate, '2026-10-25');
  assert.equal(result.intent.budgetCny, 800);
  assert.equal(result.intent.foodDailyCny, 120);
  assert.equal(result.intent.homeTransferMinutes, 45);
  assert.equal(result.intent.participants, undefined);
});

test('intent extraction groups genuinely missing critical fields and does not guess them', async () => {
  const result = await extractIntent(fakeClient({ preferences: '想吃当地小吃' }), { message: '想吃当地小吃', supplied: {}, today: '2026-10-16' });
  assert.deepEqual(result.missing, ['originCity', 'destinationCity', 'departureDate', 'returnDate']);
  assert.equal(result.intent.originCity, '');
  assert.equal(result.intent.budgetCny, 1000);
});

test('intent extraction rejects past dates and non-consecutive trips before data queries', async () => {
  const past = await extractIntent(fakeClient({ originCity: '广州', destinationCity: '武汉', departureDate: '2026-10-15', returnDate: '2026-10-16' }), { message: '去武汉', supplied: {}, today: '2026-10-16' });
  assert.ok(past.missing.includes('departureDate'));
  const nonconsecutive = await extractIntent(fakeClient({ originCity: '广州', destinationCity: '武汉', departureDate: '2026-10-20', returnDate: '2026-10-22' }), { message: '去武汉', supplied: {}, today: '2026-10-16' });
  assert.ok(nonconsecutive.missing.includes('returnDate'));
});

test('rail candidates are filtered against home departure buffers, home deadline, and available seats', () => {
  const intent = { departureDate: '2026-10-17', returnDate: '2026-10-18', earliestLeaveTime: '06:00', latestHomeTime: '22:00', homeTransferMinutes: 45 };
  const ticket = (id, departureAt, arrivalAt, status = 'available') => ({ id, departureAt, arrivalAt, seats: [{ status, priceCny: 88 }] });
  const result = railCandidatesWithinHardTimes([
    { id: 'out', kind: 'rail', category: 'outbound', data: { tickets: [ticket('too-early', '2026-10-17T07:20:00+08:00', '2026-10-17T09:00:00+08:00'), ticket('valid', '2026-10-17T07:30:00+08:00', '2026-10-17T09:00:00+08:00'), ticket('sold', '2026-10-17T08:00:00+08:00', '2026-10-17T09:00:00+08:00', 'sold-out')] } },
    { id: 'back', kind: 'rail', category: 'return', data: { tickets: [ticket('too-early', '2026-10-18T14:59:00+08:00', '2026-10-18T16:00:00+08:00'), ticket('too-late', '2026-10-18T19:00:00+08:00', '2026-10-18T20:50:00+08:00'), ticket('valid-back', '2026-10-18T15:00:00+08:00', '2026-10-18T16:45:00+08:00')] } },
  ], intent);
  assert.deepEqual(result.map(row => row.data.tickets.map(ticket => ticket.id)), [['valid'], ['valid-back']]);
});

test('rail choice maximizes destination time and picks the cheapest currently available seat', () => {
  const train = (id, departureAt, seats) => ({ id, departureAt, seats });
  const tickets = [
    train('early', '2026-10-17T08:00:00+08:00', [{ name: '二等座', status: 'available', priceCny: 80 }, { name: '一等座', status: 'available', priceCny: 140 }, { name: '商务座', status: 'waitlist', priceCny: 300 }]),
    train('later', '2026-10-17T08:30:00+08:00', [{ name: '二等座', status: 'available', priceCny: 75 }]),
    train('return-early', '2026-10-18T17:00:00+08:00', [{ name: '二等座', status: 'available', priceCny: 90 }]),
    train('return-late', '2026-10-18T19:00:00+08:00', [{ name: '二等座', status: 'available', priceCny: 100 }]),
  ];
  assert.deepEqual(selectRailTicket(tickets.slice(0, 2), 'outbound'), { ticket: tickets[0], seat: tickets[0].seats[0] });
  assert.deepEqual(selectRailTicket(tickets.slice(2), 'return'), { ticket: tickets[3], seat: tickets[3].seats[0] });
  assert.equal(selectRailTicket([{ ...tickets[0], seats: [{ name: '无座', status: 'sold-out', priceCny: 50 }] }], 'outbound'), null);
});

test('weather is shown only for the exact departure and return dates', () => {
  const weather = { city: '上海', forecasts: ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'].map(date => ({ date })) };
  assert.deepEqual(weatherForTrip(weather, { departureDate: '2026-10-17', returnDate: '2026-10-18' }).forecasts.map(row => row.date), ['2026-10-17', '2026-10-18']);
  assert.equal(weatherForTrip(null, {}), null);
});

test('station strategy retries the preferred high-speed hub when its proposed pair has no feasible return', async () => {
  const calls = [];
  const service = { async tickets(args) {
    calls.push([args.fromStationCode, args.toStationCode]);
    if (args.fromStationCode === 'SHH' || args.toStationCode === 'SHH') return { tickets: [] };
    const outbound = args.fromStationCode === 'HGH';
    return { tickets: [{ id: args.date, departureAt: outbound ? '2026-10-17T07:30:00+08:00' : '2026-10-18T19:00:00+08:00', arrivalAt: outbound ? '2026-10-17T09:00:00+08:00' : '2026-10-18T20:00:00+08:00', seats: [{ status: 'available', priceCny: 88 }] }] };
  } };
  const intent = { originCity: '杭州', destinationCity: '上海', departureDate: '2026-10-17', returnDate: '2026-10-18', earliestLeaveTime: '06:00', latestHomeTime: '22:00', homeTransferMinutes: 45, dayOffset: 1 };
  const stationRows = [{ stations: [{ name: '杭州东', code: 'HGH' }] }, { stations: [{ name: '上海站', code: 'SHH' }, { name: '上海虹桥', code: 'AOH' }] }];
  const proposal = { origin: stationRows[0].stations[0], destination: stationRows[1].stations[0], stationKeyword: '上海火车站', hotelKeyword: '酒店', attractionKeywords: [] };
  const result = await ensureFeasibleRailStations(service, intent, proposal, stationRows);
  assert.equal(result.destination.code, 'AOH');
  assert.equal(result.stationKeyword, '上海虹桥');
  assert.equal(calls.length, 4);
});

test('finish_research still fills required missing sources before returning evidence', async () => {
  const client = { async complete() { return { message: { tool_calls: [{ id: 'finish', function: { name: 'finish_research', arguments: '{"done":true}' } }] } }; } };
  const calls = [];
  const service = {
    async tickets(args) { calls.push(`rail:${args.date}`); return { tickets: [], source: 'fixture', queriedAt: 'now' }; },
    async search(args) { calls.push(`places:${args.keywords}`); return { candidates: [], source: 'fixture', queriedAt: 'now' }; },
    async weather() { calls.push('weather'); return { forecasts: [], source: 'fixture', queriedAt: 'now' }; },
  };
  const intent = { originCity: '杭州', destinationCity: '上海', departureDate: '2026-10-17', returnDate: '2026-10-18', dayOffset: 1, foodKeywords: '本地餐馆' };
  const strategy = { origin: { name: '杭州东', code: 'HGH' }, destination: { name: '上海虹桥', code: 'AOH' }, stationKeyword: '上海虹桥火车站', hotelKeyword: '酒店', attractionKeywords: ['城市地标'] };
  const rows = await research(client, service, intent, strategy, [{ stations: [] }, { stations: [] }]);
  assert.deepEqual(rows.filter(row => row.kind === 'rail').map(row => row.category), ['outbound', 'return']);
  assert.deepEqual(rows.filter(row => row.kind === 'places').map(row => row.category), ['station', 'hotel', 'attraction']);
  assert.ok(calls.includes('rail:2026-10-18'));
});

test('ticket-window closure is recorded as unknown availability without inventing trains', async () => {
  const client = { async complete() { return { message: { tool_calls: [{ id: 'finish', function: { name: 'finish_research', arguments: '{"done":true}' } }] } }; } };
  const service = {
    async tickets() { throw new PublicError('OUTSIDE_SALE_WINDOW', '当前日期尚未开售。'); },
    async search() { return { candidates: [], source: 'fixture', queriedAt: 'now' }; },
    async weather() { throw new Error('future weather should stay unknown'); },
  };
  const intent = { originCity: '杭州', destinationCity: '上海', departureDate: '2026-11-10', returnDate: '2026-11-11', dayOffset: 25, foodKeywords: '本地餐馆' };
  const strategy = { origin: { name: '杭州东', code: 'HGH' }, destination: { name: '上海虹桥', code: 'AOH' }, stationKeyword: '上海虹桥', hotelKeyword: '酒店', attractionKeywords: ['城市地标'] };
  const rows = await research(client, service, intent, strategy, [{ stations: [] }, { stations: [] }]);
  const rail = rows.filter(row => row.kind === 'rail');
  assert.deepEqual(rail.map(row => row.data.availability), ['not-yet-open', 'not-yet-open']);
  assert.ok(rail.every(row => row.data.tickets.length === 0));
  assert.equal(rows.some(row => row.kind === 'weather'), false);
});
