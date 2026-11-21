// 02s_state.js — net/minecraft/state (#11755): StateManager, and state/property BooleanProperty, DirectionProperty, EnumProperty.
// The registry's real-state numbering IS the StateManager's state list (properties in declaration order, last varying fastest),
// so a StateManager here is a view over Reg.propFirst/propId/propStride/propVals for one block rather than a built object graph.
// Main AND workers need nothing from it; main only. Reached from Commands.stateString (F3+I copy, /data get block).
(function (NS) {
  'use strict';
  var SD = NS.StateDef = {};

  // Property: name + ordered values (strings). Mirrors Property.getName/getValues/parse/name(value)/getValueClass-less.
  function Property(name, values) { this.name = name; this.values = values; }
  Property.prototype.getName = function () { return this.name; };
  Property.prototype.getValues = function () { return this.values.slice(); };
  Property.prototype.name_ = function (v) { return String(v); };
  Property.prototype.parse = function (s) { return this.values.indexOf(s) >= 0 ? s : null; };
  Property.prototype.ordinal = function (v) { return this.values.indexOf(String(v)); };

  // BooleanProperty.of(name): values [true,false] in that order (vanilla ImmutableSet.of(true,false)).
  function BooleanProperty(name) { Property.call(this, name, ['true', 'false']); }
  BooleanProperty.prototype = Object.create(Property.prototype);
  BooleanProperty.of = function (name) { return new BooleanProperty(name); };
  BooleanProperty.prototype.parse = function (s) { return s === 'true' ? true : s === 'false' ? false : null; };

  // EnumProperty.of(name, values): values in the given order; names are the enum's asString().
  function EnumProperty(name, values) { Property.call(this, name, values.slice()); }
  EnumProperty.prototype = Object.create(Property.prototype);
  EnumProperty.of = function (name, values) { return new EnumProperty(name, values); };
  // EnumProperty.of(name, class, filter) analogue
  EnumProperty.ofFiltered = function (name, all, pred) { return new EnumProperty(name, all.filter(pred)); };

  // DirectionProperty: EnumProperty<Direction>; Direction enum order is down,up,north,south,west,east.
  var DIRECTIONS = ['down', 'up', 'north', 'south', 'west', 'east'];
  function DirectionProperty(name, values) { EnumProperty.call(this, name, values); }
  DirectionProperty.prototype = Object.create(EnumProperty.prototype);
  DirectionProperty.of = function (name, pred) {
    var vals = typeof pred === 'function' ? DIRECTIONS.filter(pred) : (pred ? pred.slice() : DIRECTIONS);
    return new DirectionProperty(name, vals);
  };
  DirectionProperty.HORIZONTAL = function (name) { return DirectionProperty.of(name, function (d) { return d !== 'down' && d !== 'up'; }); };

  SD.Property = Property; SD.BooleanProperty = BooleanProperty; SD.EnumProperty = EnumProperty; SD.DirectionProperty = DirectionProperty;
  SD.DIRECTIONS = DIRECTIONS;

  // Build the right Property class for a registry slot (boolean = values true/false, direction = subset of Direction names).
  function propertyFor(name, vals) {
    if (vals.length === 2 && vals[0] === 'true' && vals[1] === 'false') return new BooleanProperty(name);
    if ((name === 'facing' || name === 'vertical_direction' || name === 'hanging_facing') && vals.every(function (v) { return DIRECTIONS.indexOf(v) >= 0; })) return new DirectionProperty(name, vals);
    return new EnumProperty(name, vals);
  }

  // StateManager for one block (id = registry block index): properties, getStates, state <-> value maps.
  function StateManager(block) {
    var R = NS.Reg, k, props = [], slots = [];
    this.block = block;
    for (k = R.propFirst[block]; k < R.propFirst[block + 1]; k++) {
      var vals = [], off = R.propValOff[k], n = R.propValN[k];
      for (var v = 0; v < n; v++) vals.push(R.valueNames[R.propVals[off + v]]);
      props.push(propertyFor(R.propNames[R.propId[k]], vals)); slots.push(k);
    }
    this.properties = props; this.slots = slots;
    this.first = R.realFirst[block]; this.count = R.realFirst[block + 1] - R.realFirst[block];
  }
  StateManager.of = function (block) { return new StateManager(block); };
  StateManager.prototype.getProperties = function () { return this.properties.slice(); };
  StateManager.prototype.getProperty = function (name) {
    for (var i = 0; i < this.properties.length; i++) if (this.properties[i].name === name) return this.properties[i];
    return null;
  };
  StateManager.prototype.getDefaultState = function () { return this.first + NS.Reg.defaultState[this.block]; };
  StateManager.prototype.getStates = function () { var o = []; for (var i = 0; i < this.count; i++) o.push(this.first + i); return o; };
  StateManager.prototype.get = function (state, name) {
    for (var i = 0; i < this.properties.length; i++) {
      if (this.properties[i].name !== name) continue;
      var R = NS.Reg, k = this.slots[i], local = state - this.first;
      return this.properties[i].values[((local / R.propStride[k]) | 0) % R.propValN[k]];
    }
    return null;
  };
  // with(state, name, valueString): the neighbouring state (vanilla State.with); throws on bad property/value like IllegalArgumentException.
  StateManager.prototype.with = function (state, name, value) {
    for (var i = 0; i < this.properties.length; i++) {
      if (this.properties[i].name !== name) continue;
      var R = NS.Reg, k = this.slots[i], idx = this.properties[i].values.indexOf(String(value));
      if (idx < 0) throw new Error('Cannot set property ' + name + ' to ' + value);
      var local = state - this.first, cur = ((local / R.propStride[k]) | 0) % R.propValN[k];
      return state + (idx - cur) * R.propStride[k];
    }
    throw new Error('Cannot set property ' + name + ' as it does not exist');
  };
  // toString of a state as BlockArgumentParser.stringifyBlockState: sorted by name.
  StateManager.prototype.stringify = function (state) {
    var self = this, parts = this.properties.map(function (p) { return [p.name, self.get(state, p.name)]; });
    parts.sort(function (a, c) { return a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : 0; });
    return 'minecraft:' + NS.Reg.names[this.block] + (parts.length ? '[' + parts.map(function (p) { return p[0] + '=' + p[1]; }).join(',') + ']' : '');
  };
  SD.StateManager = StateManager;
})(MCL);
