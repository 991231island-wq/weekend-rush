import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(selector, values = {}) { this.selector = selector; this.listeners = {}; this.value = values.value ?? ''; this.innerHTML = ''; this.textContent = ''; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click(name = 'click', event = {}) { this.listeners[name]?.(event); }
  showModal() { this.opened = true; }
  scrollIntoView() { this.scrolled = true; }
}

const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, new FakeElement(selector, selector === '#budgetInput' ? { value: '1000' } : selector === '#homeInput' ? { value: '20:00' } : {}));
  return elements.get(selector);
};
globalThis.document = {
  querySelector: element,
  querySelectorAll(selector) {
    const html = selector === '[data-plan]' ? element('#plans').innerHTML : selector === '[data-done]' ? element('#timeline').innerHTML : '';
    const attr = selector === '[data-plan]' ? 'data-plan' : 'data-done';
    return [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map(match => {
      const result = new FakeElement(`${selector}:${match[1]}`);
      result.dataset = { [attr.slice(5, -1)]: match[1] };
      return result;
    });
  },
};

await import('../demo/demo.js');

test('renders both plans and applies a delay revision without dropping the must-see route', () => {
  assert.equal((element('#plans').innerHTML.match(/class="plan-card/g) ?? []).length, 2);
  element('#delayButton').click();
  assert.match(element('#versionLabel').textContent, /02/);
  assert.match(element('#revisionNote').textContent, /删除一个可选点/);
  assert.doesNotMatch(element('#timeline').innerHTML, /豫园与老城厢/);
  assert.match(element('#timeline').innerHTML, /上海博物馆/);
  assert.match(element('#timeline').innerHTML, /外滩步行段/);
  assert.match(element('#timeline').innerHTML, /10:00/);
});

test('revises pace by reducing walking and updates the plan version', () => {
  element('#tiredButton').click();
  assert.match(element('#revisionNote').textContent, /缩短步行/);
  assert.match(element('#versionLabel').textContent, /03/);
  assert.match(element('#timeline').innerHTML, /减少路线步行/);
  assert.match(element('#plans').innerHTML, /费用估算/);
});

test('allows budget and arrive-home constraints to be edited and redisplayed', () => {
  element('#editConstraints').click();
  assert.equal(element('#constraintDialog').opened, true);
  element('#budgetInput').value = '700';
  element('#homeInput').value = '18:30';
  element('#saveConstraints').click('click', {});
  assert.equal(element('#budgetDisplay').textContent, '700');
  assert.equal(element('#homeDisplay').textContent, '18:30');
  assert.match(element('#plans').innerHTML, /需要调整/);
});
