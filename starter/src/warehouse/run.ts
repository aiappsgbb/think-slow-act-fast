/**
 * Run the warehouse example headless.
 *
 *   npm start                                   # rules only, no network: the baseline
 *   DECISION_MODEL=microsoft DECISION_ENDPOINT=https://<account>.services.ai.azure.com DECISION_DEPLOYMENT=decision-1 npm start
 *   PLANNER=foundry FOUNDRY_ENDPOINT=https://<resource>.cognitiveservices.azure.com FOUNDRY_MODEL=<deployment> npm start
 *   PLANNER=copilot npm start                   # planner on the signed-in GitHub Copilot user's models
 *
 * DURATION (s, default 120), SEED (default 7).
 */
import { CopilotPlanner } from '../core/copilot-planner.js';
import { PlannerLoop, type PlannerBackend } from '../core/planner.js';
import { Rng } from '../core/rng.js';
import { RuleEngine } from '../core/rules.js';
import { DEFAULTS, RequestBudget, Scheduler } from '../core/scheduler.js';
import { SystemOneEngine } from '../core/systemone.js';
import type { DecisionEngine } from '../core/types.js';
import { clampPlan, PLANNER_INSTRUCTIONS, PlanSchema, report, ruleScore, warehouseDomain } from './domain.js';
import { newWorld, openOrders, step, type Plan } from './world.js';

const env = process.env;
const SEED = Number(env.SEED ?? 7);
const DURATION = Number(env.DURATION ?? 120);
const DT = 0.1;

const world = newWorld(new Rng(SEED));
const rules = new RuleEngine(ruleScore, new Rng(SEED + 1));

function decisionModel(): { engine: DecisionEngine; maxInFlight: number; price: number; requestBudget?: RequestBudget } {
  const which = env.DECISION_MODEL ?? 'rules';
  if (which === 'microsoft') {
    if (!(env.DECISION_ENDPOINT && env.DECISION_DEPLOYMENT)) throw new Error('DECISION_MODEL=microsoft needs DECISION_ENDPOINT and DECISION_DEPLOYMENT');
    const requestBudget = new RequestBudget(Number(env.DECISION_RPM ?? 60));
    const e = new SystemOneEngine({
      baseUrl: env.DECISION_ENDPOINT,
      model: env.DECISION_DEPLOYMENT,
      apiKey: env.DECISION_API_KEY,
      maxOptions: 8,
      timeoutMs: 5000,
    }, new Rng(SEED + 2));
    return { engine: e, maxInFlight: 1, price: e.pricePerInputToken, requestBudget };
  }
  if (which !== 'rules') throw new Error(`Unsupported DECISION_MODEL: ${which}; use rules or microsoft`);
  return { engine: rules, maxInFlight: 2, price: 0 };
}

function plannerBackend(): (PlannerBackend<Plan> & { stop?: () => Promise<void> }) | null {
  const which = env.PLANNER ?? 'off';
  if (which === 'off') return null;
  if (which === 'foundry' && !(env.FOUNDRY_ENDPOINT && env.FOUNDRY_MODEL)) throw new Error('PLANNER=foundry needs FOUNDRY_ENDPOINT and FOUNDRY_MODEL');
  return new CopilotPlanner({
    planSchema: PlanSchema,
    instructions: PLANNER_INSTRUCTIONS,
    model: which === 'foundry' ? env.FOUNDRY_MODEL! : (env.COPILOT_MODEL ?? 'gpt-5'),
    foundryEndpoint: which === 'foundry' ? env.FOUNDRY_ENDPOINT : undefined,
  });
}

const dm = decisionModel();
const schedulers = (['north', 'south'] as const).map(
  (zone) => new Scheduler(zone, warehouseDomain, dm.engine, rules, { ...DEFAULTS, maxInFlight: dm.maxInFlight, requestBudget: dm.requestBudget }),
);
const backend = plannerBackend();
let windowStart = 0;
const planner = new PlannerLoop<Plan>(
  world.plan,
  backend,
  (trigger) => report(world, Math.max(0, Math.min(windowStart, world.t - 30)), trigger),
  // Regular review every 15 s of shift time; after a change, give it 30 s.
  { intervalS: 15, cooldownS: 30 },
  (c) => {
    world.plan = clampPlan(c.plan);
    windowStart = world.t;
    console.log(`\n  PLAN CHANGE at ${world.t.toFixed(0)} s (${backend?.name}): ${c.reasoning}\n  -> ${JSON.stringify(c.plan)}\n`);
  },
);

