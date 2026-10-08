import type { Rng } from '../core/rng.js';

/** A small warehouse: robots pick orders from shelves, take them to the pack station, and recharge. Code owns all of this. */

export const W = 48;
export const H = 24;
export const PACK = { x: 2, y: H / 2 };
export const CHARGER = { x: W - 2, y: H / 2 };
const SPEED = 1.6; // m/s
const DRAIN_MOVING = 0.35; // % per second
const CHARGE_RATE = 4; // % per second
const PICK_S_PER_ITEM = 1.5;

export type Zone = 'north' | 'south';
export interface Vec { x: number; y: number }

export interface Order {
  id: number;
  pos: Vec;
  zone: Zone;
  items: number;
  createdAt: number;
  dueAt: number;
  assignedTo: string | null;
  done: boolean;
  doneAt?: number;
}

export type Task =
  | { kind: 'idle' }
  | { kind: 'to_order'; orderId: number }
  | { kind: 'picking'; orderId: number; until: number }
  | { kind: 'to_pack'; orderId: number }
  | { kind: 'to_charger' }
  | { kind: 'charging' };

export interface Robot {
  id: string;
  zone: Zone;
  trait: string;
  pos: Vec;
  battery: number;
  task: Task;
  /** When the robot last became free to choose (urgent until it gets a decision). */
  freeSince: number;
  /** Last decision's confidence, and a short pause if it was low (visible hesitation). */
  hesitateUntil: number;
  pendingKey: string | null;
}

export interface Plan {
  priority: 'throughput' | 'due_dates' | 'battery_safety';
  charge_below: number;
  zones: 'own_zone_only' | 'help_anywhere';
  instructions: { robot: string; instruction: string }[];
}

export interface Stats { completed: number; late: number; waitS: number[]; lowBatteryEvents: number; idleTicks: number; busyTicks: number }

