import { z } from 'zod';
import type { ScoreFn } from '../core/rules.js';
import type { Domain } from '../core/scheduler.js';
import type { AgentQuestion, Decision, Option, Snapshot } from '../core/types.js';
import { CHARGER, dist, openOrders, PACK, type Plan, type Robot, type World, type Zone } from './world.js';

/** The plan the LLM controls. Every field is an enum or a bounded number that code acts on. */
export const PlanSchema = z.object({
  priority: z.enum(['throughput', 'due_dates', 'battery_safety']).describe('what robots optimise for'),
  // Plain number: some providers reject numeric bounds (and zod's .int() adds them). Code rounds and clamps (clampPlan).
  charge_below: z.number().describe('battery % below which robots are offered charging first, a whole number from 15 to 50'),
  zones: z.enum(['own_zone_only', 'help_anywhere']).describe('whether robots may take orders in the other zone'),
  instructions: z.array(z.object({ robot: z.string(), instruction: z.string() })).describe('0-2 instructions for named robots (code keeps the first 2)'),
});

export const PLANNER_INSTRUCTIONS = [
  'You are the shift planner for a warehouse robot fleet in two zones, north and south.',
  'Each robot decides its own next job several times a second with a fast decision model. You set the plan they follow.',
  'You control: priority (throughput, due_dates, battery_safety), charge_below (15-50), zones (own_zone_only or help_anywhere), and at most two instructions for named robots.',
  'Change the plan only when the report shows a clear problem or opportunity, and give a change time to work.',
  'reasoning: one sentence for the operations team, citing numbers from the report.',
].join('\n');

/** Code keeps the plan honest: whatever the planner returns, values stay in range. */
export function clampPlan(p: Plan): Plan {
  return { ...p, charge_below: Math.min(50, Math.max(15, Math.round(p.charge_below))), instructions: p.instructions.slice(0, 2) };
}

const planWords = (p: Plan) =>
  `priority ${p.priority.replace('_', ' ')}; charge when below ${p.charge_below}%; ${p.zones === 'help_anywhere' ? 'help in either zone' : 'stay in your own zone'}`;

const due = (s: number) => (s < 0 ? `${Math.round(-s)} s late` : `due in ${Math.round(s)} s`);
const where = (r: Robot) => `${r.zone} zone, ${Math.round(dist(r.pos, PACK))} m from the pack station`;

export interface Ctx { idle: string[]; open: number[] }

function candidates(w: World, r: Robot): Option[] {
  const out: Option[] = [];
  const zoneOk = (z: Zone) => w.plan.zones === 'help_anywhere' || z === r.zone;
  const current = r.task.kind === 'to_order' ? w.orders.find((o) => r.task.kind === 'to_order' && o.id === r.task.orderId) : undefined;
  const pool = openOrders(w).filter((o) => zoneOk(o.zone));
  if (current && !current.done) pool.unshift(current);
  const ranked = pool
    .map((o) => ({ o, d: dist(r.pos, o.pos), left: o.dueAt - w.t }))
    .sort((a, b) => a.d / 10 + a.left / 30 - (b.d / 10 + b.left / 30))
    .slice(0, 4);
  for (const { o, d, left } of ranked) {
    const trip = d + dist(o.pos, PACK);
    const batteryAfter = Math.round(r.battery - trip * 0.22);
    out.push({
      key: `pick_order_${o.id}`,
      text: `${o === current ? 'keep going to' : 'pick'} order ${o.id}: ${Math.round(d)} m away, ${o.items} items, ${due(left)}${o.zone !== r.zone ? ', other zone' : ''}${batteryAfter < 15 ? ', battery very low after' : ''}`,
      facts: { distance: Math.round(d), items: o.items, dueIn: Math.round(left), batteryAfter, otherZone: o.zone !== r.zone, current: o === current },
    });
  }
  const charging = w.robots.filter((x) => x.task.kind === 'charging' || x.task.kind === 'to_charger').length;
  if (r.battery < w.plan.charge_below + 25) {
    out.push({
      key: 'go_charge',
      text: `go and charge: battery ${Math.round(r.battery)}%, charger ${Math.round(dist(r.pos, CHARGER))} m away, ${charging} robots charging`,
      facts: { battery: Math.round(r.battery), chargerDistance: Math.round(dist(r.pos, CHARGER)), charging },
    });
  }
  if (r.task.kind === 'idle') out.push({ key: 'wait', text: 'wait here for a better order', facts: {} });
  return out;
}

function question(w: World, r: Robot): AgentQuestion {
  const instr = w.plan.instructions.find((i) => i.robot === r.id)?.instruction;
  const zoneOrders = openOrders(w).filter((o) => o.zone === r.zone).length;
  return {
    agentId: r.id,
    identity: `robot ${r.id}, ${r.trait}`,
    seeing: {
      battery: `${Math.round(r.battery)}%${r.battery < w.plan.charge_below ? ' (below the charge level)' : ''}`,
      where: where(r),
      backlog: `${openOrders(w).length} open orders, ${zoneOrders} in your zone`,
    },
    ...(instr ? { instruction: instr } : {}),
    question: r.task.kind === 'idle' ? 'You are free. Following the plan, what do you do next?' : 'You are on your way to an order. Keep going, or switch?',
    options: candidates(w, r),
    urgent: r.task.kind === 'idle',
  };
}

