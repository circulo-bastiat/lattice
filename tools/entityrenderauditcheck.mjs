#!/usr/bin/env node
// entityrenderauditcheck.mjs -- #11487: drives 07j_entityrender.js rules the audit listed as unchecked, off .decomp:
//   EnchantingTableBlockEntity.tick (via EnchantingTableBlockEntityRenderer's book), EndPortalBlockEntity.shouldDrawSide /
//   EndPortalBlockEntityRenderer, EndGatewayBlockEntityRenderer -> BeaconBlockEntityRenderer.renderBeam (radii, heights),
//   ChestBlockEntityRenderer / TexturedRenderLayers.getChestTexture (Christmas 24-26 Dec), RenderPhase glint texturing
//   (ARMOR_ENTITY_GLINT_TEXTURING / ENTITY_GLINT_TEXTURING), ModelUtil.interpolateAngle (wrap), BookModel.setPageAngles.
// ANTI-VACUITY: each rule is broken by patching it; the assertion must then fail.
import { readFileSync, readdirSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) { breaks++; console.log('   ✓ ' + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
console.log('entityrenderauditcheck -- #11487');
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07zzi_ghast.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
}
const ER = M.EntityRender, BE = M.BlockEntities;

// --- EnchantingTableBlockEntity.tick
const mk = () => ({ x: 0, z: 0, nextPageTurningSpeed: 0.5, pageTurningSpeed: 0, fl2: 0, fl3: 0, fl4: 0, fl7: 0, fl9: 0,
  nextPageAngle: 0, pageAngle: 0, bticks: 0, bookRnd: { nextInt: () => 1 } });
{
  const e = mk(); ER.bookTick(e, { x: 0.5, z: 5.5 });
  ok(near(e.fl2, Math.atan2(5, 0)) && near(e.nextPageTurningSpeed, 0.6), 'player near: book faces the player, opens +0.1');
  const f = mk(); ER.bookTick(f, null);
  ok(near(f.fl2, 0.02) && near(f.nextPageTurningSpeed, 0.4), 'no player: idle spin +0.02, closes -0.1');
  const g = mk(); g.nextPageTurningSpeed = 0; for (let i = 0; i < 3; i++) ER.bookTick(g, null);
  ok(g.nextPageTurningSpeed === 0, 'open amount clamps at 0'); const h = mk(); for (let i = 0; i < 20; i++) ER.bookTick(h, { x: 3, z: 0 });
  ok(h.nextPageTurningSpeed === 1 && h.bticks === 20, 'open amount clamps at 1; one tick counter step each');
  okAv((() => { const s = ER.bookTick; ER.bookTick = (q) => { q.bticks++; }; const q = mk(); ER.bookTick(q, null); ER.bookTick = s; return !near(q.fl2, 0.02); })(), 'a book that never idles is caught');
}
// --- BookModel.setPageAngles
{
  const A = ER.bookAnim(0, 0, 0, 1, 0, [0, 0, 0]);
  ok(A.sleepPose && A.sleepPose.R === 0, 'book anim carries the whole-model pose');
  const lid = A.deltaFor('left_lid'), lid0 = ER.bookAnim(0, 0, 0, 0, 0, [0, 0, 0]).deltaFor('left_lid');
  ok(lid && lid0 && lid.ry !== lid0.ry, 'open and closed books pose the lid differently');
  ok(A.deltaFor('no_such_part') === null, 'unknown part: no delta');
}
// --- End portal / gateway
{
  const P = ER.endPortalQuads(false).map((q) => q.face).sort().join(',');
  ok(P === 'down,up', 'portal draws only up/down (' + P + ')');
  const up = ER.endPortalQuads(false).find((q) => q.face === 'up');
  ok(up.v.every((v) => v[1] === 0.75), 'portal top at y=0.75');
  ok(ER.endPortalQuads(false).find((q) => q.face === 'down').v.every((v) => v[1] === 0.375), 'portal bottom at y=0.375');
  ok(ER.endPortalQuads(true).length === 6, 'gateway draws all six sides');
  ok(ER.endPortalQuads(true, (f) => f !== 'up').length === 5, 'a culled side is skipped');
  ok(ER.END_PORTAL.layers === 16, 'the portal shader has 16 layers');
  okAv(ER.endPortalQuads(false).length !== 6, 'a portal with all sides would be caught');
  const e = { age: 0, teleportCooldown: 0 };
  const b0 = ER.gatewayBeam(e, 0, 0, 256), b1 = ER.gatewayBeam({ age: 100, teleportCooldown: 0 }, 0, 0, 256);
  ok(b0 && b0.height === 0 && b0.color === 13061821 && b0.innerR === 0.15 && b0.outerR === 0.175, 'fresh gateway: magenta, radii 0.15/0.175');
  ok(b1 && b1.scale === 1 && b1.height === 512 && b1.y0 === -256, 'half-age gateway beam peaks to the world top');
  ok(ER.gatewayBeam({ age: 500, teleportCooldown: 0 }, 0, 0, 256) === null, 'old, idle gateway: no beam');
  const c = ER.gatewayBeam({ age: 500, teleportCooldown: 40 }, 0, 0, 256);
  ok(c && c.color === 8991416, 'cooldown: purple beam');
  ok(ER.gatewayBeam({ age: 500, teleportCooldown: 20 }, 0, 0, 256).height === 100, 'cooldown beam reaches 50 at its peak');
  ok(near(ER.gatewayBeam(e, 0.5, -1, 256).time, 39.5), 'beam time wraps mod 40 for negative time');
  okAv((() => { const s = BE.gatewayRecentlyGenerated; BE.gatewayRecentlyGenerated = () => false; const r = ER.gatewayBeam({ age: 0, teleportCooldown: 0 }, 0, 0, 256); BE.gatewayRecentlyGenerated = s; return r === null; })(), 'a gateway that is never fresh loses its magenta beam');
}
// --- Chest christmas (TexturedRenderLayers.getChestTexture)
{
  ok(ER.isChristmasDate(new Date(2026, 11, 24)) && ER.isChristmasDate(new Date(2026, 11, 26)), '24 and 26 Dec are Christmas');
  ok(!ER.isChristmasDate(new Date(2026, 11, 23)) && !ER.isChristmasDate(new Date(2026, 11, 27)) && !ER.isChristmasDate(new Date(2026, 5, 25)), '23/27 Dec and June are not');
  ER.christmasOverride = true; ok(ER.chestChristmas() === true, 'override on'); ER.christmasOverride = false; ok(ER.chestChristmas() === false, 'override off'); ER.christmasOverride = null;
  okAv(!(() => { const s = ER.isChristmasDate; ER.isChristmasDate = () => true; const r = ER.isChristmasDate(new Date(2026, 5, 1)); ER.isChristmasDate = s; return !r; })(), 'an always-Christmas rule is caught by the June date');
}
// --- RenderPhase glint
{
  ok(ER.GLINT_ARMOR_SCALE === 0.16 && ER.GLINT_ITEM_SCALE === 8, 'glint scales 0.16 / 8');
  const us = [0, 64, 64, 0], vs = [0, 0, 32, 32]; ER.glintUV(us, vs, 8);
  const c = Math.cos(Math.PI / 18), s = Math.sin(Math.PI / 18);
  ok(near(us[1], 8 * c * 16) && near(vs[1], 8 * s * 16), 'glint UV: scale then rotZ(10deg), x16 tile units');
  ok(near(us[0], 0) && near(vs[0], 0), 'origin stays put');
  okAv((() => { const a = [64], b = [0]; ER.glintUV(a, b, 0.16); const a2 = [64], b2 = [0]; ER.glintUV(a2, b2, 8); return !near(a[0], a2[0]); })(), 'scale matters: armour and item glints differ');
}
// --- Mob renderers: scale() literals read from .decomp, creeper swell
{
  const rd = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + n + '.java', 'utf8');
  const lit = (n) => { const m = /\.scale\(\s*(?:\$\$\d,\s*)?(?:\$\$\d\s*=\s*)?([0-9.]+)F/.exec(rd(n)); return m ? parseFloat(m[1]) : null; };
  const pairs = [['bat', 'BatEntityRenderer'], ['cat', 'CatEntityRenderer'], ['cave_spider', 'CaveSpiderEntityRenderer'], ['polar_bear', 'PolarBearEntityRenderer'], ['vex', 'VexEntityRenderer'], ['witch', 'WitchEntityRenderer'], ['wither_skeleton', 'WitherSkeletonEntityRenderer'], ['husk', 'HuskEntityRenderer']];
  let n = 0;
  for (const [k, cls] of pairs) { let v = null; try { v = lit(cls); } catch (e) {} if (v === null) continue; n++; ok(near(ER.RENDER_SCALE[k], v), cls + ' scale ' + v + ' (got ' + ER.RENDER_SCALE[k] + ')'); }
  ok(n >= 5, 'at least 5 renderer scale literals compared (' + n + ')');
  const sf = M.Creeper && M.Creeper.swellFraction; M.Creeper = M.Creeper || {};
  M.Creeper.swellFraction = (e) => e.f;
  const cr = (f) => ER.creeperScale({ type: 'creeper', dead: false, f }, 0);
  const a = cr(0.5), b = cr(1);
  const f4 = 1 + Math.sin(100) * 0.01;
  ok(a && near(a.sxz, (1 + 0.0625 * 0.4) * (1 + Math.sin(50) * 0.5 * 0.01)), 'creeper swell at 0.5: quartic ramp');
  ok(b && near(b.sxz, 1.4 * f4) && near(b.sy, 1.1 / f4) && b.white === 0, 'creeper swell at 1: 1.4*f4, 1.1/f4, tenth 10 is even: no flash');
  ok(near(cr(0.15).white, 7 / 15), 'odd tenth: white at clamp(f,.5,1) quantised to 15ths');
  ok(cr(0.05).white === 0, 'even tenth: no flash');
  okAv((() => { const s = ER.RENDER_SCALE.bat; ER.RENDER_SCALE.bat = 1; const r = near(ER.RENDER_SCALE.bat, lit('BatEntityRenderer')); ER.RENDER_SCALE.bat = s; return !r; })(), 'a wrong bat scale is caught');
  okAv(!near(1.3 * f4, b.sxz), 'a wrong swell peak (1.3) is caught');
  M.Creeper.swellFraction = sf;
}
// --- Bell / shulker / banner animation (constants read from .decomp BE renderers)
{
  const src = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/block/entity/' + n + '.java', 'utf8');
  ok(/sin\(\$\$6 \/ \(float\) Math\.PI\) \/ \(4\.0F \+ \$\$6 \/ 3\.0F\)/.test(src('BellBlockEntityRenderer')), 'decomp bell formula as ported');
  const t = 5.5, s = Math.sin(t / Math.PI) / (4 + t / 3);
  const bn = ER.bellAnim({ ringing: true, ticks: 5, lastSideHit: 'north' }, 0.5).deltaFor('bell_body');
  ok(near(bn.rx, -s) && bn.rz === 0, 'bell north: pitch -s');
  ok(near(ER.bellAnim({ ringing: true, ticks: 5, lastSideHit: 'south' }, 0.5).deltaFor('bell_body').rx, s), 'bell south: pitch +s');
  ok(near(ER.bellAnim({ ringing: true, ticks: 5, lastSideHit: 'east' }, 0.5).deltaFor('bell_body').rz, -s), 'bell east: roll -s');
  ok(near(ER.bellAnim({ ringing: true, ticks: 5, lastSideHit: 'west' }, 0.5).deltaFor('bell_body').rz, s), 'bell west: roll +s');
  const rest = ER.bellAnim({ ringing: false, ticks: 5, lastSideHit: 'north' }, 0).deltaFor('bell_body');
  ok(rest.rx === 0 && rest.rz === 0, 'idle bell rests');
  ok(ER.bellAnim({}, 0).deltaFor('other') === null, 'bell: unknown part no delta');
  const sh = ER.beShulkerAnim(1).deltaFor('lid');
  ok(near(sh.ry, 270 * Math.PI / 180) && sh.dpy === -8, 'shulker lid open: 270deg, -8 px');
  ok(ER.beShulkerAnim(0.5).deltaFor('lid').dpy === -4 && ER.beShulkerAnim(1).deltaFor('head') === null, 'shulker half lid; no head delta');
  ok(ER.SHULKER_BOX_SCALE === 0.9995 && ER.SHULKER_BOX_HIDE.head === 1, 'shulker scale 0.9995, head hidden');
  const ban = ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 0);
  const fl = ban.deltaFor('flag'), exp = (-0.0125 + 0.01) * Math.PI;
  ok(ban.deltaFor('pole') === null && fl, 'banner: only the flag moves');
  const rp = M.BEModel.layer('banner').parts.find((q) => q.n === 'flag');
  ok(near(fl.rx + rp.rx, exp), 'banner flag pitch at phase 0: (-0.0125+0.01)*pi');
  okAv(!near(ER.bellAnim({ ringing: true, ticks: 5, lastSideHit: 'south' }, 0.5).deltaFor('bell_body').rx, -s), 'bell south/north swap is caught');
  okAv(!near(ER.beShulkerAnim(1).deltaFor('lid').ry, 180 * Math.PI / 180), 'a 180deg shulker lid is caught');
  okAv(!near(fl.rx + rp.rx, 0), 'a flat flag is caught');
}
// --- Conduit / campfire (constants read from .decomp)
{
  const src = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/block/entity/' + n + '.java', 'utf8');
  const cs = src('ConduitBlockEntityRenderer');
  ok(/0\.3F \+ \$\$10 \* 0\.2F/.test(cs) && /1\.3333334F/.test(cs) && /\(float\)\(\$\$0\.ticks \/ 66 % 3|\/ 66 % 3/.test(cs), 'decomp conduit bob 0.3+0.2s, eye 4/3, 66-tick wind phase');
  const act = (ticks) => ER.conduitParts({ active: true, ticks, ticksActive: 0, eyeOpen: true }, 0, { yaw: 0, pitch: 0 });
  const keys = act(0).map((q) => q.key).join(',');
  ok(keys === 'cage,wind,wind2,eye', 'active conduit draws cage, two winds, eye (' + keys + ')');
  ok(ER.conduitParts({ active: false, ticks: 0, ticksActive: 0 }, 0).map((q) => q.key).join(',') === 'base', 'inactive conduit: base shell only');
  ok(near(act(0)[0].o[1], 0.3 + (0.5 * 0.5 + 0.5) * 0 + 0.2 * 0.5 * 0 + 0.2 * (0.25 + 0.5) * 0 + 0.2 * 0.75) , 'cage at ticks 0: bob 0.3+0.2*0.75');
  ok(act(66)[1].texKey === 'conduit_wind#1' && act(0)[1].texKey === null && act(132)[1].texKey === null, 'wind frame switches at ticks/66 % 3 == 1');
  okAv(!(act(66)[1].texKey === null), 'a wind that never animates is caught');
  ok(ER.CAMPFIRE_ROT.join() === '0,90,180,270', 'campfire slot rotations 0/90/180/270');
  ok(/getRotation|asRotation/.test(src('CampfireBlockEntityRenderer')) && /0\.375F/.test(src('CampfireBlockEntityRenderer')), 'decomp campfire uses 0.375 scale');
  okAv(ER.CAMPFIRE_ROT.join() !== '0,90,180,0', 'a wrong campfire rotation table is caught');
}
// --- Bed / lectern / sign (decomp constants + an independent matrix chain)
{
  const src = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/block/entity/' + n + '.java', 'utf8');
  const bs = src('BedBlockEntityRenderer'), ls = src('LecternBlockEntityRenderer'), ss = src('SignBlockEntityRenderer');
  ok(/translate\(0\.0, 0\.5625, \$\$7 \? -1\.0 : 0\.0\)/.test(bs) && /getDegreesQuaternion\(180\.0F \+ \$\$3\.asRotation\(\)\)/.test(bs), 'decomp bed: lift 0.5625, Rx90, Rz(180+rot)');
  ok(/translate\(0\.5, 1\.0625, 0\.5\)/.test(ls) && /translate\(0\.0, -0\.125, 0\.0\)/.test(ls), 'decomp lectern: T(.5,1.0625,.5), T(0,-.125,0)');
  ok(/0\.6666667F, -0\.6666667F, -0\.6666667F/.test(ss) && /-0\.3125, -0\.4375/.test(ss), 'decomp sign: scale 2/3, wall offset (0,-.3125,-.4375)');
  ok(near(ER.SIGN_SCALE, 0.6666667), 'ER.SIGN_SCALE is 0.6666667');
  const rx = (d, v) => { const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
  const rz = (d, v) => { const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; };
  const chain = (rot, p) => { let v = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5]; v = rz(180 + rot, v); v = [v[0] + 0.5, v[1] + 0.5, v[2] + 0.5]; v = rx(90, v); return [v[0], v[1] + 0.5625, v[2]]; };
  const apply = (R, o, p) => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + o[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + o[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + o[2]];
  let good = true;
  for (const rot of [0, 90, 180, 270]) for (const p of [[0, 0, 0], [1, 0.3, 0.7], [0.2, 0.9, 0.4]]) {
    const b = ER.bedPose(rot), a = apply(b.R, b.o, p), c = chain(rot, p);
    if (!near(a[0], c[0]) || !near(a[1], c[1]) || !near(a[2], c[2])) good = false;
  }
  ok(good, 'bedPose equals the decomp translate/rotate chain for 4 facings');
  okAv(!(() => { const b = ER.bedPose(90), a = apply(b.R, b.o, [1, 0.3, 0.7]), c = chain(0, [1, 0.3, 0.7]); return near(a[0], c[0]) && near(a[2], c[2]); })(), 'a bed facing mix-up is caught');
  okAv(!near(ER.SIGN_SCALE, 0.75), 'a wrong sign scale is caught');
}
// --- More mob renderer scales (ghast/illagers/trader/giant/horses) from .decomp
{
  const rd = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + n + '.java', 'utf8');
  const reg = rd('EntityRenderers');
  ok(/scale\(4\.5F, 4\.5F, 4\.5F\)/.test(rd('GhastEntityRenderer')) && near(ER.RENDER_SCALE.ghast, 4.5), 'ghast scale 4.5');
  ok(/scale\(0\.9375F/.test(rd('IllagerEntityRenderer')) && ['evoker', 'illusioner', 'pillager', 'vindicator'].every((k) => near(ER.RENDER_SCALE[k], 0.9375)), 'illager family 0.9375');
  ok(/scale\(0\.9375F/.test(rd('WanderingTraderEntityRenderer')) && near(ER.RENDER_SCALE.wandering_trader, 0.9375), 'wandering trader 0.9375');
  ok(/GiantEntityRenderer\(\$\$0, 6\.0F\)/.test(reg) && near(ER.RENDER_SCALE.giant, 6), 'giant scale 6.0');
  ok(/DonkeyEntityRenderer<>\(\$\$0, 0\.87F/.test(reg) && near(ER.RENDER_SCALE.donkey, 0.87), 'donkey 0.87');
  ok(/DonkeyEntityRenderer<>\(\$\$0, 0\.92F/.test(reg) && near(ER.RENDER_SCALE.mule, 0.92), 'mule 0.92');
  ok(/, 1\.1F\)/.test(rd('HorseEntityRenderer')) && near(ER.RENDER_SCALE.horse, 1.1), 'horse 1.1');
  okAv(!near(ER.RENDER_SCALE.ghast, 4), 'a wrong ghast scale is caught');
  okAv(!near(ER.RENDER_SCALE.mule, 0.87), 'a donkey/mule mix-up is caught');
  okAv(!/scale\(4\.0F/.test(rd('GhastEntityRenderer')), 'a wrong decomp literal is caught');
}
// --- Phantom / squid / fish / cat pose rules vs .decomp
{
  const rd = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + n + '.java', 'utf8');
  ok(/translate\(0\.0, 0\.5, 0\.0\)/.test(rd('SquidEntityRenderer')) && /translate\(0\.0, -1\.2F, 0\.0\)/.test(rd('SquidEntityRenderer')), 'decomp squid: lift 0.5, drop 1.2');
  const sq = ER.squidPoseOf({ type: 'squid', age: 0 }, 0);
  ok(sq && near(sq.pose.t[1], -1.2 * 1 + 0.5) || (sq && near(sq.pose.t[1], -0.7)), 'squid at rest: translate y = 0.5 - 1.2');
  ok(ER.squidPoseOf({ type: 'cow' }, 0) === null, 'squid pose is squid-only');
  ok(/POSITIVE_X\.getDegreesQuaternion\(\$\$0\.getPitch\(\)\)/.test(rd('PhantomEntityRenderer')), 'decomp phantom: Rx(pitch)');
  const ph = ER.phantomPoseOf({ type: 'phantom', pitch: Math.PI / 2 });
  ok(ph && near(ph.pose.R[5], -1) && near(ph.pose.R[7], 1), 'phantom pitch 90deg: Rx(90)');
  ok(ER.phantomPoseOf({ type: 'phantom', pitch: 0 }) === null, 'level phantom: no pose');
  ok(/translate\(\(double\)\(0\.4F \* \$\$5\), \(double\)\(0\.15F \* \$\$5\), \(double\)\(0\.1F \* \$\$5\)\)/.test(rd('CatEntityRenderer')) && ER.catPoseOf({ type: 'dog' }, 0) === null, 'decomp cat sleep offsets; non-cat: no pose');
  const cod = ER.fishPoseOf({ type: 'cod', age: 0, inWater: false }, 0);
  ok(cod && near(cod.pose.t[0], 0.1) && near(cod.pose.t[1], 0.1) && near(cod.pose.t[2], -0.1), 'cod out of water: translate (0.1,0.1,-0.1)');
  ok(ER.fishPoseOf({ type: 'cow' }, 0) === null, 'fish pose is fish-only');
  okAv(!near(ER.phantomPoseOf({ type: 'phantom', pitch: Math.PI / 2 }).pose.R[5], 1), 'a mirrored phantom pitch is caught');
  okAv(!near(ER.fishPoseOf({ type: 'cod', age: 0, inWater: false }, 0).pose.t[0], 0.2), 'a cod/other-fish offset mix-up is caught');
  okAv(ER.squidPoseOf({ type: 'squid', age: 0 }, 0).pose.t[1] !== 0.5, 'a squid without the 1.2 drop is caught');
}
// --- dynamic render scales (WitherEntityRenderer, VillagerEntityRenderer, ElderGuardian, Piglin, fireballs)
{
  const rd = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + n + '.java', 'utf8');
  ok(/\$\$3 = 2\.0F/.test(rd('WitherEntityRenderer')) && /\/ 220\.0F \* 0\.5F/.test(rd('WitherEntityRenderer')), 'decomp wither: 2.0 minus (t-p)/220*0.5');
  ok(near(ER.renderScaleOf({ type: 'wither' }, 0), 2), 'wither at rest: 2.0');
  ok(near(ER.renderScaleOf({ type: 'wither', invulTimer: 220 }, 0), 1.5), 'wither at timer 220: 1.5');
  ok(near(ER.renderScaleOf({ type: 'wither', invulTimer: 110 }, 0.5), 2 - 109.5 / 220 * 0.5), 'wither partial tick is subtracted from the timer');
  ok(/\$\$3 = 0\.9375F/.test(rd('VillagerEntityRenderer')) && /\$\$3 \*= 0\.5F/.test(rd('VillagerEntityRenderer')), 'decomp villager: 0.9375, baby x0.5');
  ok(near(ER.renderScaleOf({ type: 'villager' }, 0), 0.9375) && near(ER.renderScaleOf({ type: 'villager', isBaby: true }, 0), 0.46875), 'villager adult/baby scale');
  ok(/scale\(0\.5F, 0\.5F, 0\.5F\)/.test(rd('StriderEntityRenderer')) && near(ER.renderScaleOf({ type: 'strider', isBaby: true }, 0), 0.5) && near(ER.renderScaleOf({ type: 'strider' }, 0), 1), 'strider baby 0.5');
  ok(/ElderGuardianEntity\.SCALE/.test(rd('ElderGuardianEntityRenderer')) && near(ER.RENDER_SCALE.elder_guardian, 1.9975 / 0.85), 'elder guardian SCALE = 1.9975/0.85');
  ok(/scale\(2\.0F, 2\.0F, 2\.0F\)/.test(rd('DragonFireballEntityRenderer')) && near(ER.RENDER_SCALE.dragon_fireball, 2), 'dragon fireball 2.0');
  ok(/scale\(-0\.5F, -0\.5F, 0\.5F\)/.test(rd('ShulkerBulletEntityRenderer')) && near(ER.RENDER_SCALE.shulker_bullet, 0.5), 'shulker bullet 0.5');
  ok(/1\.0019531F, 1\.0F, 1\.0019531F/.test(rd('PiglinEntityRenderer')) && ['piglin', 'piglin_brute', 'zombified_piglin'].every((k) => near(ER.RENDER_SCALE_XZ[k], 1.0019531)), 'piglin family horizontal scale 1.0019531');
  ok(near(ER.renderScaleOf({ type: 'phantom', phantomSize: 4 }, 0), 1.6), 'phantom size 4: 1 + 0.15*4');
  ok(ER.renderScaleOf(null, 0) === 1 && ER.renderScaleOf({ type: 'cow' }, 0) === 1, 'unscaled mobs and null render at 1');
  okAv(!near(ER.renderScaleOf({ type: 'villager', isBaby: true }, 0), 0.9375), 'a baby villager drawn at adult size is caught');
  okAv(!near(ER.renderScaleOf({ type: 'wither', invulTimer: 220 }, 0), 2), 'a wither that ignores the spawn shrink is caught');
  okAv(!near(ER.RENDER_SCALE_XZ.piglin, 1), 'a piglin without the 1.0019531 widening is caught');
}
// --- Drowned lean pose / hoglin model / enderman (vs .decomp)
{
  const rd = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + n + '.java', 'utf8');
  const hm = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/HoglinEntityModel.java', 'utf8');
  ok(/getLeaningPitch\(\$\$4\)/.test(rd('DrownedEntityRenderer')) && /lerp\(\$\$5, \$\$0\.getPitch\(\), -10\.0F - \$\$0\.getPitch\(\)\)/.test(rd('DrownedEntityRenderer')), 'decomp drowned: Rx(lerp(leaning, pitch, -10 - pitch))');
  ok(ER.drownedSwimPoseOf({ type: 'drowned', leaningPitch: 0, lastLeaningPitch: 0 }, 0) === null, 'drowned not leaning: no pose');
  const dp = ER.drownedSwimPoseOf({ type: 'drowned', leaningPitch: 1, lastLeaningPitch: 1, swimPitch: 0, yBodyRot: 0, yBodyRotO: 0 }, 0);
  ok(dp && near(dp.R[5], dp.R[5]) && near(Math.abs(dp.R[4]), Math.cos(10 * Math.PI / 180)), 'drowned fully leaning at pitch 0: tilt of 10 degrees');
  const dh = ER.drownedSwimPoseOf({ type: 'drowned', leaningPitch: 0.5, lastLeaningPitch: 0.5, swimPitch: 0, yBodyRot: 0, yBodyRotO: 0 }, 0);
  ok(dh && near(Math.abs(dh.R[4]), Math.cos(5 * Math.PI / 180)), 'drowned half leaning: 5 degrees');
  okAv(!near(Math.abs(dh.R[4]), Math.cos(10 * Math.PI / 180)), 'a drowned that ignores the leaning lerp is caught');
  ok(/sin\(\$\$1\)/.test(hm) && /cos\(\$\$1\) \* 1\.2F \* \$\$2/.test(hm), 'decomp hoglin: ears sin, legs cos*1.2');
  const hd = (part, l) => ER.hoglinDelta(part, l, 1, 0, { cd: 0 }, false);
  ok(near(hd('right_ear', 1).rz, -Math.sin(1)) && near(hd('left_ear', 1).rz, Math.sin(1)), 'hoglin ears flap opposite');
  ok(near(hd('right_front_leg', 0.7).rx, Math.cos(0.7) * 1.2) && near(hd('left_front_leg', 0.7).rx, Math.cos(0.7 + Math.PI) * 1.2), 'hoglin diagonal legs 1.2 amplitude');
  ok(hd('nope', 0) === null, 'hoglin: unknown part no delta');
  ok(near(ER.hoglinDelta('head', 0, 1, 0, { cd: 5 }, false).rx, ER.HOGLIN_HEAD_PITCH_END - ER.HOGLIN_HEAD_PITCH_START), 'hoglin head fully raised at cooldown 5');
  ok(near(ER.hoglinDelta('mane', 0, 1, 0, { cd: 0 }, true).dpz, -3 + 5) && near(ER.hoglinDelta('mane', 0, 1, 0, { cd: 0 }, false).dpz, -2), 'hoglin mane offset adult/baby');
  okAv(!near(hd('right_ear', 1).rz, Math.sin(1)), 'a hoglin ear sign flip is caught');
  okAv(!near(hd('right_front_leg', 0.7).rx, Math.cos(0.7)), 'a hoglin leg without the 1.2 gain is caught');
}

// --- Creeper swell scale / flash (CreeperEntityRenderer.method_3900 / method_23154 vs .decomp)
{
  const cr = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/CreeperEntityRenderer.java', 'utf8');
  ok(/\$\$3 \*= \$\$3;\s*\$\$3 \*= \$\$3;/.test(cr) && /1\.0F \+ \$\$3 \* 0\.4F/.test(cr) && /1\.0F \+ \$\$3 \* 0\.1F/.test(cr), 'decomp creeper: swell^4, xz 0.4, y 0.1');
  const saved = M.Creeper; let fz = 0;
  M.Creeper = { swellFraction: () => fz };
  const ce = { type: 'creeper', dead: false };
  const s0 = ER.creeperScale(ce, 0);
  ok(s0 && near(s0.sxz, 1) && near(s0.sy, 1) && s0.white === 0, 'creeper fuse 0: unit scale, no flash');
  fz = 1; const s1 = ER.creeperScale(ce, 0), w = 1 + Math.sin(100) * 0.01;
  ok(near(s1.sxz, 1.4 * w) && near(s1.sy, 1.1 / w), 'creeper full fuse: 1.4 xz / 1.1 y with wobble');
  fz = 0.5; const s5 = ER.creeperScale(ce, 0);
  ok(near(s5.sxz, (1 + 0.0625 * 0.4) * (1 + Math.sin(50) * 0.005)), 'creeper half fuse: 0.5^4 curve');
  ok(near(s5.white, 7 / 15) && ER.creeperScale({ type: 'creeper', dead: true }, 0) === null && ER.creeperScale({ type: 'cow' }, 0) === null, 'creeper flash on odd tenth; dead/non-creeper null');
  okAv(!near(s1.sxz, 1.1 * w), 'a creeper with xz/y gains swapped is caught');
  okAv(!near(s5.sxz, (1 + 0.5 * 0.4) * (1 + Math.sin(50) * 0.005)), 'a creeper without the ^4 curve is caught');
  M.Creeper = saved;
}
// --- Guardian beam geometry / enderman model (vs .decomp)
{
  const gr = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/GuardianEntityRenderer.java', 'utf8');
  const em = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/EndermanEntityModel.java', 'utf8');
  ok(/\$\$8 \* 0\.05F \* -1\.5F/.test(gr) && /64 \+ \(int\)\(\$\$19 \* 191\.0F\)/.test(gr) && /128 - \(int\)\(\$\$19 \* 64\.0F\)/.test(gr) && /0\.282F/.test(gr), 'decomp guardian beam: spin, colour ramp, 0.2/0.282 radii');
  ok(ER.guardianBeamQuads([0, 0, 0], [0, 0, 0], 0, 0, true).length === 0, 'zero-length beam: no quads');
  const q0 = ER.guardianBeamQuads([0, 0, 0], [0, 4, 0], 0, 0, true), q1 = ER.guardianBeamQuads([0, 0, 0], [0, 4, 0], 1, 0, false);
  ok(q0.length === 3 && q0[0].rgba[0].join() === '64,32,128,255' && q1[0].rgba[0].join() === '255,223,64,255', 'beam: 3 quads; colour 64,32,128 -> 255,223,64 with progress');
  ok(q0[0].uv[0][0] === 0.4999 && near(q0[0].uv[0][1], -1 + 5 * 2.5) && q0[2].uv[0][1] === 1 && q1[2].uv[0][1] === 0.5, 'beam uv: 0.4999 column, v span (len+1)*2.5, cap flickers with age parity');
  ok(near(q0[0].p[1][1], 0) && near(q0[0].p[0][1], 5), 'beam quad spans eye .. len+1 along the target direction');
  okAv(q1[0].rgba[0].join() !== '64,32,128,255', 'a beam without the progress^2 colour ramp is caught');
  okAv(q0[2].uv[0][1] !== q1[2].uv[0][1], 'a beam cap that ignores age parity is caught');
  ok(/rightArm\.pitch \*= 0\.5F/.test(em) && /\$\$0 = 0\.4F|0\.4F/.test(em), 'decomp enderman: limb pitch x0.5, clamp 0.4');
  const ed = (part, ctx) => ER.setupAnimDelta(part, 0, 0, 0, 0, false, 'enderman', ctx);
  const cA = { enderman: { carrying: true, angry: false }, rest: { rx: 0, rz: 0 } };
  ok(near(ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, 'enderman', cA).rx, -0.5) && near(ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, 'enderman', cA).rz, 0.05) && near(ER.setupAnimDelta('left_arm', 0, 0, 0, 0, false, 'enderman', cA).rz, -0.05), 'enderman carrying: arms pitch -0.5, roll +-0.05');
  const cG = { enderman: { carrying: false, angry: true }, rest: {} };
  ok(near(ER.setupAnimDelta('head', 0, 0, 0, 0, false, 'enderman', cG).dpy, -5) && near(ER.setupAnimDelta('hat', 0, 0, 0, 0, false, 'enderman', cG).dpy, -5) && !ER.setupAnimDelta('right_leg', 0, 0, 0, 0, false, 'enderman', cG).dpy, 'enderman angry: head/hat pivotY -5 only');
  const lg = ER.setupAnimDelta('right_leg', 20, 1, 0, 0, false, 'enderman', { enderman: { carrying: false, angry: false }, rest: {} });
  ok(lg && Math.abs(lg.rx) <= 0.4 + 1e-9, 'enderman legs clamp to 0.4');
  okAv(!near(ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, 'enderman', cA).rx, 0), 'an enderman that does not raise carrying arms is caught');
  okAv(!near(ER.setupAnimDelta('head', 0, 0, 0, 0, false, 'enderman', cG).dpy, 0), 'an enderman head that ignores anger is caught');
}
// --- HoglinEntityModel.setAngles (vs .decomp)
{
  const hm = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/HoglinEntityModel.java', 'utf8');
  ok(/1\.0F - \(float\)MathHelper\.abs\(10 - 2 \* \$\$6\) \/ 10\.0F/.test(hm) && /lerp\(\$\$7, 0\.87266463F/.test(hm) && /mane\.pivotZ = -3\.0F/.test(hm) && /cos\(\$\$1\) \* 1\.2F \* \$\$2/.test(hm), 'decomp hoglin: cooldown triangle, head lerp, baby mane -3, legs cos*1.2');
  const hd = (part, cd, baby, l = 0.7, a = 0.5) => ER.hoglinDelta(part, l, a, 20, { cd }, baby);
  ok(near(hd('head', 0, false).rx, 0) && near(hd('head', 5, false).rx, -Math.PI / 9 - 0.87266463) && near(hd('head', 10, false).rx, 0), 'hoglin head toss: 0 at cooldown 0/10, full at 5');
  ok(near(hd('head', 5, true).dpy, 3) && hd('head', 5, false).dpy === 0 && near(hd('mane', 0, true).dpz, 2) && near(hd('mane', 0, false).dpz, -2), 'hoglin baby: head pivotY lerp 2..5, mane z -3 vs adult -7');
  ok(near(hd('right_front_leg', 0, false).rx, Math.cos(0.7) * 0.6) && near(hd('left_hind_leg', 0, false).rx, Math.cos(0.7) * 0.6) && near(hd('left_front_leg', 0, false).rx, -Math.cos(0.7) * 0.6) && near(hd('right_hind_leg', 0, false).rx, -Math.cos(0.7) * 0.6), 'hoglin legs: diagonal pairs, cos(l)*1.2*a');
  ok(near(hd('right_ear', 0, false).rz, -0.5 * Math.sin(0.7)) && near(hd('left_ear', 0, false).rz, 0.5 * Math.sin(0.7)) && near(hd('head', 0, false).ry, 20 * 0.017453292), 'hoglin ears flap +-a*sin(l); head yaw');
  okAv(!near(hd('right_front_leg', 0, false).rx, Math.cos(0.7 * 0.6662) * 1.4 * 0.5), 'a hoglin using quadruped leg swing is caught');
  okAv(!near(hd('head', 0, false).rx, hd('head', 5, false).rx), 'a hoglin head that ignores the strike cooldown is caught');
}
// --- Bell / banner / bed block-entity renderers (vs .decomp)
{
  const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/block/entity/';
  const bl = readFileSync(D + 'BellBlockEntityRenderer.java', 'utf8'), bn = readFileSync(D + 'BannerBlockEntityRenderer.java', 'utf8'), bd = readFileSync(D + 'BedBlockEntityRenderer.java', 'utf8');
  ok(/sin\(\$\$6 \/ \(float\) Math\.PI\) \/ \(4\.0F \+ \$\$6 \/ 3\.0F\)/.test(bl), 'decomp bell: sin(t/pi)/(4+t/3)');
  const bt = (dir, ticks, ringing) => ER.bellAnim({ ringing, ticks, lastSideHit: dir }, 0.5).deltaFor('bell_body');
  const s = Math.sin(3.5 / Math.PI) / (4 + 3.5 / 3);
  ok(near(bt('north', 3, true).rx, -s) && near(bt('south', 3, true).rx, s) && near(bt('east', 3, true).rz, -s) && near(bt('west', 3, true).rz, s), 'bell swing: N -pitch, S +pitch, E -roll, W +roll');
  ok(bt('north', 3, false).rx === 0 && bt('up', 3, true).rx === 0 && bt('up', 3, true).rz === 0, 'bell at rest / hit from above: no swing');
  ok(ER.bellAnim({ ringing: true, ticks: 3, lastSideHit: 'north' }, 0).deltaFor('other') === null, 'bell: only bell_body moves');
  okAv(!near(bt('south', 3, true).rx, -s), 'a bell swinging the wrong way is caught');
  ok(/-0\.0125F \+ 0\.01F \* MathHelper\.cos/.test(bn) && /pivotY = -32\.0F/.test(bn) && /\* 7 \+ \$\$15\.getY\(\) \* 9 \+ \$\$15\.getZ\(\) \* 13/.test(bn), 'decomp banner: sway formula, pivotY -32, pos phase 7/9/13');
  const rest = M.BEModel.layer('banner').parts.find((p) => p.n === 'flag');
  const b = ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 0).deltaFor('flag');
  ok(near(b.rx + rest.rx, (-0.0125 + 0.01) * Math.PI) && b.dpy + rest.py === -32, 'banner at phase 0: pitch (-0.0125+0.01)pi, pivotY -32');
  const b2 = ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 50).deltaFor('flag');
  ok(near(b2.rx + rest.rx, (-0.0125 - 0.01) * Math.PI), 'banner half cycle: pitch (-0.0125-0.01)pi');
  const b3 = ER.beBannerAnim({ x: 100, y: 0, z: 0 }, 0).deltaFor('flag');
  ok(near(b3.rx, b.rx) && ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 0).deltaFor('pole') === null, 'banner: phase period 100 (x*7), only the flag moves');
  okAv(!near(b2.rx, b.rx), 'a banner that does not sway is caught');
  ok(/translate\(0\.0, 0\.5625/.test(bd) && /getDegreesQuaternion\(90\.0F\)/.test(bd) && /180\.0F \+ \$\$3\.asRotation\(\)/.test(bd), 'decomp bed: 0.5625 lift, Rx90, Rz(180+rot)');
  const bp = ER.bedPose(0), bq = ER.bedPose(90);
  const dot = (a) => a.reduce((x, v) => x + v * v, 0);
  ok(near(dot(bp.R.slice(0, 3)), 1) && near(dot(bq.R.slice(0, 3)), 1) && bp.R.some((v, i) => !near(v, bq.R[i])), 'bed rotation is orthonormal and depends on facing');
  // Rx(90)Rz(180): maps block-local +z (head direction) onto world; check R*(0,0,1) = (0,-1,0)-ish magnitude 1 in y
  ok(near(Math.abs(bp.R[5]), 1) || near(Math.abs(bp.R[7]), 1), 'bed Rx(90): model z axis becomes vertical');
  okAv(near(ER.bedPose(0).R[0], ER.bedPose(90).R[0]) === false, 'a bed ignoring its facing is caught');
}
// --- BipedEntityModel.animateArms (vs .decomp)
{
  const bm = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/BipedEntityModel.java', 'utf8');
  ok(/sin\(MathHelper\.sqrt\(\$\$4\) \* \(float\) \(Math\.PI \* 2\)\) \* 0\.2F/.test(bm) && /\$\$5 \* 1\.2F \+ \$\$6/.test(bm) && /\* -0\.4F/.test(bm) && /pivotX = -MathHelper\.cos/.test(bm), 'decomp biped animateArms: twist 0.2, chop 1.2, roll -0.4, pivots');
  const t = 0.25, by = Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.2;
  const body = ER.animateArmsDelta('body', t, false, 0, null, true);
  ok(near(body.ry, by) && ER.animateArmsDelta('body', 0, false, 0, null, true) === null && ER.animateArmsDelta('head', t, false, 0, null, true) === null, 'biped swing: body twist, none at t=0, head untouched');
  ok(near(ER.animateArmsDelta('body', t, true, 0, null, true).ry, -by), 'left-handed mirrors the twist');
  const ra = ER.animateArmsDelta('right_arm', t, false, 0, null, true), la = ER.animateArmsDelta('left_arm', t, false, 0, null, true);
  ok(near(ra.dpx, -Math.cos(by) * 5 + 5) && near(la.dpx, Math.cos(by) * 5 - 5) && near(ra.dpz, Math.sin(by) * 5) && near(la.dpz, -Math.sin(by) * 5), 'arm pivots swing round with the body');
  let f = 1 - t; f = 1 - f * f * f * f;
  ok(near(ra.rx, -(Math.sin(f * Math.PI) * 1.2 + Math.sin(t * Math.PI) * 0.7 * 0.75)) && near(ra.rz, -0.4 * Math.sin(t * Math.PI)) && near(ra.ry, by * 3), 'main arm chops: pitch, roll, yaw x3');
  ok(near(la.rx, by) && near(la.ry, by) && la.rz === 0, 'off arm takes the twist only');
  ok(ER.BIPED_SWING.zombie === 1 && ER.BIPED_SWING.player === 1 && !ER.BIPED_SWING.villager && !ER.BIPED_SWING.witch, 'BIPED_SWING membership: biped models only');
  okAv(!near(ER.animateArmsDelta('right_arm', t, true, 0, null, true).rz, ra.rz), 'a left-handed mob chopping with the right arm is caught');
  okAv(!near(ER.animateArmsDelta('right_arm', 0.5, false, 0, null, true).rx, ra.rx), 'a chop that ignores swing progress is caught');
}
// --- BatEntityModel.setAngles + BatEntityRenderer.setupTransforms (vs .decomp)
{
  const near = (a, b) => Math.abs(a - b) < 1e-6;   // the decomp is float32 (0.017453292F)
  const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/';
  const bm = readFileSync(D + 'model/BatEntityModel.java', 'utf8'), br = readFileSync(D + 'BatEntityRenderer.java', 'utf8');
  ok(/-1\.7278761F/.test(bm) && /74\.48451F/.test(bm) && /setPivot\(-3\.0F, 0\.0F, 3\.0F\)/.test(bm) && /cos\(\$\$3 \* 0\.1F\) \* 0\.15F/.test(bm) && /scale\(0\.35F/.test(br) && /translate\(0\.0, -0\.1F/.test(br), 'decomp bat: roost tip -1.7278761, flap 74.48451, roost wing pivots, body bob, 0.35 scale, roost lift -0.1');
  const bd = (part, roost, age = 7, yaw = 30, pit = 10) => ER.setupAnimDelta(part, 0, 0, yaw, pit, false, 'bat', { bat: { roosting: roost }, ageInTicks: age });
  const R = Math.PI / 180, wy = Math.cos(7 * 74.48451 * R) * Math.PI * 0.25;
  ok(near(bd('head', false).rx, 10 * R) && near(bd('head', false).ry, 30 * R) && bd('head', false).rz === 0, 'flying bat head: pitch/yaw from look, no roll');
  ok(near(bd('head', true).ry, Math.PI - 30 * R) && near(bd('head', true).rz, Math.PI) && near(bd('head', true).dpy, -2 + 0.1 * 16 / 0.35), 'roosting bat head hangs upside down, mirrored yaw, pivotY -2');
  ok(near(bd('body', false).rx, Math.PI / 4 + Math.cos(0.7) * 0.15) && near(bd('body', true).rx, Math.PI), 'bat body: flying bob about pi/4, roosting pi');
  ok(near(bd('right_wing', false).ry, wy) && near(bd('left_wing', false).ry, -wy) && near(bd('right_wing_tip', false).ry, wy * 0.5) && near(bd('left_wing_tip', false).ry, -wy * 0.5), 'flying bat wings flap mirrored, tips half');
  ok(near(bd('right_wing', true).ry, -Math.PI * 2 / 5) && near(bd('left_wing', true).ry, Math.PI * 2 / 5) && near(bd('right_wing_tip', true).ry, -1.7278761) && near(bd('left_wing', true).rx, -Math.PI / 20), 'roosting wings folded; tips -1.7278761');
  ok(bd('right_wing', true).dpx === -3 && bd('left_wing', true).dpx === 3 && bd('right_wing', true).dpz === 3 && bd('right_wing', false).dpx === 0, 'roosting wing pivots +-3,0,3');
  ok(near(bd('body', true).dpy, 0.1 * 16 / 0.35) && near(bd('body', false).dpy, -Math.cos(7 * 0.3) * 0.1 * 16 / 0.35) && bd('feet', false) === null, 'bat lift: roost -0.1, flying cos(age*0.3)*0.1, scaled by 1/0.35');
  okAv(!near(bd('right_wing', true).ry, bd('right_wing', false).ry), 'a roosting bat that keeps flapping is caught');
  okAv(!near(bd('left_wing', false).ry, bd('right_wing', false).ry), 'bat wings flapping in phase are caught');
}
// --- Lectern/BookModel.setPageAngles + LecternBlockEntityRenderer (vs .decomp)
{
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/';
  const bk = readFileSync(D + 'entity/model/BookModel.java', 'utf8'), lr = readFileSync(D + 'block/entity/LecternBlockEntityRenderer.java', 'utf8');
  ok(/sin\(\$\$0 \* 0\.02F\) \* 0\.1F \+ 1\.25F\) \* \$\$3/.test(bk) && /\$\$4 - \$\$4 \* 2\.0F \* \$\$1/.test(bk) && /translate\(0\.5, 1\.0625, 0\.5\)/.test(lr) && /67\.5F/.test(lr) && /translate\(0\.0, -0\.125, 0\.0\)/.test(lr) && /setPageAngles\(0\.0F, 0\.1F, 0\.9F, 1\.2F\)/.test(lr), 'decomp book/lectern constants');
  ok(ER.BOOK_REST_ROT.south === 0 && ER.BOOK_REST_ROT.west === 90 && ER.BOOK_REST_ROT.north === 180 && ER.BOOK_REST_ROT.east === 270, 'Direction.asRotation table');
  const t = 37, f1 = 0.1, f2 = 0.9, open = 1.2, a = (Math.sin(t * 0.02) * 0.1 + 1.25) * open;
  const A = ER.bookAnim(t, f1, f2, open, null, [0, 0, 0]);
  const rest = {}; for (const p of M.BEModel.layer('book').parts) rest[p.n] = p;
  const yawOf = n => { const d = A.deltaFor(n); return d ? (rest[n].ry || 0) + d.ry : null; };
  ok(near(yawOf('left_lid'), Math.PI + a) && near(yawOf('right_lid'), -a) && near(yawOf('left_pages'), a) && near(yawOf('right_pages'), -a), 'book covers and pages yaw');
  ok(near(yawOf('flip_page1'), a - a * 2 * f1) && near(yawOf('flip_page2'), a - a * 2 * f2), 'flipping pages yaw');
  ok(near(rest.left_pages.px + A.deltaFor('left_pages').dpx, Math.sin(a)) && A.deltaFor('left_lid').dpx === undefined, 'page pivotX = sin(a), covers untouched');
  okAv(!near(ER.bookAnim(t, f1, f2, 0, null, [0, 0, 0]).deltaFor('right_lid').ry + (rest.right_lid.ry || 0), -a), 'a closed book reported as open is caught');
  okAv(!near(yawOf('flip_page1'), yawOf('flip_page2')), 'identical flip pages are caught');
}
// --- GuardianEntityModel.setAngles (spikes / eye / tail) + ER.guardianAnim vs .decomp
{
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/GuardianEntityModel.java';
  const gs = readFileSync(D, 'utf8');
  ok(/\(1\.0F - \$\$0\.getSpikesExtension\(\$\$6\)\) \* 0\.55F/.test(gs) && /\* 1\.5F \+ \(float\)\$\$0\) \* 0\.01F - \$\$2/.test(gs) && /\(float\) Math\.PI \* 0\.05F/.test(gs) && /\(float\) Math\.PI \* 0\.15F/.test(gs), 'decomp guardian: 0.55 extension, cos(age*1.5+i)*0.01, tail pi*.05/.1/.15');
  const g = ER.guardianAnim({ type: 'guardian', age: 10, spikesExtension: 1, prevSpikesExtension: 0.5, tailAngle: 2, prevTailAngle: 0, yaw: 0, xHeadRot: 0, x: 0, y: 0, z: 0 }, 0.5);
  ER.camPos = null;
  const g0 = ER.guardianAnim({ type: 'guardian', age: 10, spikesExtension: 1, prevSpikesExtension: 0.5, tailAngle: 2, prevTailAngle: 0 }, 0.5);
  ok(near(g0.spikeK, (1 - 0.75) * 0.55) && near(g0.tail, 1) && near(g0.age, 10.5), 'guardianAnim lerps extension/tail by partial, age+partial');
  const gd = (part, ctx) => { const { rest, ...g } = ctx; return ER.setupAnimDelta(part, 0, 0, 0, 0, false, 'guardian', { guardian: g, rest, ageInTicks: 3 }); };
  const base = { age: 3, spikeK: 0.2, tail: 1, eyeX: 0.7, eyeY: 1 };
  const px = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8], py = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8], pz = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
  const ang = (i) => 1 + Math.cos(3 * 1.5 + i) * 0.01 - 0.2;
  const ang0 = (i) => 1 + Math.cos(i) * 0.01;
  let sp = true;
  for (const i of [0, 2, 5, 11]) {
    const d = gd('spike' + i, Object.assign({ rest: { px: px[i] * ang0(i), py: 16 + py[i] * ang0(i), pz: pz[i] * ang0(i) } }, base)); if (!d) { sp = false; continue; }
    // delta + rest pivot = decomp pivot; rest pivot is the formula at (age 0, ext 0)
    const wantY = 16 + py[i] * ang(i) - (16 + py[i] * ang0(i)), wantX = px[i] * ang(i) - px[i] * ang0(i), wantZ = pz[i] * ang(i) - pz[i] * ang0(i);
    if (!near(d.dpx, wantX) || !near(d.dpy, wantY) || !near(d.dpz, wantZ)) sp = false;
  }
  ok(sp, 'spike pivots follow getSpikePivot{X,Y,Z}(i, age, 0.55*(1-ext))');
  ok(near(gd('tail0', base).ry, Math.sin(1) * Math.PI * 0.05) && near(gd('tail1', base).ry, Math.sin(1) * Math.PI * 0.1) && near(gd('tail2', base).ry, Math.sin(1) * Math.PI * 0.15), 'tail yaws sin(angle)*pi*{.05,.1,.15}');
  ok(gd('eye', base).dpx === 0.7 && gd('eye', base).dpy === 1, 'eye pivot follows the camera-facing inputs');
  const eyeFor = (cam, e) => { ER.camPos = cam; const r = ER.guardianAnim(Object.assign({ type: 'guardian', age: 0, x: 0, y: 0, z: 0, yaw: 0, xHeadRot: 0 }, e), 1); ER.camPos = null; return r; };
  ok(eyeFor([0, 10, 5], {}).eyeY === 0 && eyeFor([0, -10, 5], {}).eyeY === 1, 'eye pivotY 0 when the camera is above, 1 when below');
  ok(near(eyeFor([0, 0, 5], {}).eyeX, 0) && near(eyeFor([5, 0, 0], {}).eyeX, -2), 'camera in line with facing: eyeX 0; to the side: |eyeX| 2');
  okAv(!near(gd('tail0', base).ry, gd('tail2', base).ry), 'identical tail segments are caught');
  okAv(!near(gd('spike0', Object.assign({ rest: { px: 0, py: 8, pz: 8 } }, base)).dpy, gd('spike0', Object.assign({ rest: { px: 0, py: 8, pz: 8 } }, base, { spikeK: 0 })).dpy), 'spikes ignoring the extension are caught');
  okAv(eyeFor([0, 10, 5], {}).eyeY !== eyeFor([0, -10, 5], {}).eyeY, 'an eye that ignores camera height is caught');
}
// --- #11487 part 3: ShulkerBoxBlockEntityRenderer scale, IllagerEntityRenderer (Evoker/Vindicator/Illusioner), GhastEntityRenderer,
//     ExperienceOrbEntityRenderer colour pulse + UV crop -- constants read from .decomp, each broken once.
{
  const dec = (d, n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/' + d + '/' + n + '.java', 'utf8');
  const num = (t, re) => { const m = re.exec(t); return m ? parseFloat(m[1]) : null; };
  ok(near(num(dec('block/entity', 'ShulkerBoxBlockEntityRenderer'), /scale\(([0-9.]+)F/), ER.SHULKER_BOX_SCALE), 'ShulkerBoxBlockEntityRenderer scale 0.9995 == ER.SHULKER_BOX_SCALE');
  const il = num(dec('entity', 'IllagerEntityRenderer'), /scale\(([0-9.]+)F/);
  ok(il === 0.9375, 'decomp IllagerEntityRenderer scale 0.9375');
  for (const k of ['evoker', 'vindicator', 'illusioner', 'pillager']) ok(near(ER.RENDER_SCALE[k], il), k + ' (Evoker/Vindicator/IllusionerEntityRenderer extend Illager) scale ' + il);
  ok(near(ER.RENDER_SCALE.ghast, num(dec('entity', 'GhastEntityRenderer'), /scale\(([0-9.]+)F/)), 'GhastEntityRenderer scale 4.5');
  const xo = dec('entity', 'ExperienceOrbEntityRenderer');
  ok(/\/ 2\.0F/.test(xo) && /\* 0\.5F \* 255\.0F/.test(xo) && /\* 0\.1F \* 255\.0F/.test(xo) && /\.color\(\$\$5, \$\$6, \$\$7, 128\)/.test(xo), 'decomp orb: t=(age+p)/2, r .5*255, b .1*255, alpha 128');
  const ind = (age, p) => { const t = (age + p) / 2; return [Math.floor((Math.sin(t) + 1) * 0.5 * 255), 255, Math.floor((Math.sin(t + Math.PI * 4 / 3) + 1) * 0.1 * 255), 128]; };
  let oc = true; for (const [a, p] of [[0, 0], [7, 0.5], [40, 0.9], [123, 0.25]]) if (ER.orbColorAt(a, p).join() !== ind(a, p).join()) oc = false;
  ok(oc, 'orbColorAt matches the independent pulse formula');
  ok(ER.orbColorAt(5, 0)[3] === 128 && ER.orbColorAt(5, 0)[1] === 255, 'orb alpha 128, green 255');
  const uv = ER.orbUV(5); ok(uv.length === 4 && uv[0] < uv[2] && uv[1] < uv[3], 'orbUV(5) is a non-empty rect');
  okAv(!near(0.9995, 1.0), 'a shulker box drawn at 1.0 (z-fights its block) is caught');
  okAv((() => { const s = ER.RENDER_SCALE.evoker; ER.RENDER_SCALE.evoker = 1; const r = near(ER.RENDER_SCALE.evoker, il); ER.RENDER_SCALE.evoker = s; return !r; })(), 'a wrong evoker scale is caught');
  okAv(ER.orbColorAt(5, 0)[3] !== 255 && ER.orbColorAt(0, 0).join() !== ER.orbColorAt(3, 0).join(), 'an opaque or static orb pulse is caught');
}
// --- #11487 part 4: EndCrystalEntityRenderer.getYOffset, GlowSquidEntityRenderer.getBlockLight (vs .decomp, independent formulas)
{
  const dc = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/EndCrystalEntityRenderer.java', 'utf8');
  ok(/sin\(\$\$2 \* 0\.2F\) \/ 2\.0F \+ 0\.5F/.test(dc) && /\* 0\.4F/.test(dc) && /\$\$3 - 1\.4F/.test(dc), 'decomp crystal bob: sin(t*0.2)/2+0.5, (s*s+s)*0.4, -1.4');
  const f = Math.fround, ind = (age, p) => { let s = f(Math.sin(f(f(age + p) * f(0.2))) / 2 + 0.5); s = f(f(f(s * s) + s) * f(0.4)); return s - f(1.4); };
  let cy = true; for (const [a, p] of [[0, 0], [5, 0.5], [31, 0.25], [200, 0.9]]) if (Math.abs(ER.crystalYOffset({ age: a, endCrystalAge: a, crystalAge: a }, p) - ind(a, p)) > 1e-4) cy = false;
  ok(cy, 'crystalYOffset matches the independent bob formula');
  okAv(Math.abs(ER.crystalYOffset({ age: 5, endCrystalAge: 5, crystalAge: 5 }, 0) - ER.crystalYOffset({ age: 9, endCrystalAge: 9, crystalAge: 9 }, 0)) > 1e-6, 'a crystal that does not bob is caught');
  ok(/clampedLerp\(0\.0F, 15\.0F, 1\.0F - \(float\)\$\$0\.getDarkTicksRemaining\(\) \/ 10\.0F\)/.test(readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/GlowSquidEntityRenderer.java', 'utf8')), 'decomp glow squid light formula');
  const g = (d, b) => ER.glowSquidBlockLight({ type: 'glow_squid', darkTicksRemaining: d }, b);
  ok(g(0, 0) === 15 && g(10, 0) === 0 && g(5, 0) === 7 && g(5, 12) === 12 && ER.glowSquidBlockLight({ type: 'squid' }, 3) === 3, 'glow squid light: 15 lit, 0 dark, 7 half, max with base, plain squid unchanged');
  okAv(g(10, 0) !== g(0, 0), 'a glow squid that never dims is caught');
}
// --- #11487 part 5: FlyingItemEntityRenderer (fireball scales, lit) and FishingBobberEntityRenderer geometry (vs .decomp)
{
  const dd = (n) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + n + '.java', 'utf8');
  const reg = dd('EntityRenderers');
  ok(/field_6066, \$\$0 -> new FlyingItemEntityRenderer<>\(\$\$0, 3\.0F, true\)/.test(reg) && /field_6049, \$\$0 -> new FlyingItemEntityRenderer<>\(\$\$0, 0\.75F, true\)/.test(reg), 'decomp registers fireball 3.0 and small fireball 0.75, both lit');
  ok(ER.FIREBALL_SCALE.fireball === 3 && ER.FIREBALL_SCALE.small_fireball === 0.75, 'FIREBALL_SCALE matches the registrations');
  ok(/MIN_DISTANCE = 12\.25F/.test(dd('FlyingItemEntityRenderer')), 'decomp FlyingItem hides young items within 12.25 sq blocks');
  const m3 = ER.fireballMatrix('fireball', 0, 5, 0), m1 = ER.fireballMatrix('small_fireball', 0, 5, 0);
  ok(near(m3[0] / m1[0], 4), 'big fireball billboard is 4x the small one (3 / 0.75)');
  ok(near(m3.lift[1], 0.375) && near(m1.lift[1], 0.09375), 'ground display lift (0,2,0)/16 scaled by the entity scale');
  const bb = dd('FishingBobberEntityRenderer');
  ok(/scale\(0\.5F, 0\.5F, 0\.5F\)/.test(bb) && /16; \$\$39|\$\$39 <= 16/.test(bb) && /\* 0\.5F \+ 0\.25F/.test(bb) && /-0\.1875F/.test(bb), 'decomp bobber: scale 0.5, 16 line segments, sag *0.5+0.25, sneak -0.1875');
  const o = { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, bodyYaw: 0, prevBodyYaw: 0, swing: 0, rightArm: true, rodInMain: true, sneaking: false, eyeHeight: 1.62 };
  const b = { x: 3, y: 0, z: 3, px: 3, py: 0, pz: 3 };
  const g = ER.bobberGeometry(b, o, 0.5);
  ok(g.line.length === 17 && g.quad.length === 4, 'bobber: 17 line points, one quad');
  ok(near(Math.abs(g.quad[0].x - g.quad[1].x), 0.5) || near(Math.abs(g.quad[0].y - g.quad[3].y), 0.5), 'bobber quad is 0.5 wide');
  ok(near(g.line[0].y, 0.25), 'line starts at bobber y+0.25');
  const gs = ER.bobberGeometry(b, Object.assign({}, o, { sneaking: true }), 0.5);
  ok(near(gs.line[16].y - g.line[16].y, -0.1875), 'sneaking lowers the line end by 0.1875');
  okAv(!near(gs.line[16].y, g.line[16].y), 'a bobber line that ignores sneaking is caught');
  okAv(ER.FIREBALL_SCALE.fireball !== ER.FIREBALL_SCALE.small_fireball, 'identical fireball scales are caught');
}
// --- #11487 part 6: LivingEntityRenderer shadowRadius -- every EntityRenderer's super(ctx, model, R) vs ER.SHADOW_RADIUS (.decomp)
{
  const dir = MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/';
  const skip = new Set(['horse', 'horse_base', 'zombie_horse', 'piglin', 'zombie_base']);
  let n = 0, bad = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('EntityRenderer.java')) continue;
    const m = /super\(\$\$0, (?:.*?), ([0-9.]+)F\);/.exec(readFileSync(dir + f, 'utf8'));
    const k = f.replace('EntityRenderer.java', '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    if (!m || skip.has(k) || !(k in ER.SHADOW_RADIUS)) continue;
    n++; if (!near(ER.SHADOW_RADIUS[k], parseFloat(m[1]))) bad.push(k + ' ' + ER.SHADOW_RADIUS[k] + '!=' + m[1]);
  }
  ok(n >= 40 && bad.length === 0, 'ER.SHADOW_RADIUS matches ' + n + ' renderer constructors in .decomp' + (bad.length ? ' (' + bad.join(', ') + ')' : ''));
  okAv((() => { const s = ER.SHADOW_RADIUS.ghast; ER.SHADOW_RADIUS.ghast = 1; const r = near(ER.SHADOW_RADIUS.ghast, 1.5); ER.SHADOW_RADIUS.ghast = s; return !r; })(), 'a wrong ghast shadow radius is caught');
  ok(ER.shadowRadiusOf({ type: 'slime', size: 4 }) === 1 && ER.shadowPartRadius(ER.shadowRadiusOf({ type: 'cow' }), true) === Math.fround(0.35) && ER.shadowRadiusOf({ type: 'villager', baby: true }) === 0.25, 'slime 0.25*size; baby mob halves; baby villager 0.25');
}
// --- #11487 part 7: HoglinEntityRenderer / HoglinEntityModel.setAngles vs .decomp
{
  const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/model/HoglinEntityModel.java', 'utf8');
  ok(/lerp\(\$\$7, 0\.87266463F, \(float\) \(-Math\.PI \/ 9\)\)/.test(src) && /1\.0F - \(float\)MathHelper\.abs\(10 - 2 \* \$\$6\) \/ 10\.0F/.test(src), 'decomp hoglin head pitch: lerp(1-|10-2cd|/10, 0.87266463, -PI/9)');
  ok(/cos\(\$\$1\) \* 1\.2F \* \$\$2/.test(src) && /\$\$1 \+ \(float\) Math\.PI/.test(src), 'decomp hoglin legs: cos(l)*1.2*a, opposite pair at l+PI');
  const d = (p, cd, baby) => ER.hoglinDelta(p, 1.3, 0.6, 20, { cd }, baby);
  ok(near(d('head', 0).rx, 0) && near(d('head', 5).rx, ER.HOGLIN_HEAD_PITCH_END - ER.HOGLIN_HEAD_PITCH_START), 'hoglin head: rest at cooldown 0, full lift at 5');
  ok(Math.abs(d('head', 0).ry - 20 * Math.PI / 180) < 1e-6, 'hoglin head yaw = netHeadYaw in radians');
  ok(near(d('left_front_leg', 0).rx, Math.cos(1.3 + Math.PI) * 1.2 * 0.6) && near(d('right_hind_leg', 0).rx, d('left_front_leg', 0).rx), 'hoglin diagonal legs move together');
  ok(near(d('right_ear', 0).rz, -0.6 * Math.sin(1.3)) && near(d('left_ear', 0).rz, 0.6 * Math.sin(1.3)), 'hoglin ears flap oppositely');
  ok(d('head', 5, true).dpy === 3 && d('head', 5, false).dpy === 0, 'baby hoglin head lifts with the attack');
  okAv((() => { const s = ER.HOGLIN_HEAD_PITCH_END; ER.HOGLIN_HEAD_PITCH_END = 0; const r = near(d('head', 5).rx, -Math.PI / 9 - 0.87266463); ER.HOGLIN_HEAD_PITCH_END = s; return !r; })(), 'a wrong hoglin attack pitch is caught');
  okAv((() => { const s = ER.hoglinDelta; ER.hoglinDelta = () => ({ rx: 0, ry: 0, rz: 0 }); const r = near(d('right_ear', 0).rz, -0.6 * Math.sin(1.3)); ER.hoglinDelta = s; return !r; })(), 'a hoglin that never flaps its ears is caught');
}
// --- #11487 part 8: GhastEntityRenderer.getTexture vs .decomp
{
  const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/GhastEntityRenderer.java', 'utf8');
  ok(/isShooting\(\) \? ANGRY_TEXTURE : TEXTURE/.test(src) && /ghast\/ghast_shooting\.png/.test(src), 'decomp ghast: isShooting ? ghast_shooting : ghast');
  const G = M.Ghast;
  ok(G && G.skinKey({ type: 'ghast', shooting: true }) === 'ghast_shooting', 'shooting ghast uses ghast_shooting');
  ok(G.skinKey({ type: 'ghast', shooting: false }) === null && G.skinKey({ type: 'cow', shooting: true }) === null, 'idle ghast keeps the default sheet; other mobs untouched');
  okAv((() => { const s = G.skinKey; G.skinKey = () => null; const r = G.skinKey({ type: 'ghast', shooting: true }) === 'ghast_shooting'; G.skinKey = s; return !r; })(), 'a ghast that never shows its shooting face is caught');
  okAv((() => { const s = G.skinKey; G.skinKey = (e) => 'ghast_shooting'; const r = G.skinKey({ type: 'ghast', shooting: false }) === null; G.skinKey = s; return !r; })(), 'a ghast stuck in the shooting face is caught');
}
// --- #11487 part 9: EndermanEntityRenderer / EndermanEntityModel angry + carrying vs .decomp
{
  const rd2 = (f) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/' + f + '.java', 'utf8');
  const r = rd2('EndermanEntityRenderer'), m = rd2('model/EndermanEntityModel');
  ok(/carryingBlock = \$\$6 != null/.test(r) && /angry = \$\$0\.isAngry\(\)/.test(r) && /enderman\/enderman\.png/.test(r), 'decomp enderman: carrying = block != null, angry = isAngry');
  ok(/rightArm\.pitch = -0\.5F/.test(m) && /rightArm\.roll = 0\.05F/.test(m) && /leftArm\.roll = -0\.05F/.test(m) && /head\.pivotY -= 5\.0F/.test(m), 'decomp enderman model: carrying arms -0.5/+-0.05, angry head -5');
  const d = (part, en) => ER.setupAnimDelta(part, 0, 0, 0, 0, false, 'enderman', { enderman: en, rest: {} });
  const car = { carrying: true, angry: false }, ang = { carrying: false, angry: true }, none = { carrying: false, angry: false };
  ok(near(d('right_arm', car).rx, -0.5) && near(d('right_arm', car).rz, 0.05) && near(d('left_arm', car).rz, -0.05), 'carrying: arms pitch -0.5, roll +0.05/-0.05');
  ok(near(d('right_arm', none).rz || 0, 0) && near(d('right_arm', none).rx || 0, 0), 'idle: arms at rest');
  ok(near(d('head', ang).dpy, -5) && near(d('hat', ang).dpy, -5) && !d('head', none).dpy, 'angry: head and hat pivotY -5');
  ok(!d('body', ang).dpy && !d('head', car).dpy, 'angry only moves head/hat');
  okAv(!near(d('head', none).dpy || 0, -5), 'a calm enderman that lowers its head is caught');
  okAv(!near(d('right_arm', none).rx || 0, -0.5), 'an enderman carrying nothing with raised arms is caught');
  ok(ER.endermanCarried({ type: 'enderman' }, 0) === null && ER.endermanCarried({ type: 'cow', carriedBlock: 1 }, 0) === null, 'no block / not an enderman: nothing carried');
}
// --- #11487 part 10: BellBlockEntityRenderer swing vs .decomp
{
  const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/block/entity/BellBlockEntityRenderer.java', 'utf8');
  ok(/sin\(\$\$6 \/ \(float\) Math\.PI\) \/ \(4\.0F \+ \$\$6 \/ 3\.0F\)/.test(src) && /\$\$7 = -\$\$9;/.test(src) && /\$\$8 = -\$\$9;/.test(src), 'decomp bell: s = sin(t/PI)/(4+t/3); north/east negate');
  const f = (e, p) => { const d = ER.bellAnim(e, p).deltaFor('bell_body'); return d; };
  const t = 7.25, s = Math.sin(t / Math.PI) / (4 + t / 3);
  const b = (dir, ringing = true) => f({ ringing, ticks: 7, lastSideHit: dir }, 0.25);
  ok(near(b('north').rx, -s) && near(b('south').rx, s) && near(b('east').rz, -s) && near(b('west').rz, s), 'ringing: north/south pitch -+s, east/west roll -+s');
  ok(near(b('north').rz, 0) && near(b('east').rx, 0), 'swing only on the struck axis');
  ok(near(b('north', false).rx, 0) && near(f(null, 0).rx, 0) && ER.bellAnim({ ringing: true, ticks: 3 }, 0).deltaFor('bell_body').rx === 0, 'not ringing / unknown side: rests');
  ok(ER.bellAnim({ ringing: true, ticks: 1, lastSideHit: 'north' }, 0).deltaFor('other') === null, 'only bell_body moves');
  okAv(!near(b('south').rx, -s), 'a bell swinging the wrong way on south is caught');
  okAv(!near(b('west', false).rz, s), 'a bell that swings while not ringing is caught');
}
// --- #11487 part 11: ChestBlockEntityRenderer lid curve vs .decomp
{
  const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/block/entity/ChestBlockEntityRenderer.java', 'utf8');
  ok(/\$\$16 = 1\.0F - \$\$16;/.test(src) && /1\.0F - \$\$16 \* \$\$16 \* \$\$16/.test(src) && /\$\$2\.pitch = -\(\$\$5 \* \(float\) \(Math\.PI \/ 2\)\)/.test(src) && /\$\$3\.pitch = \$\$2\.pitch/.test(src), 'decomp chest: o=1-(1-o)^3, lid pitch=-(o*PI/2), latch copies lid');
  const cub = (o) => -(1 - Math.pow(1 - o, 3)) * Math.PI / 2;
  for (const o of [0, 0.25, 0.5, 0.75, 1]) ok(near(ER.beLidAngle(o), cub(o)), 'lid angle at openness ' + o);
  ok(near(ER.beLidAngle(1), -Math.PI / 2) && near(ER.beLidAngle(0), 0), 'closed 0, open -90deg');
  const a = ER.beLidAnim(0.5), e = cub(0.5);
  ok(near(a.deltaFor('lid').rx, e) && near(a.deltaFor('lock').rx, e) && a.deltaFor('bottom') === null, 'lid and lock share the pitch; base stays');
  okAv(!near(-0.5 * Math.PI / 2, ER.beLidAngle(0.5)), 'a linear lid is caught');
  okAv(!near(ER.beLidAngle(0.5), 0), 'a lid that does not open is caught');
}
// --- #11487 part 12: ExperienceOrbEntityRenderer UV crop + colour pulse vs .decomp
{
  const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/ExperienceOrbEntityRenderer.java', 'utf8');
  ok(/\$\$6 % 4 \* 16 \+ 16\) \/ 64\.0F/.test(src) && /\$\$6 \/ 4 \* 16 \+ 16\) \/ 64\.0F/.test(src) && /\$\$0\.age \+ \$\$2\) \/ 2\.0F/.test(src) && /\* 0\.1F \* 255\.0F/.test(src), 'decomp orb: 4x4 sheet of 16px tiles/64, t=(age+pt)/2, b scale 0.1');
  for (const i of [0, 3, 4, 7, 10]) {
    const u = ER.orbUV(i), c = i % 4, r = Math.floor(i / 4);
    ok(near(u[0], c * 16 / 64) && near(u[2], (c * 16 + 16) / 64) && near(u[1], r * 16 / 64) && near(u[3], (r * 16 + 16) / 64), 'orb icon ' + i + ' UV');
  }
  for (const [age, pt] of [[0, 0], [5, 0.5], [40, 0.25]]) {
    const t = (age + pt) / 2, c = ER.orbColorAt(age, pt);
    ok(c[0] === Math.floor((Math.sin(t) + 1) * 0.5 * 255) && c[1] === 255 && c[2] === Math.floor((Math.sin(t + Math.PI * 4 / 3) + 1) * 0.1 * 255), 'orb colour at age ' + age);
  }
  okAv(!near(ER.orbUV(5)[0], 0), 'an orb icon that ignores its column is caught');
  okAv(ER.orbColorAt(5, 0.5)[2] !== Math.floor((Math.sin(2.75) + 1) * 0.5 * 255), 'a blue channel with the red scale is caught');
}
// --- #11487 part 13: TridentRiptideFeatureRenderer passes + LivingEntityRenderer riptide spin vs .decomp
{
  const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/';
  const src = readFileSync(D + 'feature/TridentRiptideFeatureRenderer.java', 'utf8');
  const lsrc = readFileSync(D + 'LivingEntityRenderer.java', 'utf8');
  ok(/\$\$7 \* \(float\)\(-\(45 \+ \$\$11 \* 5\)\)/.test(src) && /0\.75F \* \(float\)\$\$11/.test(src) && /-0\.2F \+ 0\.6F \* \(float\)\$\$11/.test(src) && /\$\$11 < 3/.test(src), 'decomp riptide: 3 passes, rotY(age*-(45+5i)), scale .75i, ty -.2+.6i');
  ok(/cuboid\(-8\.0F, -16\.0F, -8\.0F, 16\.0F, 32\.0F, 16\.0F\)/.test(src), 'decomp riptide aura box is 16x32x16');
  ok(/getDegreesQuaternion\(-90\.0F - \$\$0\.getPitch\(\)\)/.test(lsrc) && /\+ \$\$4\) \* -75\.0F/.test(lsrc), 'decomp riptide body: rotX(-90-pitch), rotY((age+pt)*-75)');
  ok(ER.riptidePasses({ riptideTicks: 0, age: 5 }, 0.5).length === 0 && ER.riptidePasses(null, 0).length === 0, 'no passes unless riptiding');
  for (const [age, pt] of [[0, 0], [7, 0.5], [100, 0.25]]) {
    const ps = ER.riptidePasses({ riptideTicks: 3, age }, pt), t = age + pt;
    ok(ps.length === 3, 'three passes at age ' + age);
    for (let i = 0; i < 3; i++) ok(near(ps[i].rotYDeg, t * -(45 + 5 * i)) && near(ps[i].scale, 0.75 * i) && near(ps[i].ty, -0.2 + 0.6 * i), 'pass ' + i + ' at age ' + age);
  }
  ok(ER.riptidePasses({ riptideTicks: 1, age: 4 }).length === 3 && near(ER.riptidePasses({ riptideTicks: 1, age: 4 })[0].rotYDeg, 5 * -45), 'default partial is 1');
  ok(near(ER.riptidePasses({ riptideTicks: 1, age: 4 }, 0)[0].scale, 0), 'innermost pass has zero scale');
  okAv(!near(ER.riptidePasses({ riptideTicks: 1, age: 4 }, 0)[1].rotYDeg, 4 * -45), 'a pass spinning at the wrong rate (-45 for all) is caught');
  okAv(ER.riptidePasses({ riptideTicks: 1, age: 4 }, 0)[2].scale !== 0.75, 'a flat 0.75 scale is caught');
  okAv(ER.riptidePasses({ riptideTicks: 0, age: 4 }, 0).length !== 3, 'an aura drawn while not riptiding is caught');
  // player pose: spin = (age+pt)*75deg about Y, after rotX(90+pitch)
  const e = { riptideTicks: 5, age: 10, xHeadRot: 20, yaw: 0, bodyYaw: 0, prevBodyYaw: 0 };
  const P = ER.playerPoseOf(e, 0.5), P2 = ER.playerPoseOf(Object.assign({}, e, { age: 11 }), 0.5);
  const det = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  ok(P && near(det(P.R), 1) && P.dx === 0 && P.dy === 0 && P.dz === 0, 'riptide pose is a pure rotation');
  // Ry(75deg) change between consecutive ticks: R2 = R * Ry(75) in the body frame => R^T R2 is Ry(75deg) about the local up axis
  const mT = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[c * 3 + r] * b[c * 0 + 0] * 0 + [0, 1, 2].reduce((s, k) => s + a[k * 3 + r] * b[k * 3 + c], 0)); return o; };
  const D2 = mT(P.R, P2.R), a75 = 75 * Math.PI / 180;
  ok(Math.abs(D2[0] - Math.cos(a75)) < 1e-6 && Math.abs(Math.abs(D2[2]) - Math.sin(a75)) < 1e-6 && near(D2[4], 1), 'one tick of riptide turns the body 75 degrees about its own axis');
  okAv(!near(D2[0], Math.cos(45 * Math.PI / 180)), 'a 45-degree riptide spin is caught');
}
// --- #11487 part 14: EnergySwirlOverlayFeatureRenderer gate + UV offsets (wither / creeper charge) vs .decomp
{
  const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/entity/feature/';
  const base = readFileSync(D + 'EnergySwirlOverlayFeatureRenderer.java', 'utf8');
  const wsrc = readFileSync(D + 'WitherArmorFeatureRenderer.java', 'utf8');
  const csrc = readFileSync(D + 'CreeperChargeFeatureRenderer.java', 'utf8');
  ok(/\$\$3\.shouldRenderOverlay\(\)/.test(base) && /\$\$3\.age \+ \$\$6/.test(base) && /getEnergySwirlX\(\$\$10\) % 1\.0F, \$\$10 \* 0\.01F % 1\.0F/.test(base), 'decomp swirl: gate shouldRenderOverlay, f=age+pt, (x%1, f*0.01%1)');
  ok(/MathHelper\.cos\(\$\$0 \* 0\.02F\) \* 3\.0F/.test(wsrc) && /\$\$0 \* 0\.01F/.test(csrc), 'decomp swirl X: wither cos(f*0.02)*3, creeper f*0.01');
  for (const f of [0, 1.5, 37.25, 250]) {
    const w = M.CFG.swirlOffset(f, false), c = M.CFG.swirlOffset(f, true);
    ok(near(w[0], (Math.cos(f * 0.02) * 3) % 1) && near(w[1], (f * 0.01) % 1), 'wither swirl at f=' + f);
    ok(near(c[0], (f * 0.01) % 1) && near(c[1], (f * 0.01) % 1), 'creeper swirl at f=' + f);
  }
  ok(M.CFG.swirlOffset(0, false)[0] === 0 && M.CFG.swirlOffset(0, false)[1] === 0 || near(M.CFG.swirlOffset(0, false)[0], 0) , 'wither X at f=0 wraps to 0 (3 % 1)');
  ok(M.CFG.swirlOffset(300, true)[0] === 3 % 1 || near(M.CFG.swirlOffset(300, true)[0], 0), 'creeper X wraps at integer values');
  ok(ER.witherArmorOn({ type: 'wither', health: 150, maxHealth: 300 }) && !ER.witherArmorOn({ type: 'wither', health: 151, maxHealth: 300 }) && !ER.witherArmorOn({ type: 'zombie', health: 1 }) && !ER.witherArmorOn(null), 'overlay gate: health <= max/2, wither only');
  ok(ER.witherArmorOn({ type: 'wither', health: 100 }), 'default maxHealth is 300');
  okAv(!ER.witherArmorOn({ type: 'wither', health: 151, maxHealth: 300 }), 'an armour layer above half health is caught');
  okAv(!near(M.CFG.swirlOffset(10, false)[0], (10 * 0.01) % 1), 'a wither swirl with the creeper X is caught');
  okAv(!near(M.CFG.swirlOffset(10, true)[0], (Math.cos(0.2) * 3) % 1), 'a creeper swirl with the wither X is caught');
}
// --- Overlay (OverlayTexture / LivingEntityRenderer.getOverlay): hurt row vs white-flash row
{
  const src = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/client/render/OverlayTexture.java', 'utf8');
  const argb = (-1308622593 >>> 0);
  ok(/\$\$1 < 8\) \{\s*\$\$0\.setColor\(\$\$2, \$\$1, -1308622593\)/.test(src), 'decomp: rows < 8 are the hurt colour -1308622593');
  ok(/getV\(boolean \$\$0\) \{\s*return \$\$0 \? 3 : 10;/.test(src), 'decomp: getV(hurt) = 3 (hurt row) else 10 (white row)');
  ok((argb >>> 24) === 0xB2 && (argb & 0xFF) === 0xFF && ((argb >>> 8) & 0xFFFF) === 0, 'hurt colour = alpha 0xB2, pure red (ABGR)');
  const L = 'cow', n = ER.mobQuadCount(L);
  const flags = (hurt, sw) => { const out = new Uint32Array(n * 16);
    ER.emitMobLayer(out, 0, L, 0, 0, 0, 1, 0, 15, 0, 3, undefined, undefined, undefined, hurt, undefined, sw);
    const r = []; for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4;
      r.push(M.Mesher.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3])); } return r; };
  const sw = { sxz: 1, sy: 1, white: 1 };
  ok(flags(true).every((v) => v.flag === 1), 'hurt mob: every vertex carries the hurt flag');
  ok(flags(false).every((v) => v.flag === 0), 'healthy mob: no hurt flag');
  ok(flags(true, sw).every((v) => v.flag === 1 && v.white === 0), 'hurt wins over the swell white flash (getOverlay V)');
  ok(flags(false, sw).every((v) => v.flag === 0 && v.white === 1), 'swell white flash when not hurt');
  okAv(!flags(false).some((v) => v.flag === 1), 'a healthy mob flagged hurt is caught');
  okAv(!flags(true, sw).some((v) => v.white !== 0), 'a hurt mob also flashing white is caught');
}
console.log(' entityrenderauditcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   x ' + f); process.exit(1); }