export interface World {
  t: number;
  tick: number;
  rng: Rng;
  robots: Robot[];
  orders: Order[];
  nextOrderId: number;
  plan: Plan;
  stats: Stats;
  /** Orders per second; a surge mid-run gives the planner something to react to. */
  orderRate: (t: number) => number;
  log: { t: number; robot: string; key: string; confidence: number }[];
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const zoneOf = (p: Vec): Zone => (p.y < H / 2 ? 'north' : 'south');

const TRAITS = ['a fast picker with a small battery', 'a steady all-rounder', 'a heavy lifter, slower but efficient', 'a careful robot that dislikes long trips'];

export function newWorld(rng: Rng, robotsPerZone = 6): World {
  const robots: Robot[] = [];
  for (const zone of ['north', 'south'] as Zone[]) {
    for (let i = 0; i < robotsPerZone; i++) {
      const id = `${zone === 'north' ? 'N' : 'S'}${i + 1}`;
      robots.push({
        id, zone, trait: TRAITS[(i + (zone === 'south' ? 2 : 0)) % TRAITS.length],
        pos: { x: 6 + rng.next() * (W - 12), y: zone === 'north' ? 2 + rng.next() * (H / 2 - 4) : H / 2 + 2 + rng.next() * (H / 2 - 4) },
        battery: 45 + rng.next() * 50, task: { kind: 'idle' }, freeSince: 0, hesitateUntil: 0, pendingKey: null,
      });
    }
  }
  return {
    t: 0, tick: 0, rng, robots, orders: [], nextOrderId: 1,
    plan: { priority: 'throughput', charge_below: 20, zones: 'own_zone_only', instructions: [] },
    stats: { completed: 0, late: 0, waitS: [], lowBatteryEvents: 0, idleTicks: 0, busyTicks: 0 },
    // Busier in the south from 40 s to 100 s: zones should help each other.
    orderRate: (t) => 0.22 + (t > 40 && t < 100 ? 0.33 : 0),
    log: [],
  };
}

export function openOrders(w: World): Order[] {
  return w.orders.filter((o) => !o.done && !o.assignedTo);
}

function spawnOrders(w: World, dt: number): void {
  if (w.rng.next() < w.orderRate(w.t) * dt) {
    const surgeSouth = w.t > 40 && w.t < 100 && w.rng.next() < 0.75;
    const y = surgeSouth ? H / 2 + 1 + w.rng.next() * (H / 2 - 2) : 1 + w.rng.next() * (H - 2);
    const pos = { x: 8 + w.rng.next() * (W - 14), y };
    const items = 1 + w.rng.int(4);
    w.orders.push({ id: w.nextOrderId++, pos, zone: zoneOf(pos), items, createdAt: w.t, dueAt: w.t + 35 + w.rng.int(30), assignedTo: null, done: false });
  }
}

function moveToward(r: Robot, target: Vec, dt: number): boolean {
  const d = dist(r.pos, target);
  const step = SPEED * dt;
  r.battery = Math.max(0, r.battery - DRAIN_MOVING * dt);
  if (d <= step) {
    r.pos = { ...target };
    return true;
  }
  r.pos = { x: r.pos.x + ((target.x - r.pos.x) / d) * step, y: r.pos.y + ((target.y - r.pos.y) / d) * step };
  return false;
}

function free(w: World, r: Robot): void {
  r.task = { kind: 'idle' };
  r.freeSince = w.t;
}

/** Turn a chosen option key into a task. Code validates again; an invalid key is ignored. */
export function startTask(w: World, r: Robot, key: string): void {
  if (key === 'wait') return;
  if (key === 'go_charge') {
    if (r.task.kind === 'to_order') releaseOrder(w, r);
    r.task = { kind: 'to_charger' };
    return;
  }
  const m = /^pick_order_(\d+)$/.exec(key);
  if (!m) return;
  const o = w.orders.find((x) => x.id === Number(m[1]));
  if (!o || o.done || (o.assignedTo && o.assignedTo !== r.id)) return;
  if (r.task.kind === 'to_order' && r.task.orderId !== o.id) releaseOrder(w, r);
  o.assignedTo = r.id;
  r.task = { kind: 'to_order', orderId: o.id };
}

function releaseOrder(w: World, r: Robot): void {
  if (r.task.kind !== 'to_order') return;
  const id = r.task.orderId;
  const o = w.orders.find((x) => x.id === id);
  if (o && o.assignedTo === r.id) o.assignedTo = null;
}

export function step(w: World, dt: number): void {
  w.t += dt;
  w.tick++;
  spawnOrders(w, dt);
  for (const r of w.robots) {
    if (r.pendingKey && w.t >= r.hesitateUntil) {
      startTask(w, r, r.pendingKey);
      r.pendingKey = null;
    }
    // Code-level safety: below 8% a robot goes to charge whatever anyone decided.
    if (r.battery < 8 && r.task.kind !== 'to_charger' && r.task.kind !== 'charging' && r.task.kind !== 'to_pack' && r.task.kind !== 'picking') {
      releaseOrder(w, r);
      r.task = { kind: 'to_charger' };
      w.stats.lowBatteryEvents++;
    }
    const t = r.task;
    if (t.kind === 'idle') w.stats.idleTicks++;
    else w.stats.busyTicks++;
    if (t.kind === 'to_order') {
      const o = w.orders.find((x) => x.id === t.orderId);
      if (!o || o.done) free(w, r);
      else if (moveToward(r, o.pos, dt)) r.task = { kind: 'picking', orderId: o.id, until: w.t + o.items * PICK_S_PER_ITEM };
    } else if (t.kind === 'picking') {
      if (w.t >= t.until) r.task = { kind: 'to_pack', orderId: t.orderId };
    } else if (t.kind === 'to_pack') {
      if (moveToward(r, PACK, dt)) {
        const o = w.orders.find((x) => x.id === t.orderId)!;
        o.done = true;
        o.doneAt = w.t;
        w.stats.completed++;
        w.stats.waitS.push(w.t - o.createdAt);
        if (w.t > o.dueAt) w.stats.late++;
        free(w, r);
      }
    } else if (t.kind === 'to_charger') {
      if (moveToward(r, CHARGER, dt)) r.task = { kind: 'charging' };
    } else if (t.kind === 'charging') {
      r.battery = Math.min(100, r.battery + CHARGE_RATE * dt);
      if (r.battery >= 95) free(w, r);
    }
  }
}