/** Rule baseline: the same options, simple weights. */
export const ruleScore: ScoreFn = (o, _a, s) => {
  const plan = (s.shared as { _plan: Plan })._plan;
  const f = o.facts;
  if (o.key === 'wait') return 0.05;
  if (o.key === 'go_charge') {
    const need = (plan.charge_below + 10 - Number(f.battery)) / 20;
    return need + (plan.priority === 'battery_safety' ? 0.4 : 0);
  }
  const urgency = Number(f.dueIn) < 20 ? (plan.priority === 'due_dates' ? 0.9 : 0.4) : 0;
  const batteryRisk = Number(f.batteryAfter) < 20 ? (plan.priority === 'battery_safety' ? -1 : -0.4) : 0;
  return 1 - Number(f.distance) / 40 + urgency + batteryRisk + (f.current ? 0.2 : 0) - (f.otherZone ? 0.15 : 0);
};

export const warehouseDomain: Domain<World, Ctx> = {
  time: (w) => w.t,
  tick: (w) => w.tick,
  snapshot(w, group): Snapshot<Ctx> {
    const robots = w.robots.filter((r) => r.zone === group && (r.task.kind === 'idle' || r.task.kind === 'to_order') && !r.pendingKey);
    return {
      group,
      tick: w.tick,
      context: { idle: robots.filter((r) => r.task.kind === 'idle').map((r) => r.id), open: openOrders(w).map((o) => o.id) },
      shared: {
        goal: 'ship every order before it is due, without any robot running flat',
        plan: planWords(w.plan),
        time: `${Math.round(w.t)} s into the shift`,
        // For code only: the rule engine reads the plan here. SystemOneEngine drops keys starting with _.
        _plan: w.plan,
      },
      agents: robots.map((r) => question(w, r)).filter((q) => q.options.length > 0),
    };
  },
  triggerKey(w, group) {
    const idle = w.robots.filter((r) => r.zone === group && r.task.kind === 'idle').map((r) => r.id).join(',');
    return `${idle}|${openOrders(w).length}`;
  },
  isFresh(w, _s, d: Decision) {
    const r = w.robots.find((x) => x.id === d.agentId);
    if (!r || !(r.task.kind === 'idle' || r.task.kind === 'to_order') || r.pendingKey) return false;
    if (d.key === 'wait') return r.task.kind === 'idle';
    if (d.key === 'go_charge') return true;
    const id = Number(d.key.replace('pick_order_', ''));
    const o = w.orders.find((x) => x.id === id);
    return !!o && !o.done && (!o.assignedTo || o.assignedTo === r.id);
  },
  apply(w, d) {
    const r = w.robots.find((x) => x.id === d.agentId)!;
    const current = r.task.kind === 'to_order' ? `pick_order_${r.task.orderId}` : null;
    if (d.key === current) return;
    // Low confidence is information: hesitate briefly before acting.
    r.hesitateUntil = w.t + (d.confidence < 0.5 ? 0.2 + 0.6 * (0.5 - d.confidence) : 0);
    r.pendingKey = d.key;
    // Reserve the order now so two robots don't chase it during the hesitation.
    const m = /^pick_order_(\d+)$/.exec(d.key);
    if (m) {
      const o = w.orders.find((x) => x.id === Number(m[1]));
      if (o && !o.assignedTo) o.assignedTo = r.id;
    }
    w.log.push({ t: w.t, robot: r.id, key: d.key, confidence: d.confidence });
  },
  urgent(w, group) {
    return w.robots.filter((r) => r.zone === group && r.task.kind === 'idle' && !r.pendingKey).map((r) => ({ agentId: r.id, since: r.freeSince }));
  },
};

/** The planner's report: numbers for a window, built by code. */
export function report(w: World, sinceT: number, trigger: string): Record<string, unknown> {
  const done = w.orders.filter((o) => o.done && (o.doneAt ?? 0) >= sinceT);
  const late = done.filter((o) => (o.doneAt ?? 0) > o.dueAt).length;
  const open = openOrders(w);
  const overdue = w.orders.filter((o) => !o.done && o.dueAt < w.t).length;
  const decisions = w.log.filter((l) => l.t >= sinceT);
  const mix = (k: string) => decisions.filter((l) => l.key.startsWith(k)).length;
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
  const byZone = (z: Zone) => ({
    open_orders: open.filter((o) => o.zone === z).length,
    robots_idle: w.robots.filter((r) => r.zone === z && r.task.kind === 'idle').length,
    robots_charging: w.robots.filter((r) => r.zone === z && (r.task.kind === 'charging' || r.task.kind === 'to_charger')).length,
    lowest_battery: `${Math.round(Math.min(...w.robots.filter((r) => r.zone === z).map((r) => r.battery)))}%`,
  });
  return {
    why_you_are_asked: trigger,
    time: `${Math.round(w.t)} s`,
    window: `last ${Math.round(w.t - sinceT)} s`,
    current_plan: planWords(w.plan),
    in_window: {
      orders_completed: done.length,
      completed_late: `${late} (${pct(late, done.length)})`,
      average_wait: done.length ? `${Math.round(done.reduce((s, o) => s + ((o.doneAt ?? 0) - o.createdAt), 0) / done.length)} s` : 'n/a',
      robot_decisions: `${decisions.length}: pick ${pct(mix('pick'), decisions.length)}, charge ${pct(mix('go_charge'), decisions.length)}, wait ${pct(mix('wait'), decisions.length)}; ${pct(decisions.filter((l) => l.confidence < 0.5).length, decisions.length)} hesitant`,
    },
    now: { open_orders: open.length, overdue_orders: overdue, north: byZone('north'), south: byZone('south') },
    robots: Object.fromEntries(w.robots.map((r) => [r.id, `${r.zone}, ${r.trait}, battery ${Math.round(r.battery)}%, ${r.task.kind.replace('_', ' ')}`])),
  };
}
