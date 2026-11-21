// 07pn_mapmarkers.js — #11737 (AUDIT-MAP net/minecraft/item). Ports, from .decomp 1.18.2:
//   MapIcon / MapIcon.Type (item/map/MapIcon.java: 27 types, id = ordinal, alwaysRender, tint, count-limit flag),
//   MapBannerMarker (getKey, getIconType by DyeColor, getNbt/fromNbt), MapFrameMarker (getKey, toNbt/fromNbt),
//   ToolMaterial (ToolMaterials.java: mining level, durability, speed, attack bonus, enchantability) and
//   ArmorMaterial (ArmorMaterials.java: base durability multiplier, protection per slot, toughness, knockback resistance).
// Loaded after 07pm_mapcontent.js; 07p_trade.js reads NS.MapMarkers.typeId for the cartographer's map decoration.
(function (NS) {
  'use strict';
  var MM = NS.MapMarkers = {};

  // MapIcon.Type, in enum order: [name, alwaysRender, tintColor(-1 none), countLimited]
  MM.TYPES = [['player', 0, -1, 1], ['frame', 1, -1, 1], ['red_marker', 0, -1, 1], ['blue_marker', 0, -1, 1],
    ['target_x', 1, -1, 0], ['target_point', 1, -1, 0], ['player_off_map', 0, -1, 1], ['player_off_limits', 0, -1, 1],
    ['mansion', 1, 5393476, 0], ['monument', 1, 3830373, 0],
    ['banner_white', 1, -1, 1], ['banner_orange', 1, -1, 1], ['banner_magenta', 1, -1, 1], ['banner_light_blue', 1, -1, 1],
    ['banner_yellow', 1, -1, 1], ['banner_lime', 1, -1, 1], ['banner_pink', 1, -1, 1], ['banner_gray', 1, -1, 1],
    ['banner_light_gray', 1, -1, 1], ['banner_cyan', 1, -1, 1], ['banner_purple', 1, -1, 1], ['banner_blue', 1, -1, 1],
    ['banner_brown', 1, -1, 1], ['banner_green', 1, -1, 1], ['banner_red', 1, -1, 1], ['banner_black', 1, -1, 1],
    ['red_x', 1, -1, 0]];
  /** MapIcon.Type.getId by name (-1 unknown). */
  MM.typeId = function (name) { for (var i = 0; i < MM.TYPES.length; i++) if (MM.TYPES[i][0] === name) return i; return -1; };
  /** MapIcon.Type.byId: clamps to the table like MathHelper.clamp. */
  MM.byId = function (id) { id = id < 0 ? 0 : id > MM.TYPES.length - 1 ? MM.TYPES.length - 1 : id | 0; var t = MM.TYPES[id]; return { id: id, name: t[0], alwaysRender: !!t[1], tint: t[2], hasTint: t[2] >= 0, countLimited: !!t[3] }; };

  // MapIcon: type, x, z, rotation (&15), text. equals/hashCode per MapIcon.java.
  MM.icon = function (type, x, z, rot, text) { return { type: type, x: x | 0, z: z | 0, rotation: rot & 15, text: text == null ? null : text }; };
  MM.iconEquals = function (a, b) { return a.type === b.type && a.rotation === b.rotation && a.x === b.x && a.z === b.z && a.text === b.text; };

  // DyeColor order (white..black), as the 16 banner icon types follow it.
  MM.DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  /** MapBannerMarker.getKey */
  MM.bannerKey = function (p) { return 'banner-' + p.x + ',' + p.y + ',' + p.z; };
  /** MapBannerMarker.getIconType: unknown colour -> BANNER_BLACK (the switch default). */
  MM.bannerIconType = function (color) { var i = MM.DYES.indexOf(color); return i < 0 ? MM.typeId('banner_black') : MM.typeId('banner_white') + i; };
  /** MapBannerMarker.getNbt / fromNbt (Pos as X/Y/Z, Color name, optional Name; default colour white). */
  MM.bannerNbt = function (m) { var o = { Pos: { X: m.pos.x, Y: m.pos.y, Z: m.pos.z }, Color: m.color }; if (m.name != null) o.Name = m.name; return o; };
  MM.bannerFromNbt = function (n) { var c = MM.DYES.indexOf(n.Color) >= 0 ? n.Color : 'white'; return { pos: { x: n.Pos.X, y: n.Pos.Y, z: n.Pos.Z }, color: c, name: n.Name != null ? n.Name : null }; };
  /** MapFrameMarker.getKey / toNbt / fromNbt */
  MM.frameKey = function (p) { return 'frame-' + p.x + ',' + p.y + ',' + p.z; };
  MM.frameNbt = function (m) { return { Pos: { X: m.pos.x, Y: m.pos.y, Z: m.pos.z }, Rotation: m.rotation | 0, EntityId: m.entityId | 0 }; };
  MM.frameFromNbt = function (n) { return { pos: { x: n.Pos.X, y: n.Pos.Y, z: n.Pos.Z }, rotation: n.Rotation | 0, entityId: n.EntityId | 0 }; };

  // ToolMaterials: [miningLevel, durability, speed, attackBonus, enchantability]
  MM.TOOL = { wood: [0, 59, 2, 0, 15], stone: [1, 131, 4, 1, 5], iron: [2, 250, 6, 2, 14], diamond: [3, 1561, 8, 3, 10], gold: [0, 32, 12, 0, 22], netherite: [4, 2031, 9, 4, 15] };
  MM.toolMaterial = function (n) { var r = MM.TOOL[n]; return r && { miningLevel: r[0], durability: r[1], miningSpeed: r[2], attackDamage: r[3], enchantability: r[4] }; };
  // ArmorMaterials: [durabilityMultiplier, [boots,leggings,chest,helmet protection], enchantability, toughness, knockbackResistance]
  MM.ARMOR = { leather: [5, [1, 2, 3, 1], 15, 0, 0], chainmail: [15, [1, 4, 5, 2], 12, 0, 0], iron: [15, [2, 5, 6, 2], 9, 0, 0], gold: [7, [1, 3, 5, 2], 25, 0, 0],
    diamond: [33, [3, 6, 8, 3], 10, 2, 0], turtle: [25, [2, 5, 6, 2], 9, 0, 0], netherite: [37, [3, 6, 8, 3], 15, 3, 0.1] };
  MM.BASE_DURABILITY = [13, 15, 16, 11];   // ArmorMaterials.BASE_DURABILITY by EquipmentSlot entity slot id (feet, legs, chest, head)
  /** ArmorMaterial.getDurability(slot) / getProtectionAmount(slot); slot 0 feet .. 3 head. */
  MM.armorDurability = function (n, slot) { return MM.BASE_DURABILITY[slot] * MM.ARMOR[n][0]; };
  MM.armorProtection = function (n, slot) { return MM.ARMOR[n][1][slot]; };
})(MCL);
