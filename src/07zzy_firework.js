// 07zzy_firework.js -- #5081 (G17-P8): FireworkRocketEntity's simulation and FireworkRocketItem's use.
// Runs on: MAIN THREAD ONLY. No DOM. Particles and sound are NOT here (no particle engine is claimed).
//
// .decomp FireworkRocketEntity.java, read whole:
//   ctor:   velocity (gauss*0.001, 0.05, gauss*0.001); lifeTime = 10*Flight + nextInt(6) + nextInt(7)
//   tick(): unattached -> velocity = velocity * (horizontalCollision ? 1.0 : 1.15, 1.0, same) + (0, 0.04, 0),
//           move(velocity); hit test; life++; explode when life > lifeTime.
//           attached (shot by entity) -> position/velocity follow the shooter.
//   explode(): damage = 5 + 2*Explosions.size (0 with no stars => nothing happens); the shooter takes the full
//           damage; every other LivingEntity within squared distance 25 takes damage * sqrt((5 - dist)/5)
//           if either of two rays (feet, then body 0.5) from the rocket reaches it unobstructed.
// FireworkRocketItem.java: useOnBlock spawns at hit point + face*0.15 and ALWAYS shrinks the stack;
//   use() acts only while fall-flying (attached rocket, shrink unless creative).

