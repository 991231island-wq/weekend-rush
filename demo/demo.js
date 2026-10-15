import { comparePlans, validatePlan } from '../skills/weekend-rush/scripts/trip-utils.mjs';

const stamp = (day, time) => `2026-11-${day}T${time}:00+08:00`;
const event = (id, day, start, end, title, kind, detail, cost, walking = 0, extra = {}) => ({ id, placeId: extra.placeId ?? id, day, startAt: stamp(day, start), endAt: stamp(day, end), title, kind, detail, costCents: cost * 100, costStatus: 'estimate', walkingMeters: walking, bookingStatus: 'not-required', openingStatus: 'verified', ...extra });
const train = (id, day, start, end, title, detail, cost) => event(id, day, start, end, title, 'train', detail, cost, 0, { openingStatus: 'not-applicable' });

const plans = [
  {
    id: 'dense', name: '经典多逛', tagline: '趁着周末，多留下一些风景。', mark: 'A', tint: 'coral', arrivalHomeAt: stamp('08', '18:20'),
    highlights: ['上海博物馆', '豫园', '外滩夜色'],
    events: [
      train('outbound', '07', '06:02', '06:52', '杭州东 → 上海虹桥', '高铁 · 模拟 G900', 87),
      event('metro-in', '07', '07:10', '08:00', '去往市区', 'transfer', '地铁换乘 · 预留步行', 8, 900),
      event('peoples-square', '07', '09:00', '09:40', '人民广场', 'visit', '城市漫步 · 40 分钟', 0, 800, { placeId: 'people-square', mustVisit: true }),
      event('museum', '07', '10:00', '11:30', '上海博物馆', 'visit', '预约状态请出发前核实', 0, 1100, { placeId: 'shanghai-museum', mustVisit: true, bookingStatus: 'unknown', openingStatus: 'unknown' }),
      event('lunch', '07', '11:45', '12:30', '午餐 · 云南南路', 'rest', '本帮小吃 · 费用估算', 68, 500),
      event('yu-garden', '07', '13:00', '14:30', '豫园与老城厢', 'visit', '园林与街区 · 可选项目', 40, 1900, { placeId: 'yu-garden' }),
      event('bund', '07', '15:00', '16:30', '外滩步行段', 'visit', '中山东一路 · 约 2.8 公里', 0, 2800, { placeId: 'bund-huangpu', mustVisit: true }),
      event('dinner', '07', '16:50', '18:00', '晚餐 · 黄浦区', 'rest', '餐费估算', 88, 700),
      event('hotel', '07', '19:00', '19:30', '办理住宿', 'rest', '普通房型 · 价格估算', 260, 300),
      event('breakfast', '08', '08:30', '09:00', '早餐', 'rest', '简餐估算', 28, 300),
      event('temple', '08', '09:30', '10:30', '静安寺周边', 'visit', '可选城市漫步', 50, 1300),
      event('west-bund', '08', '11:00', '13:00', '徐汇滨江', 'visit', '江畔散步 · 约 2.4 公里', 0, 2400, { placeId: 'xuhui-riverside' }),
      event('lunch-day2', '08', '13:10', '14:00', '午餐', 'rest', '餐费估算', 68, 300),
      event('station-transfer', '08', '14:30', '15:30', '前往虹桥站', 'transfer', '预留市内交通与进站', 35, 500),
      train('return', '08', '16:30', '17:16', '上海虹桥 → 杭州东', '高铁 · 模拟 G269', 87),
      event('home-transfer', '08', '17:30', '18:20', '车站 → 家', 'transfer', '末段交通需按实际住址确认', 30, 700, { openingStatus: 'not-applicable' }),
    ],
  },
  {
    id: 'gentle', name: '慢一点也好', tagline: '走少一点，把时间留给停下来。', mark: 'B', tint: 'sage', arrivalHomeAt: stamp('08', '18:20'),
    highlights: ['上海博物馆', '外滩', '咖啡休息'],
    events: [
      train('outbound', '07', '06:02', '06:52', '杭州东 → 上海虹桥', '高铁 · 模拟 G900', 87),
      event('metro-in', '07', '07:20', '08:15', '去往市区', 'transfer', '少换乘路线 · 留有余量', 8, 700),
      event('peoples-square', '07', '09:30', '10:10', '人民广场', 'visit', '城市漫步 · 40 分钟', 0, 500, { placeId: 'people-square', mustVisit: true }),
      event('museum', '07', '10:30', '12:00', '上海博物馆', 'visit', '预约状态请出发前核实', 0, 700, { placeId: 'shanghai-museum', mustVisit: true, bookingStatus: 'unknown', openingStatus: 'unknown' }),
      event('lunch', '07', '12:15', '13:15', '午餐 · 人民广场', 'rest', '留出用餐时间 · 费用估算', 78, 300),
      event('cafe', '07', '13:45', '14:45', '咖啡与休息', 'rest', '给周末留一点空白', 48, 400),
      event('bund', '07', '15:20', '16:30', '外滩江景', 'visit', '选定黄浦区观景段 · 短距离步行', 0, 900, { placeId: 'bund-huangpu', mustVisit: true }),
      event('dinner', '07', '17:00', '18:00', '晚餐 · 黄浦区', 'rest', '餐费估算', 98, 500),
      event('hotel', '07', '19:00', '19:30', '办理住宿', 'rest', '普通房型 · 价格估算', 260, 300),
      event('breakfast', '08', '09:00', '09:40', '早午餐', 'rest', '睡足再出门 · 费用估算', 48, 300),
      event('garden', '08', '10:20', '11:40', '豫园', 'visit', '只逛核心园林 · 开放安排待核实', 40, 900, { placeId: 'yu-garden', openingStatus: 'unknown' }),
      event('tea', '08', '12:00', '13:00', '茶歇与休息', 'rest', '附近坐一会儿', 58, 300),
      event('lunch-day2', '08', '13:10', '14:00', '午餐', 'rest', '餐费估算', 68, 300),
      event('station-transfer', '08', '14:30', '15:30', '前往虹桥站', 'transfer', '预留市内交通与进站', 35, 500),
      train('return', '08', '16:30', '17:16', '上海虹桥 → 杭州东', '高铁 · 模拟 G269', 87),
      event('home-transfer', '08', '17:30', '18:20', '车站 → 家', 'transfer', '末段交通需按实际住址确认', 30, 700, { openingStatus: 'not-applicable' }),
    ],
  },
];

