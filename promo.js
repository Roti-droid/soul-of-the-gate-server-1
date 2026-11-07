// promo.js — «Акция»: one discounted product at a time, rotating every PROMO_LEN seconds (deterministic from the date).
//
// The discount is real: the bot sends the invoice with the promo price (payload "q:<product>:<slot>"), pre_checkout
// accepts it only while that slot is the current one, the reward is the normal product's reward. The game asks
// GET /api/v2/promo for the current offer (title, price, old price, ends) and shows the popup with a timer.
// env.PROMO_OFF = "1" switches promos off (bot menu + /api/v2/promo).

const DAY = 86400;
export const PROMO_EPOCH = Date.UTC(2026, 10, 1) / 1000; // 2026-11-01 00:00 UTC
export const PROMO_LEN = 3 * DAY;
// product id from donate.js PRODUCTS -> promo price in ⭐ (about -30 %). starter / monthly are never discounted.
export const PROMO_ROTATION = [
  { id: "sack", stars: 69 },
  { id: "collector", stars: 139 },
  { id: "pass", stars: 49 },
  { id: "dark_chest", stars: 84 },
  { id: "royal", stars: 175 },
  { id: "wanderer", stars: 125 },
];

const now = () => Math.floor(Date.now() / 1000);

export function promoSlot(t = now()) {
  return Math.floor((t - PROMO_EPOCH) / PROMO_LEN);
}

// -> {slot, id, stars, starts, ends} | null
export function promoAt(slot) {
  if (!Number.isInteger(slot) || slot < 0) return null;
  const p = PROMO_ROTATION[slot % PROMO_ROTATION.length];
  return { slot, id: p.id, stars: p.stars, starts: PROMO_EPOCH + slot * PROMO_LEN, ends: PROMO_EPOCH + (slot + 1) * PROMO_LEN };
}

export function promosOn(env) {
  return !(env && String(env.PROMO_OFF || "") === "1");
}

export function currentPromo(env, t = now()) {
  if (!promosOn(env)) return null;
  return promoAt(promoSlot(t));
}

// "q:sack:3" -> {id, slot} | null
export function parsePromoPayload(payload) {
  const m = /^q:([a-z0-9_]{1,32}):(\d{1,6})$/.exec(payload || "");
  return m ? { id: m[1], slot: Number(m[2]) } : null;
}