(function (NS) {
  'use strict';

  var Fw = NS.Firework = { ready: true };

  Fw.RANGE = 5.0;
  Fw.BOOST = 1.5;   // FireworkRocketEntity.tick's glide boost target speed
  /** lifeTime for a Flight value, from two nextInt draws (rnd(n) -> [0,n)). */
  Fw.lifeFor = function (flight, rnd) {
    return 10 * (1 + flight) + rnd(6) + rnd(7);   // FireworkRocketEntity ctor: 10 * (1 + Flight)
  };
  Fw.fireworksTag = function (e) { return e && e.tag && e.tag.Fireworks ? e.tag.Fireworks : null; };
  Fw.explosionCount = function (e) {
    var f = Fw.fireworksTag(e);
    return f && f.Explosions ? f.Explosions.length : 0;
  };
  Fw.flightOf = function (e) {
    var f = Fw.fireworksTag(e);
    return f && f.Flight !== undefined ? f.Flight | 0 : (e.flight | 0);
  };

  /** Initialise a freshly spawned rocket (called from EL.DEFAULTS.firework_rocket). */
  Fw.init = function (e, rnd, opts) {
    // FireworkRocketEntity ctor draws from the entity's own Random (this.random): gauss x2, then nextInt(6), nextInt(7)
    var EL = NS.EntityList, jr = e.random && e.random.nextInt && !(EL && EL.random) ? e.random : null;
    var d = jr ? function () { return jr.nextDouble(); } : (EL && EL.randomOf ? EL.randomOf(e) : NS.wrand);
    rnd = rnd || (jr ? function (n) { return jr.nextInt(n); } : function (n) { return Math.floor(d() * n); });
    if (e.tag === undefined && e.color !== undefined) {   // VB.celebrate's {color, flight} bag
      e.tag = { Fireworks: { Flight: e.flight | 0, Explosions: [{ Type: 0, Colors: [e.color | 0] }] } };
    }
    if (e.vx === 0 && e.vy === 0 && e.vz === 0) {
      var g = function () { return (jr ? jr.nextGaussian() : NS.U.polarGaussian(d)) * 0.001; };
      e.vx = g(); e.vy = 0.05; e.vz = g();
    }
    if (e.lifeTime === undefined || !(opts && opts.mobNbtRestore)) {   // #5488: a reload keeps Life/LifeTime, no re-roll
      e.life = 0;
      e.lifeTime = Fw.lifeFor(Fw.flightOf(e), rnd);
    }
    e.shooter = e.shooter || null;
    e.gravity = 0;
  };

  /** One server tick of a rocket (dispatched from EL.tickOne). */
  Fw.tick = function (e) {
    if (!e || e.removed) return;
    var Ph = NS.Physics;
    if (e.shooter) {
      var sh = e.shooter;
      if (sh.fallFlying) {   // getRotationVector; v += look*0.1 + (look*1.5 - v)*0.5 per axis
        var cp = Math.cos(sh.pitch || 0), lx = Math.sin(sh.yaw || 0) * cp, ly = Math.sin(sh.pitch || 0), lz = -Math.cos(sh.yaw || 0) * cp;
        var vx = sh.vx || 0, vy = sh.vy || 0, vz = sh.vz || 0;
        sh.vx = vx + lx * 0.1 + (lx * Fw.BOOST - vx) * 0.5;
        sh.vy = vy + ly * 0.1 + (ly * Fw.BOOST - vy) * 0.5;
        sh.vz = vz + lz * 0.1 + (lz * Fw.BOOST - vz) * 0.5;
      }
      e.x = sh.x; e.y = sh.y; e.z = sh.z;
      e.vx = sh.vx || 0; e.vy = sh.vy || 0; e.vz = sh.vz || 0;
    } else {
      var k = e.horizontalCollision ? 1.0 : 1.15;
      e.vx *= k; e.vz *= k; e.vy += 0.04;
      var x0 = e.x, z0 = e.z, y0 = e.y;
      if (Ph && Ph.move) Ph.move(e, e.vx, e.vy, e.vz);
      else { e.x += e.vx; e.y += e.vy; e.z += e.vz; }
      e.horizontalCollision = !!(Ph && Ph.move && (Math.abs(e.x - x0 - e.vx) > 1e-9 || Math.abs(e.z - z0 - e.vz) > 1e-9));
      // onBlockHit: explodes at once only when the star list is non-empty (hasExplosionEffects)
      if (Fw.explosionCount(e) > 0 && Ph && Ph.move && (e.horizontalCollision || Math.abs(e.y - y0 - e.vy) > 1e-9)) {
        Fw.explodeAndRemove(e); return;
      }
    }
    if (e.life === 0 && !e.silent) Fw.sound('entity.firework_rocket.launch', e, 3.0, 1.0);   // FireworkRocketEntity.tick
    e.life++;
    if (e.life > e.lifeTime) Fw.explodeAndRemove(e);
  };

  Fw.sound = function (ev, e, vol, pitch) {
    var Snd = NS.Sound;
    if (Snd && Snd.entitySound) Snd.entitySound(ev, e.x, e.y, e.z, vol, pitch, 'ambient', NS.Player);
  };

  /** FireworksSparkParticle.Starter.tick: blast sound by shape (age 0), twinkle per Flicker star; _far at >= 16 blocks. */
  Fw.blastSounds = function (e, rnd) {
    rnd = rnd || NS.wrand;
    var ex = Fw.fireworksTag(e); ex = ex && ex.Explosions;
    if (!ex || !ex.length) return;
    var P = NS.Player, far = false;
    if (P) { var dx = P.x - e.x, dy = (P.y + (P.eyeHeight || 1.62)) - e.y, dz = P.z - e.z; far = dx * dx + dy * dy + dz * dz >= 256; }
    var large = ex.length >= 3;
    for (var i = 0; i < ex.length && !large; i++) if ((ex[i].Type | 0) === 1) large = true;
    Fw.sound('entity.firework_rocket.' + (large ? 'large_blast' : 'blast') + (far ? '_far' : ''), e, 20.0, 0.95 + rnd() * 0.1);
    for (var j = 0; j < ex.length; j++) if (ex[j].Flicker)
      Fw.sound('entity.firework_rocket.twinkle' + (far ? '_far' : ''), e, 20.0, 0.9 + rnd() * 0.15);
  };

  Fw.explodeAndRemove = function (e) {
    e.removed = true;
    Fw.blastSounds(e);
    Fw.explode(e);
    e.exploded = true;
    Fw.explosions = (Fw.explosions || 0) + 1;
  };

  Fw.clear = function (from, tx, ty, tz) {
    var Ray = NS.Ray, Ex = NS.Explosion, Ph = NS.Physics;
    if (!Ray) return true;
    var dx = tx - from.x, dy = ty - from.y, dz = tz - from.z;
    if (dx === 0 && dy === 0 && dz === 0) return true;
    var hit = Ray.cast(from.x, from.y, from.z, dx, dy, dz, 1.0, function (id) {
      if (id === 0) return false;
      var sh = Ph && Ph.shapeOf ? Ph.shapeOf(id) : null;
      return !!(sh && sh.length);
    });
    return !hit;
  };

  /** FireworkRocketEntity.explode(): returns the number of entities that took damage. */
  Fw.explode = function (e) {
    var n = Fw.explosionCount(e);
    if (n <= 0) return 0;
    var base = 5 + n * 2, hits = 0;
    var EL = NS.EntityList, Cb = NS.Combat, Sv = NS.Survival;
    var hurt = function (t, amount) {
      var ok;
      if (t === NS.Player) ok = Sv && Sv.hurt ? Sv.hurt(t, 'explosion', amount) : false;
      else ok = Cb && Cb.hurt ? Cb.hurt(t, amount, undefined, false, { attacker: e.shooter || undefined, explosive: true }) : false;
      if (ok) hits++;
    };
    if (e.shooter) hurt(e.shooter, base);
    var targets = [];
    if (NS.Player && NS.Player !== e.shooter) targets.push(NS.Player);
    if (EL && EL.list) for (var i = 0; i < EL.list.length; i++) {
      var t = EL.list[i];
      if (t !== e && t !== e.shooter && !t.removed && t.maxHealth !== undefined) targets.push(t);
    }
    for (var j = 0; j < targets.length; j++) {
      var o = targets[j];
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 25) continue;
      var seen = false;
      for (var s = 0; s < 2 && !seen; s++) seen = Fw.clear(e, o.x, o.y + (o.height || 1.8) * 0.5 * s, o.z);
      if (!seen) continue;
      hurt(o, base * Math.sqrt((5 - Math.sqrt(d2)) / 5));
    }
    return hits;
  };

  /** Spawn a rocket through EntityList; opts: tag (the stack's NBT), shooter. */
  Fw.spawn = function (x, y, z, opts) {
    var EL = NS.EntityList;
    return EL && EL.spawn ? EL.spawn('firework_rocket', x, y, z, opts) : null;
  };

  var FACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];   // ARCH §3 face order +X -X +Y -Y +Z -Z

  function spend(P, stack) {
    if (NS.Inventory && NS.Inventory.shrink) NS.Inventory.shrink(stack, 1);
    if (P && P.syncHotbar) P.syncHotbar();
  }

  /** FireworkRocketItem.useOnBlock: at the hit point + face offset * 0.15; always spends one. */
  Fw.useOnBlock = function (P, hx, hy, hz, face, stack) {
    var o = FACE[face] || [0, 0, 0];
    var tag = NS.Inventory && NS.Inventory.tagOf ? NS.Inventory.tagOf(stack) : null;
    var r = Fw.spawn(hx + o[0] * 0.15, hy + o[1] * 0.15, hz + o[2] * 0.15, { tag: tag || undefined });
    if (r) spend(P, stack);
    return !!r;
  };

  /** FireworkRocketItem.use: only while fall-flying; shrink unless creative. */
  Fw.useInAir = function (P, stack) {
    if (!P || !P.fallFlying) return false;
    var tag = NS.Inventory && NS.Inventory.tagOf ? NS.Inventory.tagOf(stack) : null;
    var r = Fw.spawn(P.x, P.y, P.z, { tag: tag || undefined, shooter: P });
    if (!r) return false;
    if (!P.instabuild) spend(P, stack);
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
