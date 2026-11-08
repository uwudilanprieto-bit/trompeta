'use strict';
/* Trompeta — panel in-game
   Carga: frida -U Gadget -l panel.js */

if (!ObjC.available) { console.log('Sin runtime ObjC'); } else { main(); }

function main() {
  var ORANGE = [1.0, 0.55, 0.16];
  var RED = [0.78, 0.24, 0.20];
  var BG = [0.08, 0.045, 0.025];
  var S = { ssl: false, traffic: false, log: [], hooks: [], ui: {}, tab: 0, sw: {} };

  function rgb(c, a) { return ObjC.classes.UIColor.colorWithRed_green_blue_alpha_(c[0], c[1], c[2], a); }
  function orange(a) { return rgb(ORANGE, a); }

  var OFF = {
    module: ['UnityFramework', 'libil2cpp.so', 'GameAssembly'],
    playerManager: 0x0, playersList: 0x0,
    listItems: 0x10, listSize: 0x18,
    playerName: 0x0, playerHealth: 0x0, playerTeam: 0x0, playerDead: 0x0, playerTransform: 0x0,
    transformPos: 0x38, transformRot: 0x44,
    camera: 0x0, cameraTransform: 0x0, viewMatrix: 0x0, fov: 0x0
  };

  var CFG = {
    esp_master: false, box: false, tracer: false, health: false, name: false, distance: false, skeleton: false,
    aimbot: false, aimkill: false, silent: false, fov: false, smooth: true, target_line: false, visible: true, safe: false
  };

  var SAFE = { fovAngle: 4.0, smoothT: 0.18, fireMs: 320 };
  var RAW = { fovAngle: 9.0, smoothT: 0.42, fireMs: 240 };
  var BASE = null, AIM = { run: false, timer: null, target: null, lastFire: 0 };

  function onToggle(key, val) {
    CFG[key] = val;
    if (key === 'esp_master') {
      ['box', 'tracer', 'health', 'name', 'distance', 'skeleton'].forEach(function (k) {
        if (S.sw[k]) S.sw[k].setOn_animated_(val, true);
        CFG[k] = val;
      });
      val ? espStart() : espStop();
    }
    if (key === 'fov') drawFov(val);
    if (key === 'safe') aplicarSafe(val);
    if (key === 'aimbot' || key === 'aimkill' || key === 'silent') {
      (val && !AIM.run) ? aimStart() : ((!CFG.aimbot && !CFG.aimkill && !CFG.silent) ? aimStop() : 0);
    }
    logLine(key + ' = ' + (val ? 'ON' : 'OFF'));
  }

  function aplicarSafe(on) {
    var p = on ? SAFE : RAW;
    if (S.sw.smooth) S.sw.smooth.setOn_animated_(true, true);
    CFG.smooth = true;
    if (S.sw.visible) S.sw.visible.setOn_animated_(true, true);
    CFG.visible = true;
    if (on) {
      ['aimkill', 'silent'].forEach(function (k) {
        if (S.sw[k]) S.sw[k].setOn_animated_(false, true);
        CFG[k] = false;
      });
      if (S.sw.aimbot) S.sw.aimbot.setOn_animated_(true, true);
      CFG.aimbot = true;
      if (!AIM.run) aimStart();
      logLine('SAFE ON · FOV ' + p.fovAngle + ' · suave ' + p.smoothT);
    } else logLine('SAFE OFF');
  }

  function stamp() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }

  function logLine(s) {
    var line = '[' + stamp() + '] ' + s;
    S.log.push(line);
    if (S.log.length > 500) S.log.shift();
    console.log(line);
    if (S.ui.box) {
      var t = S.log.slice(-16).join('\n');
      ObjC.schedule(ObjC.mainQueue, function () { S.ui.box.setText_(t); });
    }
  }

  function rp(a) { try { return ptr(a).readPointer(); } catch (e) { return NULL; } }
  function rf(a) { try { return ptr(a).readFloat(); } catch (e) { return 0; } }
  function ri(a) { try { return ptr(a).readS32(); } catch (e) { return 0; } }
  function v3(a) { return { x: rf(a), y: rf(a + 4), z: rf(a + 8) }; }
  function ok(p) { return p && !p.isNull() && p.toUInt32() > 0x10000; }

  function resolveBase() {
    for (var i = 0; i < OFF.module.length; i++) {
      var m = Process.findModuleByName(OFF.module[i]);
      if (m) { BASE = m.base; return true; }
    }
    BASE = null; return false;
  }

  function w2s(p, m, w, h) {
    var cx = p.x * m[0] + p.y * m[4] + p.z * m[8] + m[12];
    var cy = p.x * m[1] + p.y * m[5] + p.z * m[9] + m[13];
    var cz = p.x * m[2] + p.y * m[6] + p.z * m[10] + m[14];
    if (cz < 0.05) return null;
    var sx = (w / 2) * (1 + cx / cz), sy = (h / 2) * (1 - cy / cz);
    if (sx < -400 || sy < -400 || sx > w + 400 || sy > h + 400) return null;
    return { x: sx, y: sy, d: cz };
  }

  var ESP = { on: false, timer: null, win: null, layer: null, fovLayer: null, aimLayer: null, pool: [] };

  function espWindow() {
    if (ESP.win) return ESP.win;
    var scene = null;
    try {
      var sc = ObjC.classes.UIApplication.sharedApplication().connectedScenes().allObjects();
      for (var i = 0; i < sc.count(); i++) {
        if (sc.objectAtIndex_(i).$className.indexOf('WindowScene') !== -1) { scene = sc.objectAtIndex_(i); break; }
      }
    } catch (e) {}
    var w = scene
      ? ObjC.classes.UIWindow.alloc().initWithWindowScene_(scene)
      : ObjC.classes.UIWindow.alloc().initWithFrame_(ObjC.classes.UIScreen.mainScreen().bounds());
    w.setFrame_(ObjC.classes.UIScreen.mainScreen().bounds());
    w.setWindowLevel_(10000000);
    w.setBackgroundColor_(ObjC.classes.UIColor.clearColor());
    w.setUserInteractionEnabled_(false);
    w.setRootViewController_(ObjC.classes.UIViewController.alloc().init());
    var lay = ObjC.classes.CALayer.layer();
    lay.setFrame_(ObjC.classes.UIScreen.mainScreen().bounds());
    w.rootViewController().view().layer().addSublayer_(lay);
    ESP.win = w; ESP.layer = lay;
    function shape(color, wd) {
      var l = ObjC.classes.CAShapeLayer.layer();
      l.setFrame_(ObjC.classes.UIScreen.mainScreen().bounds());
      l.setFillColor_(ObjC.classes.UIColor.clearColor().CGColor());
      l.setStrokeColor_(color.CGColor());
      l.setLineWidth_(wd);
      lay.addSublayer_(l);
      return l;
    }
    ESP.fovLayer = shape(orange(0.85), 1.5);
    ESP.aimLayer = shape(orange(1), 1);
    return w;
  }

  function node(i) {
    if (ESP.pool[i]) return ESP.pool[i];
    var box = ObjC.classes.CAShapeLayer.layer();
    box.setFillColor_(ObjC.classes.UIColor.clearColor().CGColor());
    box.setStrokeColor_(orange(1).CGColor());
    box.setLineWidth_(1.5);
    ESP.layer.addSublayer_(box);
    var txt = ObjC.classes.CATextLayer.layer();
    txt.setFontSize_(9); txt.setForegroundColor_(orange(1).CGColor());
    txt.setContentsScale_(3); txt.setAlignmentMode_('left');
    ESP.layer.addSublayer_(txt);
    var tr = ObjC.classes.CAShapeLayer.layer();
    tr.setFillColor_(ObjC.classes.UIColor.clearColor().CGColor());
    tr.setStrokeColor_(orange(0.6).CGColor()); tr.setLineWidth_(1);
    ESP.layer.addSublayer_(tr);
    ESP.pool[i] = { box: box, txt: txt, tr: tr };
    return ESP.pool[i];
  }

  function hideFrom(i) {
    for (; i < ESP.pool.length; i++) {
      ESP.pool[i].box.setHidden_(true); ESP.pool[i].txt.setHidden_(true); ESP.pool[i].tr.setHidden_(true);
    }
  }

  function drawFov(on) {
    if (!ESP.fovLayer) return;
    if (!on) { ESP.fovLayer.setPath_(null); return; }
    var b = ObjC.classes.UIScreen.mainScreen().bounds(), r = 130;
    ESP.fovLayer.setPath_(ObjC.classes.UIBezierPath.bezierPathWithOvalInRect_({
      origin: { x: b.size.width / 2 - r, y: b.size.height / 2 - r },
      size: { width: r * 2, height: r * 2 }
    }).CGPath());
  }

  function escena() {
    if (!BASE && !resolveBase()) return null;
    var pm = rp(BASE.add(OFF.playerManager));
    if (!ok(pm)) return null;
    var list = rp(pm.add(OFF.playersList));
    if (!ok(list)) return null;
    var items = rp(list.add(OFF.listItems));
    var size = ri(list.add(OFF.listSize));
    if (!ok(items) || size <= 0 || size > 200) return null;
    var cam = rp(BASE.add(OFF.camera));
    if (!ok(cam)) return null;
    var m = [];
    for (var k = 0; k < 16; k++) m.push(rf(cam.add(OFF.viewMatrix + k * 4)));
    if (!m[0] && !m[5]) return null;
    var local = rp(BASE.add(OFF.playerManager + 4));
    return { pm: pm, items: items, size: size, cam: cam, m: m, myTeam: ok(local) ? ri(local.add(OFF.playerTeam)) : -1 };
  }

  function render() {
    var e = escena();
    if (!e) return;
    var b = ObjC.classes.UIScreen.mainScreen().bounds(), W = b.size.width, H = b.size.height;
    var drawn = 0;
    for (var i = 0; i < e.size && drawn < 40; i++) {
      var p = rp(e.items.add(0x20 + i * 8));
      if (!ok(p)) continue;
      if (ri(p.add(OFF.playerDead)) === 1) continue;
      if (e.myTeam >= 0 && ri(p.add(OFF.playerTeam)) === e.myTeam) continue;
      if (rf(p.add(OFF.playerHealth)) <= 0) continue;
      var tr = rp(p.add(OFF.playerTransform));
      if (!ok(tr)) continue;
      var pos = v3(tr.add(OFF.transformPos));
      var feet = w2s(pos, e.m, W, H);
      if (!feet) continue;
      var head = w2s({ x: pos.x, y: pos.y + 1.75, z: pos.z }, e.m, W, H);
      if (!head) continue;
      var hgt = feet.y - head.y;
      if (hgt < 6 || hgt > 700) continue;
      var wid = hgt * 0.42, n = node(drawn);
      if (CFG.box) {
        n.box.setPath_(ObjC.classes.UIBezierPath.bezierPathWithRect_({
          origin: { x: feet.x - wid / 2, y: head.y }, size: { width: wid, height: hgt }
        }).CGPath());
        n.box.setHidden_(false);
      } else n.box.setHidden_(true);
      if (CFG.tracer) {
        var pt = ObjC.classes.UIBezierPath.bezierPath();
        pt.moveToPoint_({ x: W / 2, y: H });
        pt.addLineToPoint_({ x: feet.x, y: head.y });
        n.tr.setPath_(pt.CGPath());
        n.tr.setHidden_(false);
      } else n.tr.setHidden_(true);
      var lb = '';
      if (CFG.name) {
        var sp = rp(p.add(OFF.playerName));
        if (ok(sp)) { try { lb = sp.add(0x14).readUtf16String(20) || ''; } catch (x) {} }
      }
      if (CFG.distance) lb += (lb ? ' ' : '') + Math.round(feet.d) + 'm';
      if (lb) {
        n.txt.setString_(lb);
        n.txt.setFrame_({ x: feet.x - wid / 2, y: head.y - 12, width: 140, height: 12 });
        n.txt.setHidden_(false);
      } else n.txt.setHidden_(true);
      drawn++;
    }
    hideFrom(drawn);
  }

  function espStart() {
    if (ESP.on) return;
    ESP.on = true; espWindow(); ESP.win.setHidden_(false);
    ESP.timer = setInterval(function () {
      ObjC.schedule(ObjC.mainQueue, function () { try { render(); } catch (e) {} });
    }, 66);
    logLine('ESP iniciado · base=' + (BASE ? BASE : 'sin resolver'));
  }

  function espStop() {
    ESP.on = false;
    if (ESP.timer) { clearInterval(ESP.timer); ESP.timer = null; }
    hideFrom(0);
    if (ESP.fovLayer) ESP.fovLayer.setPath_(null);
    if (ESP.win) ESP.win.setHidden_(true);
    logLine('ESP detenido');
  }

  function quatToFwd(q) {
    return { x: 2 * (q.x * q.z + q.w * q.y), y: 2 * (q.y * q.z - q.w * q.x), z: 1 - 2 * (q.x * q.x + q.y * q.y) };
  }

  function dirToQuat(d) {
    var hyp = Math.sqrt(d.x * d.x + d.z * d.z);
    var yaw = Math.atan2(d.x, d.z), pitch = -Math.atan2(d.y, hyp);
    var cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    var cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return { x: sy * cp, y: cy * sp, z: -sy * sp, w: cy * cp };
  }

  function slerp(a, b, t) {
    var d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    if (d < 0) { b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; d = -d; }
    if (d > 0.9995) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t };
    }
    var th = Math.acos(d), s = Math.sin(th);
    var s1 = Math.sin((1 - t) * th) / s, s2 = Math.sin(t * th) / s;
    return { x: a.x * s1 + b.x * s2, y: a.y * s1 + b.y * s2, z: a.z * s1 + b.z * s2, w: a.w * s1 + b.w * s2 };
  }

  function norm(v) {
    var l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return l ? { x: v.x / l, y: v.y / l, z: v.z / l } : v;
  }

  var HID = null;

  function tapCentro() {
    try {
      if (!HID) {
        var c = Module.findExportByName('IOKit', 'IOHIDEventCreateDigitizerEvent');
        var mt = Module.findExportByName('libSystem.B.dylib', 'mach_absolute_time');
        if (!c || !mt) throw new Error('sin IOKit');
        HID = {
          c: new NativeFunction(c, 'pointer', ['pointer', 'pointer', 'int', 'int', 'int', 'int', 'int', 'double', 'double', 'double', 'double', 'double', 'int', 'int', 'int']),
          t: new NativeFunction(mt, 'uint64', [])
        };
      }
      var b = ObjC.classes.UIScreen.mainScreen().bounds();
      var cx = b.size.width / 2, cy = b.size.height / 2;
      var app = ObjC.classes.UIApplication.sharedApplication();
      var ts = Memory.alloc(8);
      function ev(range, touch) {
        ts.writeU64(HID.t());
        var e = HID.c(NULL, ts, 2, 0, 0, 7, 0, cx, cy, 0, 0, 0, range, touch, 0);
        app._enqueueHIDEvent_(e);
      }
      ev(1, 1);
      setTimeout(function () { try { ev(0, 0); } catch (e) {} }, 30);
    } catch (e) {}
  }

  function aimTick() {
    if (!CFG.aimbot && !CFG.aimkill && !CFG.silent) return;
    var e = escena();
    if (!e) return;
    var b = ObjC.classes.UIScreen.mainScreen().bounds(), W = b.size.width, H = b.size.height;
    var ct = rp(e.cam.add(OFF.cameraTransform));
    if (!ok(ct)) return;
    var cpos = v3(ct.add(OFF.transformPos));
    var cur = { x: rf(ct.add(OFF.transformRot)), y: rf(ct.add(OFF.transformRot + 4)), z: rf(ct.add(OFF.transformRot + 8)), w: rf(ct.add(OFF.transformRot + 12)) };
    if (!cur.w) return;
    var fwd = norm(quatToFwd(cur));
    var p = CFG.safe ? SAFE : RAW;
    var best = null, bestA = 999;
    for (var i = 0; i < e.size; i++) {
      var pl = rp(e.items.add(0x20 + i * 8));
      if (!ok(pl)) continue;
      if (ri(pl.add(OFF.playerDead)) === 1) continue;
      if (e.myTeam >= 0 && ri(pl.add(OFF.playerTeam)) === e.myTeam) continue;
      if (rf(pl.add(OFF.playerHealth)) <= 0) continue;
      var tr = rp(pl.add(OFF.playerTransform));
      if (!ok(tr)) continue;
      var pp = v3(tr.add(OFF.transformPos));
      var scr = w2s({ x: pp.x, y: pp.y + 1.3, z: pp.z }, e.m, W, H);
      if (!scr) continue;
      var dir = norm({ x: pp.x - cpos.x, y: pp.y + 1.3 - cpos.y, z: pp.z - cpos.z });
      var ang = Math.acos(Math.max(-1, Math.min(1, dir.x * fwd.x + dir.y * fwd.y + dir.z * fwd.z))) * 180 / Math.PI;
      if (ang > p.fovAngle) continue;
      if (CFG.visible && scr.d > 320) continue;
      if (ang < bestA) { bestA = ang; best = { pos: pp, scr: scr, dir: dir }; }
    }
    AIM.target = best;
    if (best) {
      var tq = dirToQuat(best.dir);
      var t = (CFG.silent || CFG.aimkill || !CFG.smooth) ? 1 : p.smoothT;
      var nq = slerp(cur, tq, t);
      try {
        ptr(ct.add(OFF.transformRot)).writeFloat(nq.x);
        ptr(ct.add(OFF.transformRot + 4)).writeFloat(nq.y);
        ptr(ct.add(OFF.transformRot + 8)).writeFloat(nq.z);
        ptr(ct.add(OFF.transformRot + 12)).writeFloat(nq.w);
      } catch (x) {}
      if (CFG.target_line && ESP.aimLayer) {
        var bp = ObjC.classes.UIBezierPath.bezierPath();
        bp.moveToPoint_({ x: W / 2, y: H / 2 });
        bp.addLineToPoint_({ x: best.scr.x, y: best.scr.y });
        ESP.aimLayer.setPath_(bp.CGPath());
      }
      if (CFG.aimkill) {
        var now = Date.now();
        if (now - AIM.lastFire > p.fireMs) { AIM.lastFire = now; tapCentro(); }
      }
    } else if (ESP.aimLayer) ESP.aimLayer.setPath_(null);
  }

  function aimStart() {
    if (AIM.run) return;
    AIM.run = true;
    espWindow();
    AIM.timer = setInterval(function () {
      ObjC.schedule(ObjC.mainQueue, function () { try { aimTick(); } catch (e) {} });
    }, 20);
    logLine('AIM activo');
  }

  function aimStop() {
    AIM.run = false; AIM.target = null;
    if (AIM.timer) { clearInterval(AIM.timer); AIM.timer = null; }
    if (ESP.aimLayer) ESP.aimLayer.setPath_(null);
    logLine('AIM detenido');
  }

  function enableSSL() {
    if (S.ssl) return;
    try {
      var sec = Process.getModuleByName('Security');
      S.hooks.push(Interceptor.attach(sec.getExportByName('SecTrustEvaluateWithError'), {
        onLeave: function (r) { r.replace(ptr(1)); var e = this.context.x1; if (!e.isNull()) e.writePointer(ptr(0)); }
      }));
      S.hooks.push(Interceptor.attach(sec.getExportByName('SecTrustEvaluate'), { onLeave: function (r) { r.replace(0); } }));
    } catch (e) { logLine('SecTrust: ' + e); }
    try {
      var mod = Process.findModuleByName('libboringssl.dylib');
      if (mod) {
        var okc = new NativeCallback(function () { return 0; }, 'int', ['pointer', 'pointer']);
        ['SSL_CTX_set_custom_verify', 'SSL_set_custom_verify'].forEach(function (n) {
          var f = mod.findExportByName(n);
          if (f) S.hooks.push(Interceptor.attach(f, { onEnter: function (a) { a[2] = okc; } }));
        });
        var sv = mod.findExportByName('SSL_CTX_set_verify');
        if (sv) S.hooks.push(Interceptor.attach(sv, { onEnter: function (a) { a[1] = ptr(0); a[2] = ptr(0); } }));
        var gv = mod.findExportByName('SSL_get_verify_result');
        if (gv) S.hooks.push(Interceptor.attach(gv, { onLeave: function (r) { r.replace(0); } }));
      }
    } catch (e) { logLine('BoringSSL: ' + e); }
    S.ssl = true; logLine('SSL bypass ON');
  }

  function disableSSL() {
    S.hooks.forEach(function (h) { try { h.detach(); } catch (e) {} });
    S.hooks = []; S.ssl = false; logLine('SSL bypass OFF');
  }

  var tHooks = [];

  function hookTraffic() {
    if (S.traffic) return;
    function dump(a) {
      try {
        var req = new ObjC.Object(a[2]);
        var line = req.HTTPMethod().toString() + ' ' + req.URL().absoluteString().toString();
        var bd = req.HTTPBody();
        if (bd && !bd.isNull()) {
          var ns = ObjC.classes.NSString.alloc().initWithData_encoding_(bd, 4);
          if (ns) line += '\n  -> ' + ns.toString().substring(0, 700);
        }
        var h = req.allHTTPHeaderFields();
        if (h && !h.isNull()) {
          var au = h.objectForKey_('Authorization');
          if (au) line += '\n  auth: ' + au.toString().substring(0, 80);
        }
        logLine(line);
      } catch (e) {}
    }
    ['- dataTaskWithRequest:completionHandler:', '- dataTaskWithRequest:'].forEach(function (s) {
      var m = ObjC.classes.NSURLSession[s];
      if (m) tHooks.push(Interceptor.attach(m.implementation, { onEnter: dump }));
    });
    S.traffic = true; logLine('Log de tráfico ON');
  }

  function unhookTraffic() {
    tHooks.forEach(function (h) { try { h.detach(); } catch (e) {} });
    tHooks = []; S.traffic = false; logLine('Log de tráfico OFF');
  }

  function searchClasses(p) {
    var re;
    try { re = new RegExp(p, 'i'); } catch (e) { logLine('Regex inválido'); return; }
    var hits = Object.keys(ObjC.classes).filter(function (n) { return re.test(n); }).slice(0, 60);
    logLine('Clases: ' + hits.length);
    hits.forEach(function (h) {
      var c = '';
      try { c = ' metodos=' + Object.keys(ObjC.classes[h].$ownMethods).length; } catch (e) {}
      logLine('  ' + h + c);
    });
  }

  /* ================= RESOLVEDOR AUTOMATICO ================= */
  var il2 = null;

  function il2init() {
    if (il2) return true;
    function ex(n) { return Module.findExportByName(null, n); }
    var req = ['il2cpp_domain_get', 'il2cpp_domain_get_assemblies', 'il2cpp_assembly_get_image',
               'il2cpp_class_from_name', 'il2cpp_class_get_field_from_name', 'il2cpp_field_get_offset',
               'il2cpp_class_get_static_field_data'];
    for (var i = 0; i < req.length; i++) if (!ex(req[i])) return false;
    il2 = {
      dom: new NativeFunction(ex('il2cpp_domain_get'), 'pointer', []),
      asm: new NativeFunction(ex('il2cpp_domain_get_assemblies'), 'pointer', ['pointer', 'pointer']),
      img: new NativeFunction(ex('il2cpp_assembly_get_image'), 'pointer', ['pointer']),
      cls: new NativeFunction(ex('il2cpp_class_from_name'), 'pointer', ['pointer', 'pointer', 'pointer']),
      fld: new NativeFunction(ex('il2cpp_class_get_field_from_name'), 'pointer', ['pointer', 'pointer']),
      off: new NativeFunction(ex('il2cpp_field_get_offset'), 'int', ['pointer'])
    };
    return true;
  }

  function imgs() {
    var n = Memory.alloc(8);
    var arr = il2.asm(il2.dom(), n);
    var c = n.readU64().toNumber();
    var out = [];
    for (var i = 0; i < c && i < 300; i++) out.push(arr.add(i * 8).readPointer());
    return out;
  }

  function findClass(names) {
    var is = imgs();
    for (var i = 0; i < is.length; i++) {
      for (var j = 0; j < names.length; j++) {
        var c = il2.cls(is[i], Memory.allocUtf8String(names[j]), Memory.allocUtf8String(''));
        if (!c.isNull()) return c;
      }
    }
    return null;
  }

  function findField(cls, names) {
    for (var i = 0; i < names.length; i++) {
      var f = il2.fld(cls, Memory.allocUtf8String(names[i]));
      if (!f.isNull()) return il2.off(f);
    }
    return -1;
  }

  function autoOffsets() {
    if (!il2init()) { logLine('sin API il2cpp'); return false; }
    logLine('resolviendo offsets...');
    var mgr = findClass(['PlayerManager', 'GameManager', 'MatchManager', 'InGameManager', 'PlayerManagerGame']);
    if (!mgr) { logLine('manager no encontrado'); return false; }
    OFF.playerManager = findField(mgr, ['instance', 'm_Instance', 'Instance', 's_Instance']);
    OFF.playersList = findField(mgr, ['players', 'm_Players', 'allPlayers', 'Players', 'playerList']);
    if (OFF.playerManager < 0 || OFF.playersList < 0) { logLine('campos del manager no encontrados'); return false; }
    var pl = findClass(['Player', 'PlayerInfo', 'Avatar', 'PlayerEntity']);
    if (pl) {
      OFF.playerName = Math.max(0, findField(pl, ['name', 'm_Name', 'nickName', 'PlayerName']));
      OFF.playerHealth = Math.max(0, findField(pl, ['health', 'hp', 'm_Health', 'Health']));
      OFF.playerTeam = Math.max(0, findField(pl, ['team', 'teamId', 'm_Team', 'Team']));
      OFF.playerDead = Math.max(0, findField(pl, ['isDead', 'dead', 'm_IsDead']));
      OFF.playerTransform = Math.max(0, findField(pl, ['transform', 'm_Transform', 'Transform']));
    }
    var cam = findClass(['Camera', 'GameCamera']);
    if (cam) {
      OFF.camera = Math.max(0, findField(cam, ['main', 'm_Main', 'MainCamera']));
      OFF.cameraTransform = Math.max(0, findField(cam, ['m_Transform', 'transform']));
      OFF.viewMatrix = Math.max(0, findField(cam, ['m_WorldToCameraMatrix', 'worldToCameraMatrix']));
    }
    logLine('PM=' + OFF.playerManager.toString(16) + ' LIST=' + OFF.playersList.toString(16) +
            ' HP=' + OFF.playerHealth.toString(16) + ' TR=' + OFF.playerTransform.toString(16));
    return true;
  }
  /* ========================================================= */

  var H = ObjC.registerClass({
    name: 'FFPanelHandler',
    superclass: ObjC.classes.NSObject,
    methods: {
      '- close:': { retval: 'void', args: ['id'], implementation: function () { S.ui.win.setHidden_(true); } },
      '- open:': { retval: 'void', args: ['id'], implementation: function () { S.ui.win.setHidden_(false); } },
      '- tab:': { retval: 'void', args: ['id'], implementation: function (s) { setTab(s.tag()); } },
      '- sw:': { retval: 'void', args: ['id'], implementation: function (s) { onToggle(s.tag(), s.isOn()); } },
      '- tool:': { retval: 'void', args: ['id'], implementation: function (s) {
        var t = s.tag();
        if (t === 0) { S.ssl ? disableSSL() : enableSSL(); s.setTitle_forState_(S.ssl ? 'SSL BYPASS  ON' : 'SSL BYPASS  OFF', 0); }
        if (t === 1) { S.traffic ? unhookTraffic() : hookTraffic(); s.setTitle_forState_(S.traffic ? 'LOG TRAFICO  ON' : 'LOG TRAFICO  OFF', 0); }
        if (t === 2) { var p = S.ui.field.text().toString(); if (p) searchClasses(p); else logLine('Escribe un patrón'); }
        if (t === 3) { ObjC.classes.UIPasteboard.generalPasteboard().setString_(S.log.join('\n')); logLine('Log copiado'); }
        if (t === 4) { S.log = []; S.ui.box.setText_(''); }
        if (t === 5) { autoOffsets(); }
      } },
      '- drag:': { retval: 'void', args: ['id'], implementation: function (g) {
        var t = g.translationInView_(S.ui.root), c = S.ui.root.center();
        S.ui.root.setCenter_({ x: c.x + t.x, y: c.y + t.y });
        g.setTranslation_inView_({ x: 0, y: 0 }, S.ui.root);
      } },
      '- dragFab:': { retval: 'void', args: ['id'], implementation: function (g) {
        var t = g.translationInView_(S.ui.win), c = S.ui.fab.center();
        S.ui.fab.setCenter_({ x: c.x + t.x, y: c.y + t.y });
        g.setTranslation_inView_({ x: 0, y: 0 }, S.ui.win);
      } }
    }
  });

  function label(x, y, w, h, txt, size, color, bold) {
    var l = ObjC.classes.UILabel.alloc().initWithFrame_({ x: x, y: y, width: w, height: h });
    l.setText_(txt); l.setTextColor_(color);
    l.setFont_(bold ? ObjC.classes.UIFont.boldSystemFontOfSize_(size) : ObjC.classes.UIFont.fontWithName_size_('Menlo', size));
    return l;
  }

  function button(x, y, w, h, txt, tag, sel) {
    var b = ObjC.classes.UIButton.buttonWithType_(0);
    b.setFrame_({ x: x, y: y, width: w, height: h });
    b.setTitle_forState_(txt, 0);
    b.setTitleColor_forState_(orange(1), 0);
    b.titleLabel().setFont_(ObjC.classes.UIFont.fontWithName_size_('Menlo-Bold', 10));
    b.setTag_(tag);
    b.addTarget_action_forControlEvents_(S.h, ObjC.selector(sel), 1 << 6);
    return b;
  }

  function row(parent, key, txt, y) {
    parent.addSubview_(label(14, y + 9, 190, 16, txt, 10, orange(0.95), false));
    var sw = ObjC.classes.UISwitch.alloc().initWithFrame_({ x: 232, y: y + 3, width: 51, height: 31 });
    sw.setOnTintColor_(orange(1));
    sw.setThumbTintColor_(ObjC.classes.UIColor.whiteColor());
    try { sw.setTransform_({ a: 0.72, b: 0, c: 0, d: 0.72, tx: 0, ty: 0 }); } catch (e) {}
    sw.setTag_(key);
    sw.addTarget_action_forControlEvents_(S.h, ObjC.selector('sw:'), 1 << 12);
    parent.addSubview_(sw);
    S.sw[key] = sw;
  }

  function setTab(i) {
    S.tab = i;
    [0, 1, 2].forEach(function (n) {
      var b = S.ui.tabs[n], v = S.ui.views[n];
      if (n === i) {
        b.setBackgroundColor_(orange(1));
        b.setTitleColor_forState_(rgb([0.10, 0.05, 0.02], 1), 0);
        v.setHidden_(false);
      } else {
        b.setBackgroundColor_(rgb([0.13, 0.07, 0.04], 1));
        b.setTitleColor_forState_(orange(0.9), 0);
        v.setHidden_(true);
      }
    });
  }

  var W = 300, HH = 372;

  function build() {
    var scene = null;
    try {
      var sc = ObjC.classes.UIApplication.sharedApplication().connectedScenes().allObjects();
      for (var i = 0; i < sc.count(); i++) {
        if (sc.objectAtIndex_(i).$className.indexOf('WindowScene') !== -1) { scene = sc.objectAtIndex_(i); break; }
      }
    } catch (e) {}

    var win = scene
      ? ObjC.classes.UIWindow.alloc().initWithWindowScene_(scene)
      : ObjC.classes.UIWindow.alloc().initWithFrame_(ObjC.classes.UIScreen.mainScreen().bounds());
    win.setFrame_({ x: 30, y: 100, width: W, height: HH });
    win.setWindowLevel_(10000001);
    win.setBackgroundColor_(ObjC.classes.UIColor.clearColor());
    S.ui.win = win;

    var root = ObjC.classes.UIView.alloc().initWithFrame_({ x: 0, y: 0, width: W, height: HH });
    root.setBackgroundColor_(rgb(BG, 0.97));
    root.layer().setBorderWidth_(1);
    root.layer().setBorderColor_(orange(0.85).CGColor());
    root.layer().setCornerRadius_(2);
    root.setClipsToBounds_(true);
    S.ui.root = root;

    var head = ObjC.classes.UIView.alloc().initWithFrame_({ x: 0, y: 0, width: W, height: 30 });
    head.setBackgroundColor_(rgb([0.16, 0.085, 0.045], 1));
    root.addSubview_(head);

    var title = label(0, 7, W, 16, 'Trompeta', 12, orange(1), true);
    title.setTextAlignment_(1);
    head.addSubview_(title);

    var close = button(W - 28, 4, 22, 22, '✕', 0, 'close:');
    close.setBackgroundColor_(rgb(RED, 1));
    close.setTitleColor_forState_(ObjC.classes.UIColor.whiteColor(), 0);
    close.titleLabel().setFont_(ObjC.classes.UIFont.boldSystemFontOfSize_(12));
    head.addSubview_(close);

    head.addGestureRecognizer_(ObjC.classes.UIPanGestureRecognizer.alloc().initWithTarget_action_(S.h, ObjC.selector('drag:')));

    var tabBar = ObjC.classes.UIView.alloc().initWithFrame_({ x: 0, y: HH - 36, width: W, height: 36 });
    tabBar.setBackgroundColor_(rgb([0.10, 0.055, 0.03], 1));
    root.addSubview_(tabBar);
    S.ui.tabs = [];

    ['ESP', 'AIM', 'FAKHER'].forEach(function (t, i) {
      var b = button((W / 3) * i, 0, W / 3, 36, t, i, 'tab:');
      b.titleLabel().setFont_(ObjC.classes.UIFont.boldSystemFontOfSize_(11));
      tabBar.addSubview_(b);
      S.ui.tabs.push(b);
    });

    var ay = 30, ah = HH - 66;
    S.ui.views = [];

    function newView() {
      var v = ObjC.classes.UIView.alloc().initWithFrame_({ x: 0, y: ay, width: W, height: ah });
      root.addSubview_(v); S.ui.views.push(v); return v;
    }

    var vEsp = newView();
    row(vEsp, 'esp_master', 'ESP MASTER', 6);
    row(vEsp, 'box', 'PLAYER BOX', 40);
    row(vEsp, 'tracer', 'TOP TRACER', 74);
    row(vEsp, 'health', 'HEALTH BAR', 108);
    row(vEsp, 'name', 'PLAYER NAME', 142);
    row(vEsp, 'distance', 'DISTANCE', 176);
    row(vEsp, 'skeleton', 'SKELETON', 210);

    var vAim = newView();
    row(vAim, 'safe', 'SAFE MODE', 6);
    row(vAim, 'aimbot', 'AIMBOT', 40);
    row(vAim, 'aimkill', 'AIMKILL', 74);
    row(vAim, 'silent', 'SILENT AIM', 108);
    row(vAim, 'fov', 'FOV CIRCLE', 142);
    row(vAim, 'smooth', 'AIM SMOOTH', 176);
    row(vAim, 'target_line', 'TARGET LINE', 210);
    row(vAim, 'visible', 'VISIBLE CHECK', 244);

    var vFak = newView();
    vFak.addSubview_(button(14, 8, W - 28, 30, 'SSL BYPASS  OFF', 0, 'tool:'));
    vFak.addSubview_(button(14, 42, W - 28, 30, 'LOG TRAFICO  OFF', 1, 'tool:'));

    var field = ObjC.classes.UITextField.alloc().initWithFrame_({ x: 14, y: 80, width: 176, height: 30 });
    field.setPlaceholder_('patron de clase');
    field.setTextColor_(orange(1));
    field.setFont_(ObjC.classes.UIFont.fontWithName_size_('Menlo', 10));
    field.setBackgroundColor_(rgb([0.14, 0.075, 0.04], 1));
    field.setAutocorrectionType_(1);
    field.setAutocapitalizationType_(0);
    field.layer().setCornerRadius_(2);
    field.setLeftView_(ObjC.classes.UIView.alloc().initWithFrame_({ x: 0, y: 0, width: 8, height: 30 }));
    field.setLeftViewMode_(3);
    vFak.addSubview_(field);
    S.ui.field = field;

    var sb = button(196, 80, 90, 30, 'BUSCAR', 2, 'tool:');
    sb.setBackgroundColor_(rgb([0.14, 0.075, 0.04], 1));
    vFak.addSubview_(sb);

    var rb = button(14, 114, W - 28, 28, 'AUTO OFFSETS', 5, 'tool:');
    rb.setBackgroundColor_(rgb([0.14, 0.075, 0.04], 1));
    vFak.addSubview_(rb);

    var cb = button(14, 146, 130, 28, 'COPIAR LOG', 3, 'tool:');
    cb.setBackgroundColor_(rgb([0.14, 0.075, 0.04], 1));
    vFak.addSubview_(cb);

    var cl = button(156, 146, 130, 28, 'LIMPIAR', 4, 'tool:');
    cl.setBackgroundColor_(rgb([0.14, 0.075, 0.04], 1));
    vFak.addSubview_(cl);

    var box = ObjC.classes.UITextView.alloc().initWithFrame_({ x: 14, y: 180, width: W - 28, height: ah - 188 });
    box.setBackgroundColor_(rgb([0, 0, 0], 0.5));
    box.setTextColor_(rgb([0.72, 1.0, 0.72], 1));
    box.setFont_(ObjC.classes.UIFont.fontWithName_size_('Menlo', 8));
    box.setEditable_(false);
    vFak.addSubview_(box);
    S.ui.box = box;

    var fab = ObjC.classes.UIButton.buttonWithType_(0);
    fab.setFrame_({ x: 18, y: 300, width: 46, height: 46 });
    fab.setTitle_forState_('T', 0);
    fab.setBackgroundColor_(orange(0.92));
    fab.setTitleColor_forState_(rgb([0.10, 0.05, 0.02], 1), 0);
    fab.titleLabel().setFont_(ObjC.classes.UIFont.boldSystemFontOfSize_(20));
    fab.layer().setCornerRadius_(23);
    fab.addTarget_action_forControlEvents_(S.h, ObjC.selector('open:'), 1 << 6);
    fab.addGestureRecognizer_(ObjC.classes.UIPanGestureRecognizer.alloc().initWithTarget_action_(S.h, ObjC.selector('dragFab:')));
    win.addSubview_(fab);
    S.ui.fab = fab;

    win.setRootViewController_(ObjC.classes.UIViewController.alloc().init());
    win.rootViewController().view().addSubview_(root);
    win.setHidden_(false);

    setTab(1);
    resolveBase();
    autoOffsets();
    logLine('Panel listo · base=' + (BASE ? BASE : 'no encontrada'));
  }

  S.h = H.alloc().init();

  var n = 0;
  var timer = setInterval(function () {
    n++;
    if (ObjC.classes.UIApplication.sharedApplication() && n > 4) {
      clearInterval(timer);
      try { build(); } catch (e) { console.log('UI: ' + e); }
    }
    if (n > 120) clearInterval(timer);
  }, 500);
}