console.log(`decision model: ${dm.engine.name} · planner: ${backend?.name ?? 'off'} · ${world.robots.length} robots · ${DURATION} s\n`);
if (dm.requestBudget) console.log(`Foundry budget: ${env.DECISION_RPM ?? 60} RPM shared across both zones; urgent deadline decisions use rules and are counted as fallbacks.\n`);
let lastLine = 0;
let overdueAlarm = false;
const startedAt = performance.now();
let applied0 = 0;

const timer = setInterval(() => {
  step(world, DT);
  for (const s of schedulers) s.tick(world);
  // Event trigger for the slow loop: overdue orders piling up.
  const overdue = world.orders.filter((o) => !o.done && o.dueAt < world.t).length;
  if (overdue >= 4 && !overdueAlarm) planner.trigger(`${overdue} orders are overdue`);
  overdueAlarm = overdue >= 4;
  planner.tick(world.t);

  if (world.t - lastLine >= 5 - 1e-9) {
    lastLine = world.t;
    const m = schedulers.map((s) => s.metrics);
    const applied = m.reduce((a, x) => a + x.applied, 0);
    const lat = m.flatMap((x) => x.latencies).sort((a, b) => a - b);
    const p50 = lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : 0;
    const stale = m.reduce((a, x) => a + x.stale, 0);
    const fb = m.reduce((a, x) => a + x.fallbacks, 0);
    const errs = m.reduce((a, x) => a + x.errors, 0);
    const throttled = m.reduce((a, x) => a + x.throttled, 0);
    const requests = m.reduce((a, x) => a + x.requests, 0);
    const responses = m.reduce((a, x) => a + x.responses, 0);
    const cost = m.reduce((a, x) => a + x.inputTokens, 0) * dm.price;
    console.log(
      `t=${world.t.toFixed(0).padStart(3)}s  open ${String(openOrders(world).length).padStart(2)}  done ${String(world.stats.completed).padStart(3)}  late ${String(world.stats.late).padStart(2)}` +
        `  | ${((applied - applied0) / 5).toFixed(1)} ${dm.engine === rules ? 'rule' : 'model'} dec/s  p50 ${lat.length ? `${p50} ms` : 'n/a'}  stale ${applied + stale ? Math.round((100 * stale) / (applied + stale)) : 0}%  fallbacks ${fb}  errors ${errs}` +
        `  requests ${requests} responses ${responses} quota-deferred ${throttled}` +
        `  | planner ${planner.state.status}, ${planner.state.changes} changes  | $${cost.toFixed(4)}`,
    );
    applied0 = applied;
  }

  if (world.t >= DURATION) {
    clearInterval(timer);
    const secs = (performance.now() - startedAt) / 1000;
    const m = schedulers.map((s) => s.metrics);
    const applied = m.reduce((a, x) => a + x.applied, 0);
    console.log(
      `\nDone in ${secs.toFixed(0)} s: ${world.stats.completed} orders shipped, ${world.stats.late} late, ${openOrders(world).length} open, ` +
        `${world.stats.lowBatteryEvents} forced recharges. ${applied} decisions applied (${(applied / secs).toFixed(1)}/s), ` +
        `planner: ${planner.state.reviews} reviews, ${planner.state.changes} changes.`,
    );
    if (m.some((x) => x.lastError)) console.log('last decision-model error:', m.find((x) => x.lastError)?.lastError);
    if (planner.state.lastError) console.log('last planner error:', planner.state.lastError);
    void backend?.stop?.().then(() => process.exit(0));
    if (!backend?.stop) process.exit(0);
  }
}, DT * 1000);
