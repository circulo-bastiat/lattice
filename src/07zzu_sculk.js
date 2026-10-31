// src/07zzu_sculk.js — G17: the sculk sensor. SculkSensorListener (range, travel delay) + SculkSensorBlock
// (inactive/active/cooldown phases) + SculkSensorBlockEntity (last_vibration_frequency, getPower).
// 1.18.2 values, read from .decomp: active lasts 40 ticks (SculkSensorBlock.setActive schedules 40), cooldown 1 tick
// (setCooldown schedules 1); range 8 (Blocks.SCULK_SENSOR); delay = floor(distance). EMITTING events is the
// dependent unit 'G17: game events from entity actions' — it calls Sc.emit(name, x, y, z, entity).
(function (NS) {
  'use strict';
  var Sc = NS.Sculk = {};
  Sc.OWED = [
    'the sensor DustColorTransition glow'
  ];
  Sc.RANGE = 8; Sc.ACTIVE_TICKS = 40; Sc.COOLDOWN_TICKS = 1;
  /** SculkSensorBlock.FREQUENCIES, keyed by GameEvent name (the `vibrations` tag is exactly these keys). */
  Sc.FREQUENCIES = {
    step: 1, flap: 2, swim: 3, elytra_free_fall: 4, hit_ground: 5, splash: 6, wolf_shaking: 6, minecart_moving: 6,
    ring_bell: 6, block_change: 6, projectile_shoot: 7, drinking_finish: 7, prime_fuse: 7, projectile_land: 8,
    eat: 8, mob_interact: 8, entity_damaged: 8, equip: 9, shear: 9, ravager_roar: 9, block_close: 10,
    block_unswitch: 10, block_unpress: 10, block_detach: 10, dispense_fail: 10, block_open: 11, block_switch: 11,
    block_press: 11, block_attach: 11, entity_place: 12, block_place: 12, fluid_place: 12, entity_killed: 13,
    block_destroy: 13, fluid_pickup: 13, fishing_rod_reel_in: 14, container_close: 14, piston_contract: 14,
    shulker_close: 14, piston_extend: 15, container_open: 15, fishing_rod_cast: 15, explode: 15,
    lightning_strike: 15, shulker_open: 15
  };
  var pending = Object.create(null);   // "x,y,z" -> { event, delay, distance }
  var freq = Object.create(null);      // fallback when the block entity is missing
  function key(x, y, z) { return x + ',' + y + ',' + z; }
  function isSensor(st) { return st !== 0 && NS.States.block[st] === NS.Reg.id.sculk_sensor; }
  function phase(st) { return NS.Behave.propName(st, 'sculk_sensor_phase'); }

  /** SculkSensorBlockEntity.getPower */
  Sc.getPower = function (distance, range) { return Math.max(1, 15 - Math.floor(distance / range * 15)); };

  Sc.lastFrequency = function (x, y, z) {
    var e = NS.BlockEntities && NS.BlockEntities.get(x, y, z);
    return e && e.lastVibrationFrequency !== undefined ? e.lastVibrationFrequency : (freq[key(x, y, z)] | 0);
  };
  function setFrequency(x, y, z, f) {
    var BE = NS.BlockEntities, e = BE && BE.get(x, y, z);
    if (e) e.lastVibrationFrequency = f; else freq[key(x, y, z)] = f;
  }

  function set(x, y, z, st, ph, power) {
    var B = NS.Behave;
    st = B.setProp(B.setProp(st, 'sculk_sensor_phase', ph), 'power', power);
    NS.World.setBlock(x, y, z, st);
    B.changed(x, y, z);
  }
  /** world.playSound(null, pos, ev, BLOCKS, 1.0F, random.nextFloat() * 0.2F + 0.8F) */
  function playSound(ev, x, y, z) {
    if (!(NS.Sound && NS.Sound.play)) return;
    var rf = (NS.EntityList && NS.EntityList.random) || Math.random;
    NS.Sound.play(ev, { x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 1.0, pitch: rf() * 0.2 + 0.8, source: 'block' });
  }
  /** SculkSensorBlock.setActive */
  Sc.setActive = function (x, y, z, power) {
    set(x, y, z, NS.World.getBlock(x, y, z), 'active', power);
    NS.Behave.schedule(x, y, z, Sc.ACTIVE_TICKS, 0);
    playSound('block.sculk_sensor.clicking', x, y, z);
  };
  /** SculkSensorBlock.setCooldown */
  Sc.setCooldown = function (x, y, z) {
    set(x, y, z, NS.World.getBlock(x, y, z), 'cooldown', 0);
    NS.Behave.schedule(x, y, z, Sc.COOLDOWN_TICKS, 0);
    playSound('block.sculk_sensor.clicking_stop', x, y, z);
  };
  /** SculkSensorBlock.scheduledTick, dispatched from Behave.scheduledTick. */
  Sc.scheduledTick = function (x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    if (!isSensor(st)) return false;
    var ph = phase(st);
    if (ph === 'active') Sc.setCooldown(x, y, z);
    else if (ph === 'cooldown') set(x, y, z, st, 'inactive', NS.Behave.propName(st, 'power') | 0);
    return true;
  };

  /** World.emitGameEvent for the sculk listeners: every inactive sensor within range hears it (one at a time). */
  Sc.emit = function (name, x, y, z, entity) {
    if (!(name in Sc.FREQUENCIES)) return 0;
    if (entity && entity.spectator) return 0;
    var W = NS.World, n = 0, r = Sc.RANGE;
    for (var dx = -r; dx <= r; dx++) for (var dy = -r; dy <= r; dy++) for (var dz = -r; dz <= r; dz++) {
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) continue;
      var sx = x + dx, sy = y + dy, sz = z + dz, k = key(sx, sy, sz);
      if (pending[k]) continue;
      var st = W.getBlock(sx, sy, sz);
      if (!isSensor(st) || phase(st) !== 'inactive') continue;
      // SculkSensorBlockEntity.accepts: the sensor's own block_press / block_switch-class events at its own pos
      if (dx === 0 && dy === 0 && dz === 0 && (name === 'block_switch' || name === 'block_press')) continue;
      if (NS.GameEvent && NS.GameEvent.occluded(x, y, z, sx, sy, sz)) continue;   // isOccluded
      var dist = Math.floor(Math.sqrt(d2));
      pending[k] = { event: name, delay: dist, distance: dist };
      // ServerWorld.sendVibrationPacket -> VibrationParticle: origin block centre -> sensor, lifetime = arrival ticks
      if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('vibration', Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5, 0, 0, 0, null, null, { dx: sx, dy: sy, dz: sz, arrival: dist });
      n++;
    }
    return n;
  };

  /** SculkSensorListener.tick for every sensor, once per game tick (Behave.tick calls it). */
  Sc.tick = function () {
    for (var k in pending) {
      var p = pending[k];
      if (--p.delay > 0) continue;
      delete pending[k];
      var c = k.split(',').map(Number), st = NS.World.getBlock(c[0], c[1], c[2]);
      if (!isSensor(st) || phase(st) !== 'inactive') continue;
      setFrequency(c[0], c[1], c[2], Sc.FREQUENCIES[p.event]);
      Sc.setActive(c[0], c[1], c[2], Sc.getPower(p.distance, Sc.RANGE));
    }
  };
  Sc.reset = function () { pending = Object.create(null); freq = Object.create(null); };

  /** Comparator: `phase == active ? lastVibrationFrequency : 0`. */
  Sc.comparator = function (x, y, z, st) { return phase(st) === 'active' ? Sc.lastFrequency(x, y, z) : 0; };
})(MCL);
