import { PublicError } from './mcp-gateway.mjs';

// These are extension points, not claims that the corresponding providers are connected.
export const informationKinds = Object.freeze({
  'meal-price': '餐饮菜单或实际消费价格',
  'hotel-rate': '指定日期与房型的住宿报价',
  admission: '指定日期与票种的门票价格及预约',
  'opening-hours': '指定日期的营业或开放安排',
});

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const optionalString = value => typeof value === 'string' && value.trim() ? value.trim() : null;
function validDate(value) {
  return typeof value === 'string' && datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /(?:key|token|secret|auth|signature|credential)/i.test(key)) ? url.href : null;
  } catch { return null; }
}

export function createInformationPorts(providers = {}) {
  const status = () => Object.entries(informationKinds).map(([kind,description]) => ({
    kind, description, connected: typeof providers[kind]?.query === 'function',
    provider: typeof providers[kind]?.query === 'function' ? providers[kind].name ?? '未命名来源' : null,
  }));

  async function lookup(input) {
    const kind = input?.kind;
    if (!Object.hasOwn(informationKinds, kind)) throw new PublicError('UNKNOWN_INFORMATION_KIND', '未知补充信息类别。');
    const provider = providers[kind];
    if (typeof provider?.query !== 'function') throw new PublicError('SOURCE_NOT_CONNECTED', `${informationKinds[kind]}来源尚未接入；请保留待确认状态。`);
    if (typeof input.city !== 'string' || !input.city.trim() || input.city.length > 20 || !validDate(input.date) ||
        !(typeof input.placeId === 'string' && input.placeId.trim() || typeof input.placeName === 'string' && input.placeName.trim())) {
      throw new PublicError('INVALID_INFORMATION_INPUT', '请提供城市、适用日期和具体地点 ID 或名称。');
    }
    const response = await provider.query(input);
    if (!response || !['found', 'not-found'].includes(response.status) || !Array.isArray(response.items) || response.items.length > 10 ||
        (response.status === 'found' && !response.items.length)) throw new PublicError('INFORMATION_RESPONSE', '补充来源返回格式无效。');
    const items = response.items.map(item => {
      if (typeof item?.source !== 'string' || !item.source.trim() || !Number.isFinite(Date.parse(item.queriedAt)) || !validDate(item.validForDate) || item.validForDate !== input.date ||
          typeof item.label !== 'string' || !item.label.trim() ||
          !(Number.isInteger(item.amountCents) && item.amountCents >= 0 || typeof item.text === 'string' && item.text.trim()) ||
          (item.amountCents != null && (!Number.isInteger(item.amountCents) || item.amountCents < 0)) ||
          (item.sourceUrl != null && !safeUrl(item.sourceUrl))) throw new PublicError('INFORMATION_RESPONSE', '补充信息缺少可信来源、查询时间、适用日期，或链接不安全。');
      return {
        label: item.label.trim(), amountCents: item.amountCents ?? null, text: item.text?.trim() ?? null,
        variant: optionalString(item.variant), conditions: optionalString(item.conditions),
        source: item.source.trim(), sourceUrl: item.sourceUrl == null ? null : safeUrl(item.sourceUrl),
        queriedAt: item.queriedAt, validForDate: item.validForDate,
      };
    });
    if (response.status === 'not-found' && items.length) throw new PublicError('INFORMATION_RESPONSE', '未找到信息时不能附带结果。');
    return { kind, city: input.city.trim(), date: input.date, status: response.status, items, provider: provider.name ?? '未命名来源' };
  }
  return { status, lookup };
}