const state = { selected: 'dense', version: 1, completed: new Set(), budgetCents: 100000, latestHomeAt: stamp('08', '20:00'), basePlans: new Map(plans.map(plan => [plan.id, structuredClone(plan)])), reasons: {} };
const money = cents => `¥${Math.round(cents / 100).toLocaleString('zh-CN')}`;
const time = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
const kindLabel = kind => ({ train: '高铁 · 模拟数据', transfer: '市内交通 · 估算', visit: '地点安排 · 待现场确认', rest: '餐饮 / 休息 · 费用估算' })[kind] ?? '活动';
const current = () => plans.find(plan => plan.id === state.selected);
const totalCost = plan => plan.events.reduce((sum, item) => sum + (Number.isInteger(item.costCents) ? item.costCents : 0), 0);
const totalWalking = plan => plan.events.reduce((sum, item) => sum + (Number.isFinite(item.walkingMeters) ? item.walkingMeters : 0), 0);
const validate = plan => validatePlan(plan, { budgetCents: state.budgetCents, mustVisitIds: ['people-square', 'shanghai-museum', 'bund-huangpu'], latestHomeAt: state.latestHomeAt });

function renderPlans() {
  document.querySelector('#plans').innerHTML = plans.map(plan => {
    const result = validate(plan);
    const selected = plan.id === state.selected;
    const belowBudget = totalCost(plan) <= state.budgetCents;
    return `<button class="plan-card ${plan.tint} ${selected ? 'selected' : ''}" data-plan="${plan.id}" aria-pressed="${selected}">
      <span class="card-top"><span class="plan-letter">${plan.mark}</span><span class="card-select">${selected ? '正在查看 ✓' : '查看方案 ↗'}</span></span>
      <span class="plan-title">${plan.name}</span><span class="plan-tagline">${plan.tagline}</span>
      <span class="metric-row"><span><strong>${money(totalCost(plan))}</strong><small>费用估算</small></span><span><strong>${(totalWalking(plan) / 1000).toFixed(1)} km</strong><small>预计步行</small></span><span><strong>${plan.events.filter(item => item.kind === 'visit').length}</strong><small>游览安排</small></span></span>
      <span class="plan-foot"><span>${plan.highlights.map(name => `<i>${name}</i>`).join('')}</span><span class="budget-state ${belowBudget && result.valid ? 'ok' : 'warn'}">${!belowBudget || !result.valid ? '需要调整' : result.feasible ? '信息齐备' : '硬约束通过 · 有待核实'}</span></span>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => {
    state.selected = button.dataset.plan;
    state.completed.clear(); state.version = 1; state.reasons = {};
    restoreSelectedPlan(); renderAll(); announce('已切换方案。你可以继续试试延误或体力变化后的调整。');
  }));
}

function restoreSelectedPlan() {
  const base = state.basePlans.get(state.selected);
  const index = plans.findIndex(plan => plan.id === state.selected);
  plans[index] = structuredClone(base);
}

function renderTimeline() {
  const plan = current();
  const events = [...plan.events].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const groups = ['07', '08'];
  document.querySelector('#timeline').innerHTML = groups.map(day => {
    const rows = events.filter(item => item.day === day).map(item => {
      const done = state.completed.has(item.id);
      const reason = state.reasons[item.id];
      return `<article class="timeline-row ${item.kind} ${done ? 'completed' : ''}"><div class="time-col"><strong>${time(item.startAt)}</strong><span>${time(item.endAt)}</span></div><div class="timeline-marker"><i></i></div><div class="event-body"><div class="event-top"><div><span class="event-kind">${kindLabel(item.kind)}</span><h3>${item.title}</h3><p>${item.detail}</p></div><div class="event-cost">${item.costCents ? money(item.costCents) : '免费'}<small>${item.costStatus === 'estimate' ? '估算' : '已知'}</small></div></div>${reason ? `<div class="change-reason">↳ ${reason}</div>` : ''}${item.walkingMeters > 0 ? `<div class="event-meta"><span>⌁ ${(item.walkingMeters / 1000).toFixed(1)} km 步行估算</span>${item.kind === 'visit' ? `<button class="done-button" data-done="${item.id}">${done ? '已完成 ✓' : '标记完成'}</button>` : ''}</div>` : item.kind === 'visit' ? `<div class="event-meta"><span>地点信息待出发前核实</span><button class="done-button" data-done="${item.id}">${done ? '已完成 ✓' : '标记完成'}</button></div>` : ''}</div></article>`;
    }).join('');
    const weekday = day === '07' ? '周六 · 11 月 7 日' : '周日 · 11 月 8 日';
    return `<section class="day-group"><div class="day-label"><span>0${day === '07' ? '1' : '2'}</span><div><strong>${weekday}</strong><small>${day === '07' ? '抵达 · 城市漫步 · 夜宿上海' : '留一点余地 · 准时回家'}</small></div></div><div class="day-events">${rows}</div></section>`;
  }).join('');
  document.querySelectorAll('[data-done]').forEach(button => button.addEventListener('click', () => {
    if (state.completed.has(button.dataset.done)) state.completed.delete(button.dataset.done); else state.completed.add(button.dataset.done);
    renderTimeline();
  }));
}

function renderSummary() {
  document.querySelector('#versionLabel').textContent = `方案版本 ${String(state.version).padStart(2, '0')}`;
  document.querySelector('#budgetDisplay').textContent = Number(state.budgetCents / 100).toLocaleString('zh-CN');
  document.querySelector('#homeDisplay').textContent = state.latestHomeAt.slice(11, 16);
  const result = validate(current());
  const note = document.querySelector('#revisionNote');
  if (state.version === 1) note.textContent = result.valid ? '硬约束检查通过；预约、营业时间和部分费用仍需核实。' : '当前样例有约束问题，请先调整条件。';
  else note.textContent = `第 ${state.version} 版已生成。保留 ${state.completed.size} 项已完成安排；${result.valid ? '硬约束检查通过。' : '仍有约束冲突，详见提示。'}`;
}

function renderAll() { renderPlans(); renderTimeline(); renderSummary(); }
function announce(message) { const note = document.querySelector('#revisionNote'); note.textContent = message; }
function cloneSelected() { return structuredClone(current()); }
function shiftMinutes(iso, minutes) {
  const date = new Date(Date.parse(iso) + minutes * 60000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function applyRevision(kind) {
  const previous = cloneSelected();
  const next = cloneSelected();
  const reasons = {};
  const done = state.completed;
  if (kind === 'delay') {
    const remove = next.events.find(item => item.id === 'yu-garden' || item.id === 'garden' || item.id === 'temple');
    if (remove && !done.has(remove.id)) {
      next.events = next.events.filter(item => item.id !== remove.id);
      reasons[remove.id] = '出发晚 1 小时，先保留必去点和返程';
    }
    for (const item of next.events) {
      if (item.day === '07' && item.kind !== 'train' && item.startAt >= stamp('07', '09:00') && !done.has(item.id)) {
        item.startAt = shiftMinutes(item.startAt, 60); item.endAt = shiftMinutes(item.endAt, 60);
        reasons[item.id] = '晚出发 1 小时后重排';
      }
    }
  } else {
    const visits = next.events.filter(item => item.kind === 'visit' && item.walkingMeters > 0 && !done.has(item.id)).sort((a, b) => b.walkingMeters - a.walkingMeters);
    const longWalk = visits.find(item => item.placeId === 'bund-huangpu') ?? visits[0];
    if (longWalk) {
      const index = next.events.indexOf(longWalk);
      const substitute = { ...longWalk, detail: '改为集中观景，减少路线步行并留出坐下休息的时间', walkingMeters: Math.min(longWalk.walkingMeters, 500), costCents: longWalk.costCents + 1800, costStatus: 'estimate' };
      next.events[index] = substitute;
      reasons[longWalk.id] = '体力下降，保留地点但缩短步行';
    }
  }
  next.changeReasons = reasons;
  const diff = comparePlans(previous, next, [...done]);
  const check = validate(next);
  if (!diff.valid || !check.valid) {
    announce(`没有直接应用这次调整：${[...diff.violations, ...check.errors].map(item => item.code).join('、')}。请放宽约束或检查已完成事项。`);
    return;
  }
  const index = plans.findIndex(plan => plan.id === state.selected);
  plans[index] = next;
  state.version += 1; state.reasons = reasons;
  renderAll();
  announce(kind === 'delay' ? '已删除一个可选点并顺延未完成安排；必去点和返程保留。' : '保留主要景点并缩短步行；费用略有增加。');
  document.querySelector('#timeline').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelector('#delayButton').addEventListener('click', () => applyRevision('delay'));
document.querySelector('#tiredButton').addEventListener('click', () => applyRevision('tired'));
const dialog = document.querySelector('#constraintDialog');
document.querySelector('#editConstraints').addEventListener('click', () => dialog.showModal());
document.querySelector('#saveConstraints').addEventListener('click', event => {
  const budget = Number(document.querySelector('#budgetInput').value);
  const home = document.querySelector('#homeInput').value;
  if (Number.isFinite(budget) && budget > 0) state.budgetCents = Math.round(budget * 100);
  if (home) state.latestHomeAt = stamp('08', home);
  renderAll();
  announce('约束已更新。各方案已重新检查预算与最晚到家时间。');
});
renderAll();
