/*
 * padavan-tw：黑潮 DNS 子頁組（docs/HANDOFF-UI.md 第 13 節）
 * 移植自黑潮 DNS v3.2.0 的 LuCI 介面（openwrt/luci-app-kuroshio，GPL-3.0-or-later）
 *
 * 這支是共用框架：
 * - KURO.api()：/kuroshio_api.cgi（13.3）
 * - KURO.uci：UCI 文字檔的讀寫（保留不認得的區段、選項與註解；沒改過的行原樣輸出）
 * - KURO.fields() / grid()：依欄位描述畫出表單，改動先存在記憶體，按「儲存並套用」才一次送出
 * - 分頁：#status、#dashboard…（各頁的程式在 tw_kuro_*.js，用到才載入）
 * 注意：httpd 會處理 .js 裡的 ej 標記，這個檔案不能出現小於號接百分號或井號
 */
var KURO = (function () {
	'use strict';
	var U = TW, esc = U.esc;

	/* ---------- 管理 API（/kuroshio_api.cgi） ---------- */
	/* q 是要轉給管理 API 的查詢字串：每個值先編碼、用 & 串起來，整串再編碼一次（13.3） */
	/* 同時最多送 2 個（路由器每個請求都要啟動一次程式），其餘排隊（同 LuCI common.js） */
	var inflight = 0, waiting = [];
	function pump() {
		while (inflight < 2 && waiting.length) {
			var job = waiting.shift();
			inflight++;
			job.fn().then(function (v) { inflight--; pump(); return v; }, function (e) { inflight--; pump(); throw e; }).then(job.res, job.rej);
		}
	}
	function limited(fn) { return new Promise(function (res, rej) { waiting.push({ fn: fn, res: res, rej: rej }); pump(); }); }
	function api(op, path, params, post, extra) {
		return limited(function () { return api1(op, path, params, post, extra); });
	}
	function api1(op, path, params, post, extra) {
		var inner = Object.keys(params || {}).filter(function (k) { return params[k] != null && params[k] !== ''; }).map(function (k) {
			return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
		}).join('&');
		var body = 'op=' + op + (path ? '&path=' + encodeURIComponent(path) : '') + (inner ? '&q=' + encodeURIComponent(inner) : '') + (extra || '');
		/* X-TW-Request：httpd 只收帶這個標頭的請求（別的網站加不了自訂標頭，擋跨站請求） */
		var req = post ? fetch('/kuroshio_api.cgi', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-TW-Request': '1' }, body: body })
			: fetch('/kuroshio_api.cgi?' + body, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-TW-Request': '1' } });
		return req.then(function (r) { return r.text(); }).then(function (t) {
			if (!t) return { ok: false, error: '這個韌體沒有黑潮 DNS 管理介面（請更新韌體）' };
			try { return JSON.parse(t); } catch (e) { return { ok: false, error: '回應格式錯誤' }; }
		}, function (e) { return { ok: false, error: '連不到路由器：' + (e && e.message || e) }; });
	}
	/* 查看類：成功回內容，失敗（服務沒執行、不允許）回 null */
	function view(path, params) {
		return api('api', path, params).then(function (r) { return (r && r.ok !== false && r.result != null && typeof r.result === 'object') ? r.result : null; });
	}
	/* 動作類（POST，不自動重試：可能已經送到） */
	function action(path, params) { return api('action', path, params, true); }
	/*
	 * 更新過濾清單
	 * - 黑潮 3.3.0 起（管理 API 版本 2）：背景執行，立刻回 runId；結果在 /api/status 的 filter.update，
	 *   state 是 idle 而且 runId 大於等於拿到的那一個，就是這一次（或之後的一次）結束了（docs/integration.md）
	 * - 3.2.x 以前：等到下載完才回，D3 實測約 68 秒，超過後端轉接的 60 秒上限，會回「沒有回應」但其實有在更新
	 */
	var listsRun = null;
	function updateLists() {
		if (listsRun) { U.toast('過濾清單還在更新中，完成後會通知', 'warn'); return listsRun; }
		U.toast('開始更新過濾清單…', 'ok');
		listsRun = action('/api/filter/update').then(function (r) {
			var x = r && r.ok !== false ? r.result : null;
			if (x && x.runId != null) return waitLists(x.runId, Date.now());
			if (r && r.ok === false && /沒有回應/.test(r.error || '')) { U.toast('已送出更新：清單下載比較久，約 1～2 分鐘後到「狀態」看過濾規則數', 'warn'); return; }
			done(r, '已重新下載過濾清單');
		}).then(function () { listsRun = null; }, function (e) { listsRun = null; throw e; });
		return listsRun;
	}
	function waitLists(runId, t0) {
		return new Promise(function (res) {
			var tick = function () {
				view('/api/status').then(function (s) {
					var u = s && s.filter && s.filter.update;
					if (u && u.state === 'idle' && u.runId != null && u.runId >= runId) {
						if (u.error) U.toast('更新過濾清單失敗：' + u.error, 'bad');
						else U.toast(u.changed === false ? '過濾清單都是最新的，沒有變動' : '已重新下載過濾清單', 'ok');
						return res();
					}
					/* 等太久就不再追（服務可能重新啟動過，runId 從頭算） */
					if (Date.now() - t0 > 6 * 60 * 1000) { U.toast('過濾清單更新還沒有結果，稍後到「狀態」看過濾規則數', 'warn'); return res(); }
					setTimeout(tick, 3000);
				});
			};
			setTimeout(tick, 2000);
		});
	}
	/* 動作的結果：失敗時跳通知並回 null */
	function done(r, okText) {
		if (!r || r.ok === false) { U.toast((r && r.error) || '操作失敗', 'bad'); return null; }
		var x = r.result;
		if (x && x.ok === false) { U.toast(x.error || x.reason || '操作失敗', 'warn'); return null; }
		if (okText) U.toast(okText, 'ok');
		return x == null ? {} : x;
	}

	var defaults = null, defaultsP = null;
	function loadDefaults() {
		if (!defaultsP) defaultsP = api('defaults').then(function (d) { defaults = (d && d.ok !== false) ? d : {}; return defaults; });
		return defaultsP;
	}
	function def(path) {
		return String(path || '').split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, defaults || {});
	}

	/* ---------- UCI 文字檔 ---------- */
	/* 一行拆成字：跟 sh 一樣，'…' 原樣、"…" 可以用反斜線，相鄰的引號字串接在一起（'it'\''s'） */
	function words(line) {
		var out = [], i = 0, n = line.length, w, any, c;
		while (i < n) {
			while (i < n && /\s/.test(line[i])) i++;
			if (i >= n || line[i] == '#') break;
			w = ''; any = false;
			while (i < n && !/\s/.test(line[i])) {
				c = line[i]; any = true;
				if (c == "'") { var j = line.indexOf("'", i + 1); if (j < 0) j = n; w += line.slice(i + 1, j); i = j + 1; }
				else if (c == '"') { i++; while (i < n && line[i] != '"') { if (line[i] == '\\' && i + 1 < n) i++; w += line[i]; i++; } i++; }
				else if (c == '\\' && i + 1 < n) { w += line[i + 1]; i += 2; }
				else { w += c; i++; }
			}
			if (any) out.push(w);
		}
		return out;
	}
	function q(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
	/* 新選項放在區段最後一個選項後面（不要放到區段之間的空行後面） */
	function tail(s) { var i = s.items.length; while (i > 0 && s.items[i - 1].t == 'c' && !s.items[i - 1].raw.trim()) i--; return i; }

	var uci = {
		orig: '', head: [], secs: [], seq: 0,
		load: function (text) {
			this.orig = text = String(text || '').replace(/\r\n/g, '\n');
			this.head = []; this.secs = []; this.seq = 0;
			var cur = null, lines = text.split('\n'), self = this;
			if (lines.length && lines[lines.length - 1] === '') lines.pop();
			lines.forEach(function (raw) {
				var w = words(raw);
				if (!w.length) { (cur ? cur.items : self.head).push({ t: 'c', raw: raw }); return; }
				if (w[0] == 'config') {
					cur = { type: w[1] || '', name: w[2] || '', raw: raw, items: [] };
					cur.id = cur.name || ('_a' + (++self.seq));
					self.secs.push(cur);
					return;
				}
				if (!cur) { self.head.push({ t: 'c', raw: raw }); return; }
				if ((w[0] == 'option' || w[0] == 'list') && w[1]) cur.items.push({ t: w[0] == 'list' ? 'l' : 'o', k: w[1], v: w.length > 2 ? w[2] : '', raw: raw });
				else cur.items.push({ t: 'c', raw: raw });
			});
		},
		text: function () {
			var out = this.head.map(function (x) { return x.raw; });
			this.secs.forEach(function (s) {
				out.push(s.raw != null ? s.raw : 'config ' + s.type + (s.name ? ' ' + q(s.name) : ''));
				s.items.forEach(function (x) {
					out.push(x.raw != null ? x.raw : '\t' + (x.t == 'l' ? 'list ' : 'option ') + x.k + ' ' + q(x.v));
				});
			});
			return out.join('\n') + '\n';
		},
		dirty: function () { return this.text() !== (this.orig ? this.orig.replace(/\n*$/, '\n') : '\n'); },
		sec: function (id) { for (var i = 0; i < this.secs.length; i++) if (this.secs[i].id == id) return this.secs[i]; return null; },
		sections: function (type) { return this.secs.filter(function (s) { return s.type == type; }); },
		/* 有沒有這個選項（option 或 list） */
		has: function (id, k) { var s = this.sec(id); return !!s && s.items.some(function (x) { return x.k == k && x.t != 'c'; }); },
		get: function (id, k) {
			var s = this.sec(id), v;
			if (!s) return undefined;
			s.items.forEach(function (x) { if (x.k == k && x.t == 'o') v = x.v; });
			if (v === undefined) { var l = this.list(id, k); if (l.length) v = l[0]; }
			return v;
		},
		list: function (id, k) {
			var s = this.sec(id);
			if (!s) return [];
			return s.items.filter(function (x) { return x.k == k && x.t != 'c'; }).map(function (x) { return x.v; });
		},
		/* 具名區段不存在時建立（類型：main 是 kuroshio，其他跟名稱相同，同 kuroshio.sh 的 uci_set） */
		ensure: function (id, type) {
			var s = this.sec(id);
			if (s) return s;
			s = { type: type || (id == 'main' ? 'kuroshio' : id), name: id, id: id, items: [] };
			this.secs.push(s);
			return s;
		},
		set: function (id, k, v) {
			var s = this.ensure(id), done = false;
			s.items = s.items.filter(function (x) {
				if (x.k != k || x.t == 'c') return true;
				if (!done && x.t == 'o') { done = true; if (x.v !== String(v)) { x.v = String(v); x.raw = null; } return true; }
				return false;
			});
			if (!done) s.items.splice(tail(s), 0, { t: 'o', k: k, v: String(v) });
		},
		setList: function (id, k, arr) {
			var s = this.ensure(id), at = -1, same = this.list(id, k);
			if (same.length == arr.length && same.every(function (v, i) { return v === arr[i]; }) && !s.items.some(function (x) { return x.k == k && x.t == 'o'; })) return;
			s.items = s.items.filter(function (x, i) { if (x.k == k && x.t != 'c') { if (at < 0) at = i; return false; } return true; });
			if (at < 0) at = tail(s);
			var add = arr.map(function (v) { return { t: 'l', k: k, v: String(v) }; });
			s.items.splice.apply(s.items, [Math.min(at, s.items.length), 0].concat(add));
		},
		unset: function (id, k) {
			var s = this.sec(id);
			if (s) s.items = s.items.filter(function (x) { return x.k != k || x.t == 'c'; });
		},
		/* 新增匿名區段：放在同類型最後一個後面 */
		add: function (type) {
			var s = { type: type, name: '', id: '_a' + (++this.seq), items: [] }, last = -1;
			this.secs.forEach(function (x, i) { if (x.type == type) last = i; });
			if (last < 0) this.secs.push(s); else this.secs.splice(last + 1, 0, s);
			return s;
		},
		remove: function (id) { this.secs = this.secs.filter(function (s) { return s.id != id; }); },
		/* 在同類型的區段之間上下移 */
		move: function (id, dir) {
			var s = this.sec(id);
			if (!s) return;
			var same = this.sections(s.type), i = same.indexOf(s), j = i + dir;
			if (j < 0 || j >= same.length) return;
			var a = this.secs.indexOf(s), b = this.secs.indexOf(same[j]);
			this.secs[a] = same[j]; this.secs[b] = s;
		},
		/* 依新的順序重排同類型的區段（占用原本的位置） */
		reorder: function (type, ids) {
			var self = this, slots = [], order = ids.map(function (id) { return self.sec(id); }).filter(Boolean);
			this.secs.forEach(function (s, i) { if (s.type == type) slots.push(i); });
			var rest = this.sections(type).filter(function (s) { return order.indexOf(s) < 0; });
			order = order.concat(rest);
			var keep = this.secs.filter(function (s) { return s.type != type; }), out = [], k = 0, o = 0;
			for (var i = 0; i < this.secs.length; i++) out.push(slots.indexOf(i) >= 0 ? order[o++] : keep[k++]);
			while (o < order.length) out.push(order[o++]);
			this.secs = out;
		}
	};

	/* ---------- nvram（13.4：這些設定用 nvram，改 UCI 檔沒用） ---------- */
	var nv = { orig: {}, cur: {} };
	function nvGet(k) { return nv.cur.hasOwnProperty(k) ? nv.cur[k] : nv.orig[k]; }
	function nvSet(k, v) { if (String(v) === String(nv.orig[k] == null ? '' : nv.orig[k])) delete nv.cur[k]; else nv.cur[k] = String(v); }
	function nvDirty() { return Object.keys(nv.cur); }

	/* ---------- 模式（簡易／專業，記在瀏覽器，不改路由器） ---------- */
	function isPro() { try { return localStorage.getItem('kuroshio-ui-mode') == 'pro'; } catch (e) { return false; } }
	function setPro(on) { try { localStorage.setItem('kuroshio-ui-mode', on ? 'pro' : 'simple'); } catch (e) {} render(); }

	/* ---------- 欄位 ---------- */
	/*
	 * 欄位描述：{ k: 'doh.port' 或 'nv:kuroshio_doh', t: 'flag|text|pass|select|radio|list|multi|area|html',
	 *   l: 標題, d: 說明, ph: 提示, dp: 預設值路徑（op=defaults）, def: 沒設定時的值, v: 檢查（見 CHECK）,
	 *   opts: [[值, 文字]…], pro: 專業模式才顯示, dep: { 'sec.opt': 值或[值…] }, html: 函式（t=html） }
	 */
	var FIELDS = {}, fseq = 0;
	var CHECK = {
		port: function (v) { return /^\d+$/.test(v) && +v >= 1 && +v <= 65535 || '請輸入 1～65535 的埠號'; },
		uint: function (v) { return /^\d+$/.test(v) || '請輸入 0 或正整數'; },
		ufloat: function (v) { return /^\d+(\.\d+)?$/.test(v) || '請輸入數字（例如 0.3）'; },
		hostname: function (v) { return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.?$/.test(v) || '請輸入網域名稱，例如 dns.example.com'; },
		domain: function (v) { return (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v) && !/\.\d+$/.test(v)) || '請輸入完整的網域名稱，例如 dns.example.com'; },
		email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || '信箱格式不正確'; },
		url: function (v) { return /^https?:\/\/\S+$/.test(v) || '請輸入 http:// 或 https:// 開頭的網址'; },
		hhmm: function (v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) || '格式：HH:MM'; },
		path: function (v) { return /^\/\S*$/.test(v) || '請輸入完整路徑（/ 開頭，不能有空白）'; },
		ip: function (v) { return isIp4(v) || isIp6(v) || '「' + v + '」不是 IP 位址'; },
		ip4: function (v) { return isIp4(v) || '「' + v + '」不是 IPv4 位址'; },
		cidr: function (v) { return checkCidr(v); },
		cidr4: function (v) { var m = /^([^/]+)(?:\/(\d{1,2}))?$/.exec(v); return (m && isIp4(m[1]) && (m[2] == null || +m[2] <= 32)) || '格式：IPv4 網段，例如 203.0.113.0/24'; },
		iface: function (v) { return /^[A-Za-z0-9_.@:-]{1,32}$/.test(v) || '介面名稱只能有英數字與 . _ - @ :'; }
	};
	function range(a, b, float) {
		return function (v) { var n = float ? parseFloat(v) : parseInt(v, 10); return (/^-?\d+(\.\d+)?$/.test(v) && (float || /^-?\d+$/.test(v)) && n >= a && n <= b) || '請輸入 ' + a + '～' + b + ' 之間的數字'; };
	}
	function isIp4(s) { return /^\d+\.\d+\.\d+\.\d+$/.test(s) && s.split('.').every(function (x) { return +x <= 255 && (x.length == 1 || x[0] != '0'); }); }
	/* 跟後端解析一致（移植自 LuCI access.js） */
	function isIp6(s) {
		if (!/^[0-9a-fA-F:.]+$/.test(s) || s.indexOf(':') < 0) return false;
		var dbl = s.split('::');
		if (dbl.length > 2) return false;
		var parts = function (p) { return p === '' ? [] : p.split(':'); };
		var all = parts(dbl[0]).concat(dbl.length == 2 ? parts(dbl[1]) : []), n = 0;
		for (var i = 0; i < all.length; i++) {
			if (all[i].indexOf('.') >= 0) { if (i != all.length - 1 || !isIp4(all[i])) return false; n += 2; }
			else if (/^[0-9a-fA-F]{1,4}$/.test(all[i])) n++;
			else return false;
		}
		return dbl.length == 2 ? n <= 7 : n == 8;
	}
	function checkCidr(v) {
		var m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(v || '');
		if (!m) return '格式是 IP 或 IP/前綴長度，例如 203.0.113.7、198.51.100.0/24、2001:db8::/32';
		var v4 = /^\d+\.\d+\.\d+\.\d+$/.test(m[1]);
		if (!(v4 ? isIp4(m[1]) : isIp6(m[1]))) return '「' + m[1] + '」不是 IP 位址（不含埠號與中括號）';
		if (m[2] != null && +m[2] > (v4 ? 32 : 128)) return v4 ? 'IPv4 的前綴長度是 0～32' : 'IPv6 的前綴長度是 0～128';
		return true;
	}

	function keyOf(f) { return f.k; }
	function rawValue(f) {
		var k = f.k;
		if (k.indexOf('nv:') === 0) return nvGet(k.slice(3));
		var p = k.split('.'), id = p[0], o = p[1];
		if (f.t == 'list' || f.t == 'multi') return uci.has(id, o) ? uci.list(id, o) : undefined;
		return uci.get(id, o);
	}
	/* 目前的值（沒設定時用 def） */
	function value(f) {
		var v = rawValue(f);
		if (v === undefined || v === null) v = f.def;
		return v;
	}
	function valueOfKey(k) { return FIELDS[k] ? value(FIELDS[k]) : (k.indexOf('nv:') === 0 ? nvGet(k.slice(3)) : uci.get(k.split('.')[0], k.split('.')[1])); }
	function write(f, v) {
		var k = f.k;
		if (k.indexOf('nv:') === 0) { nvSet(k.slice(3), v); return; }
		var p = k.split('.'), id = p[0], o = p[1];
		if (f.t == 'list' || f.t == 'multi') {
			if (!v.length) uci.unset(id, o);
			else uci.setList(id, o, v);
			return;
		}
		if (f.t == 'flag') { uci.set(id, o, v); return; }
		if (v === '' && f.rmempty !== false) uci.unset(id, o); else uci.set(id, o, v);
	}
	function placeholder(f) {
		if (f.ph != null) return f.ph;
		if (f.dp) { var d = def(f.dp); if (d != null && typeof d != 'object') return String(d); }
		return '';
	}
	function depOk(f) {
		if (!f.dep) return true;
		return Object.keys(f.dep).every(function (k) {
			var want = [].concat(f.dep[k]), v = valueOfKey(k);
			return want.indexOf(v == null ? '' : String(v)) >= 0;
		});
	}
	function check(f, v) {
		var fn = typeof f.v == 'function' ? f.v : CHECK[f.v];
		if (!fn) return true;
		if (f.t == 'list') {
			for (var i = 0; i < v.length; i++) { var r = fn(v[i]); if (r !== true) return r; }
			return true;
		}
		return v === '' ? true : fn(v);
	}

	function fieldId(f) { return 'kf-' + f.id; }
	function field(f) {
		if (f.pro && !isPro()) return '';
		f.id = f.id || ++fseq;
		FIELDS[f.k] = f;
		var id = fieldId(f), v = value(f), h = '', ctl;
		var hidden = depOk(f) ? '' : ' hidden';
		var desc = f.d ? '<div class="tw-help">' + f.d + '</div>' : '';
		var attrs = ' id="' + id + '" data-kf="' + esc(f.k) + '"';
		switch (f.t) {
		case 'flag':
			var on = String(v) == '1';
			return '<div class="tw-field kr-field" data-kfrow="' + esc(f.k) + '"' + hidden + '><label class="tw-switch"><input type="checkbox"' + attrs + (on ? ' checked' : '') + '><span class="tw-track"></span>' + esc(f.l) + '</label>' + desc + '<div class="kr-err" id="' + id + '-err"></div></div>';
		case 'select':
			ctl = '<select' + attrs + '>' + f.opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(v == null ? '' : v) == o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
			break;
		case 'radio':
			ctl = '<div class="kr-radios" role="radiogroup"' + attrs + '>' + f.opts.map(function (o, i) {
				return '<label class="kr-radio"><input type="radio" name="' + id + '" value="' + esc(o[0]) + '"' + (String(v) == o[0] ? ' checked' : '') + '><span><b>' + esc(o[1]) + '</b>' + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</span></label>';
			}).join('') + '</div>';
			break;
		case 'multi':
			var arr = v == null ? [] : [].concat(v);
			ctl = '<div class="kr-checks"' + attrs + '>' + f.opts.map(function (o) {
				return '<label class="kr-check"><input type="checkbox" value="' + esc(o[0]) + '"' + (arr.indexOf(o[0]) >= 0 ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
			}).join('') + '</div>';
			break;
		case 'list':
			ctl = '<textarea rows="' + Math.max(3, Math.min(10, (v || []).length + 1)) + '" spellcheck="false" placeholder="' + esc(placeholder(f)) + '"' + attrs + '>' + esc((v || []).join('\n')) + '</textarea>';
			desc = '<div class="tw-help">一行一個。' + (f.d || '') + '</div>';
			break;
		case 'area':
			ctl = '<textarea rows="' + (f.rows || 8) + '" spellcheck="false" wrap="off" class="kr-mono"' + (f.ro ? ' readonly' : '') + attrs + '>' + esc(v || '') + '</textarea>';
			break;
		case 'html':
			return '<div class="tw-field kr-field kr-wide" data-kfrow="' + esc(f.k) + '"' + hidden + '>' + (f.l ? '<span class="tw-field-label">' + esc(f.l) + '</span>' : '') + '<div id="' + id + '">' + f.html() + '</div>' + desc + '</div>';
		default:
			ctl = '<input type="' + (f.t == 'pass' ? 'password' : 'text') + '" autocomplete="' + (f.t == 'pass' ? 'new-password' : 'off') + '" spellcheck="false" value="' + esc(f.t == 'pass' ? '' : (v == null ? '' : v)) + '" placeholder="' + esc(placeholder(f)) + '"' + attrs + '>';
		}
		return '<div class="tw-field kr-field' + (f.t == 'list' || f.t == 'area' || f.t == 'radio' || f.t == 'multi' ? ' kr-wide' : '') + '" data-kfrow="' + esc(f.k) + '"' + hidden + '><label class="tw-field-label" for="' + id + '">' + esc(f.l) + '</label>' + ctl + desc + '<div class="kr-err" id="' + id + '-err"></div></div>';
	}
	function fields(list) { return '<div class="tw-fields kr-fields">' + list.map(field).join('') + '</div>'; }

	/* 從畫面讀值 */
	function readField(f) {
		var el = U.$(fieldId(f));
		if (!el) return null;
		switch (f.t) {
		case 'flag': return el.checked ? '1' : '0';
		case 'radio': var r = el.querySelector('input:checked'); return r ? r.value : '';
		case 'multi': return [].slice.call(el.querySelectorAll('input:checked')).map(function (c) { return c.value; });
		case 'list': return el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
		default: return el.value.trim();
		}
	}
	var errors = {};
	function onInput(ev) {
		var t = ev.target, row = t.closest && t.closest('[data-kf]');
		var key = (t.getAttribute && t.getAttribute('data-kf')) || (row && row.getAttribute('data-kf'));
		var f = key && FIELDS[key];
		if (!f || f.ro || f.t == 'html') return;
		var v = readField(f);
		if (f.t == 'pass' && v === '') { if (f.k.indexOf('nv:') === 0) nvSet(f.k.slice(3), nv.orig[f.k.slice(3)]); refresh(); return; }
		var ok = check(f, v), err = U.$(fieldId(f) + '-err');
		if (ok !== true) { errors[f.k] = ok; if (err) err.textContent = ok; refresh(); return; }
		delete errors[f.k];
		if (err) err.textContent = '';
		if (f.onset) f.onset(v); else write(f, v);
		refresh();
	}
	/* 依賴關係、儲存列 */
	function refresh() {
		Object.keys(FIELDS).forEach(function (k) {
			var f = FIELDS[k], row = document.querySelector('[data-kfrow="' + cssEsc(k) + '"]');
			if (row) row.hidden = !depOk(f);
		});
		var n = changes(), bar = U.$('kr-savebar');
		if (!bar) return;
		bar.hidden = !n;
		var e = Object.keys(errors).length;
		U.$('kr-save-text').textContent = e ? '有 ' + e + ' 個欄位格式不正確，請先修正' : '有 ' + n + ' 處設定還沒套用';
		U.$('kr-save-btn').disabled = !!e;
		if (pageHooks.onchange) pageHooks.onchange();
	}
	function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
	function changes() {
		var n = nvDirty().length + fileDirty().length;
		if (uci.dirty()) {
			/* 多出來與少掉的行（不看順序），取較多的一邊當作改了幾處 */
			var cnt = {}, add = 0, del = 0;
			uci.orig.replace(/\n*$/, '\n').split('\n').forEach(function (l) { cnt[l] = (cnt[l] || 0) + 1; });
			uci.text().split('\n').forEach(function (l) { if (cnt[l]) cnt[l]--; else add++; });
			Object.keys(cnt).forEach(function (k) { del += cnt[k]; });
			n += Math.max(1, add, del);
		}
		return n;
	}

	/*
	 * 黑潮 DNS 的文字檔：自訂規則 custom-rules.txt、評測名單 benchmark/*.txt
	 * （/etc/storage/kuroshio/ 底下；httpd 的 kuroshio.<檔名> 欄位，存檔不用重新啟動：自訂規則 3 秒內生效、評測名單下次評測時讀）
	 */
	var files = { orig: {}, cur: {} };
	function fileNorm(v) { return String(v == null ? '' : v).replace(/\r\n/g, '\n'); }
	function fileLoad(map) {
		files.orig = {}; files.cur = {};
		Object.keys(map || {}).forEach(function (k) { files.orig[k] = map[k] == null ? null : fileNorm(map[k]); });
	}
	function fileGet(n) { return files.cur.hasOwnProperty(n) ? files.cur[n] : files.orig[n]; }
	function fileSet(n, v) {
		v = fileNorm(v);
		if (v === fileNorm(files.orig[n])) delete files.cur[n]; else files.cur[n] = v;
		refresh();
	}
	function fileDirty() { return Object.keys(files.cur); }
	/* 重新讀一次檔案內容（黑潮自己改了檔案之後，例如恢復預設自訂規則）：重抓這一頁，取出 xmp 裡的原文 */
	function fileReload(drop) {
		return fetch(location.pathname, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
			var d = new DOMParser().parseFromString(t, 'text/html'), map = {};
			Object.keys(files.orig).forEach(function (k) { map[k] = files.orig[k]; });
			var get = function (id) { var el = d.getElementById(id); return el ? el.textContent.replace(/^\n/, '') : null; };
			map['custom-rules.txt'] = get('kuro-rules');
			['iplist.txt', 'dohlist.txt', 'dotlist.txt', 'doqlist.txt', 'web.txt', 'blacklist.txt'].forEach(function (f, i) { map['benchmark/' + f] = get('kuro-b' + (i + 1)); });
			var keep = drop ? {} : files.cur;
			fileLoad(map);
			Object.keys(keep).forEach(function (k) { if (keep[k] !== files.orig[k]) files.cur[k] = keep[k]; });
		});
	}
	/* 檔案用的文字框：data-kfile 是檔名，內容跟著 fileGet（換分頁回來還在） */
	function fileArea(name, o) {
		o = o || {};
		var v = fileGet(name);
		/* textarea 開頭的換行會被 HTML 吃掉，前面多放一個 */
		return '<textarea class="kr-mono' + (o.cls ? ' ' + o.cls : '') + '" rows="' + (o.rows || 8) + '" wrap="off" spellcheck="false" data-kfile="' + esc(name) + '"' +
			(o.label ? ' aria-label="' + esc(o.label) + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>\n' + esc(v == null ? '' : v) + '</textarea>';
	}

	/* 設定檔還沒建立（黑潮 DNS 第一次啟動時才會從預設值複製）：這時不能寫 UCI，否則會蓋掉預設的過濾清單等 */
	function noUci() { return !/^config\s/m.test(uci.orig); }

	/* ---------- 儲存並套用 ---------- */
	/*
	 * 表單送出時的大小：httpd 一次只收 64 KB（post_buf），超過的部分會被直接截掉、照樣存進 Flash。
	 * 送出時換行是 CRLF、中文一個字網址編碼後 9 bytes，所以要算整份編碼後的長度，不能只看檔案大小
	 */
	var FORM_MAX = 64000;
	function formBytes(fields) {
		var all = { current_page: location.pathname.replace(/^\//, ''), next_page: '', sid_list: 'KuroshioConf;', group_id: '', action_mode: ' Apply ', action_script: '' };
		Object.keys(fields).forEach(function (k) { all[k] = String(fields[k] == null ? '' : fields[k]).replace(/\r?\n/g, '\r\n'); });
		return new URLSearchParams(all).toString().length;
	}
	function save() {
		var fields = {}, impacts = [];
		if (Object.keys(errors).length) { U.toast('有欄位格式不正確', 'bad'); return; }
		if (uci.dirty() && !noUci()) fields['kuroshio.kuroshio.uci'] = uci.text();
		nvDirty().forEach(function (k) { fields[k] = nv.cur[k]; });
		var restart = Object.keys(fields).length > 0;
		fileDirty().forEach(function (n) {
			var t = files.cur[n];
			if (t && !/\n$/.test(t)) t += '\n';
			fields['kuroshio.' + n] = t;
		});
		var size = formBytes(fields);
		if (size > FORM_MAX) {
			U.toast('這次要存的內容送出時約 ' + Math.ceil(size / 1024) + ' KB，超過路由器一次能收的 62 KB。' +
				(fileDirty().length + (uci.dirty() ? 1 : 0) > 1 ? '請分幾次存（一次改一個檔），或' : '請') + '刪掉一些內容', 'bad');
			return;
		}
		/* 開關本身改了：下面另外有一行說明（啟動或停止），不是重新載入 */
		if (restart && !nv.cur.hasOwnProperty('kuroshio_enable')) impacts.push(nv.cur.hasOwnProperty('kuroshio_log')
			? '黑潮 DNS 重新啟動（約 5～10 秒，日誌等級要重新啟動才會生效），這段期間由業者 DNS 暫代、沒有過濾'
			: '黑潮 DNS 重新載入設定（不改用業者 DNS；換上新設定時約有幾秒查不到。新設定有錯時繼續用原本的設定，原因顯示在狀態頁）');
		if (files.cur.hasOwnProperty('custom-rules.txt')) impacts.push('自訂規則 3 秒內生效（不用重新啟動）');
		if (fileDirty().some(function (n) { return n.indexOf('benchmark/') === 0; })) impacts.push('評測名單在下次每日評測時使用');
		impacts.push('設定存在路由器上，存檔後立即寫進 Flash，斷電也不會遺失');
		if (['kuroshio_enable', 'kuroshio_dot', 'kuroshio_doq', 'kuroshio_doh', 'kuroshio_doh_port', 'kuroshio_doh_wan_port', 'kuroshio_wan'].some(function (k) { return nv.cur.hasOwnProperty(k); }))
			impacts.push('防火牆重新載入（開放外網的埠號跟著更新），連線會斷一下');
		if (nv.cur.hasOwnProperty('kuroshio_enable')) impacts.push(nv.cur.kuroshio_enable == '1' ? '區網的 DNS 改由黑潮 DNS 回答' : '改回業者的 DNS（沒有過濾與 CDN 加速）');
		if (!Object.keys(fields).length) return;
		try { sessionStorage.setItem('kuro-tab', cur); } catch (e) {}
		U.apply({ sid: 'KuroshioConf;', fields: fields, title: '儲存並套用黑潮 DNS 設定？', ok: '儲存並套用', impacts: impacts });
	}
	function revert() {
		uci.load(uci.orig);
		nv.cur = {};
		files.cur = {};
		errors = {};
		render();
	}

	/* ---------- 共用元件 ---------- */
	function card(title, body, o) {
		o = o || {};
		return U.card({ title: title, lead: o.lead, body: body, id: o.id, extra: o.extra, cls: 'kr-card' + (o.cls ? ' ' + o.cls : '') });
	}
	function badge(text, kind) {
		var map = { ok: 'ok', warn: 'warn', err: 'bad', bad: 'bad', off: '', info: 'info' };
		return '<span class="tw-chip' + (map[kind] ? ' tw-s-' + map[kind] : '') + '">' + esc(text) + '</span>';
	}
	/* 表格：cells 是已經跳脫好的 HTML；num = 數字欄 */
	function table(head, rows, empty, num) {
		num = num || [];
		if (!rows.length) return '<p class="tw-muted kr-empty">' + esc(empty || '沒有資料') + '</p>';
		return '<div class="tw-table-wrap"><table class="tw-table kr-table"><thead><tr>' + head.map(function (h, i) {
			return '<th' + (num.indexOf(i) >= 0 ? ' class="tw-right"' : '') + ' scope="col">' + esc(h) + '</th>';
		}).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
			return '<tr>' + r.map(function (c, i) { return '<td' + (num.indexOf(i) >= 0 ? ' class="tw-right tw-num"' : '') + ' data-label="' + esc(head[i] || '') + '">' + (c == null ? '-' : c) + '</td>'; }).join('') + '</tr>';
		}).join('') + '</tbody></table></div>';
	}
	function kv(rows) {
		return '<dl class="tw-kv">' + rows.filter(Boolean).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + (r[1] == null ? '-' : r[1]) + '</dd>'; }).join('') + '</dl>';
	}
	function tiles(list) {
		return '<div class="kr-tiles">' + list.filter(Boolean).map(function (t) {
			return '<div class="kr-tile"><div class="kr-tile-l">' + esc(t[0]) + '</div><div class="kr-tile-v tw-num">' + esc(t[1] == null ? '-' : t[1]) + '</div>' + (t[2] ? '<div class="kr-tile-s">' + esc(t[2]) + '</div>' : '') + '</div>';
		}).join('') + '</div>';
	}
	function pre(text, id) { return '<pre class="kr-pre"' + (id ? ' id="' + id + '"' : '') + '>' + esc(text) + '</pre>'; }
	function note(html, kind) { return '<div class="tw-note' + (kind ? ' tw-s-' + kind : '') + '">' + html + '</div>'; }
	function fmtNum(n) { return n == null || isNaN(n) ? '-' : Number(n).toLocaleString('zh-TW'); }
	function pct(a, b) { return b ? (100 * a / b).toFixed(1) + '%' : '-'; }
	function p2(n) { return (n < 10 ? '0' : '') + n; }
	/* 日期時間：2026-11-12 10:22（跟黑潮 DNS 的 fmtTime 同一份規則） */
	function time(t, mode) {
		if (t == null || t === '' || t === 0) return '-';
		var d = new Date(typeof t === 'number' || /^\d+$/.test(t) ? Number(t) : t);
		if (isNaN(d)) return String(t);
		var date = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
		var hm = p2(d.getHours()) + ':' + p2(d.getMinutes()), sec = ':' + p2(d.getSeconds());
		return mode === 'date' ? date : mode === 'time' ? hm : mode === 'timesec' ? hm + sec : date + ' ' + hm + (mode === 'sec' ? sec : '');
	}
	function bytes(b) { if (b == null) return '-'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
	/* 按鈕：data-kact 對應 pageHooks.act 裡的函式 */
	function btn(label, act, o) {
		o = o || {};
		return '<button type="button" class="tw-btn' + (o.primary ? ' tw-btn-primary' : '') + (o.danger ? ' tw-btn-danger' : '') + (o.small !== false ? ' tw-btn-sm' : '') + '" data-kact="' + esc(act) + '"' +
			(o.arg != null ? ' data-arg="' + esc(o.arg) + '"' : '') + (o.id ? ' id="' + esc(o.id) + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
	}
	function onClick(ev) {
		var b = ev.target.closest && ev.target.closest('[data-kact]');
		if (!b || b.disabled) return;
		var fn = (pageHooks.act || {})[b.getAttribute('data-kact')] || ACT[b.getAttribute('data-kact')];
		if (!fn) return;
		ev.preventDefault();
		var r = fn(b.getAttribute('data-arg'), b);
		if (r && r.then) { b.disabled = true; r.then(function () { b.disabled = false; }, function () { b.disabled = false; }); }
	}
	var ACT = {
		save: save,
		revert: function () { return U.dialog({ title: '放棄還沒套用的變更？', ok: '放棄變更', danger: true }).then(function (y) { if (y) revert(); }); },
		mode: function (a) { setPro(a == 'pro'); }
	};

	/* ---------- 區段清單（訂閱清單、自動規則、各家 CDN、排程工作） ---------- */
	/*
	 * o.type：區段類型；o.anon：匿名（可以新增、刪除、排序）；o.cols：欄位描述（k 只寫選項名稱）
	 * o.title(sec)：每列的標題；o.summary(sec)：標題旁的說明（HTML）；o.quick：列上直接可以切換的開關選項名稱
	 */
	var GRIDS = {};
	function grid(o) {
		GRIDS[o.type] = o;
		var secs = uci.sections(o.type);
		var h = '<div class="kr-grid" id="kg-' + o.type + '">';
		if (!secs.length) h += '<p class="tw-muted kr-empty">' + esc(o.empty || '沒有項目') + '</p>';
		secs.forEach(function (s, i) {
			var cols = o.cols.map(function (c) { var f = {}; for (var x in c) f[x] = c[x]; f.k = s.id + '.' + c.k; f.id = 'g' + o.type + '-' + s.id + '-' + c.k; return f; });
			var quick = o.quick ? cols.filter(function (c) { return c.k == s.id + '.' + o.quick; })[0] : null;
			var open = o.openId == s.id;
			h += '<details class="kr-row" data-sec="' + esc(s.id) + '"' + (open ? ' open' : '') + '><summary>';
			if (quick) { quick.id = quick.id + '-q'; FIELDS[quick.k] = quick; h += '<label class="tw-switch kr-quick" title="' + esc(quick.l) + '"><input type="checkbox" id="' + fieldId(quick) + '" data-kf="' + esc(quick.k) + '"' + (String(value(quick)) == '1' ? ' checked' : '') + ' aria-label="' + esc(quick.l) + '"><span class="tw-track"></span></label>'; }
			h += '<span class="kr-row-title">' + esc(o.title(s) || '（未命名）') + '</span>' + (o.summary ? '<span class="kr-row-sum">' + o.summary(s) + '</span>' : '') + '<span class="kr-row-chev" aria-hidden="true">' + U.icon('chevron', 16) + '</span></summary>';
			h += '<div class="kr-row-body">' + fields(cols.filter(function (c) { return !quick || c.k != quick.k; }));
			if (o.anon) h += '<div class="tw-actions kr-row-actions">' + (i > 0 ? btn('上移', 'gmove', { arg: o.type + '|' + s.id + '|-1' }) : '') + (i < secs.length - 1 ? btn('下移', 'gmove', { arg: o.type + '|' + s.id + '|1' }) : '') + btn('刪除', 'gdel', { arg: o.type + '|' + s.id, danger: true }) + '</div>';
			h += '</div></details>';
		});
		h += '</div>';
		if (o.anon) h += '<div class="tw-actions kr-grid-actions">' + btn(o.addLabel || '新增', 'gadd', { arg: o.type }) + (o.extraActions || '') + '</div>';
		return h;
	}
	function redrawGrid(type) {
		var o = GRIDS[type], el = U.$('kg-' + type);
		if (!o || !el) return;
		var wrap = document.createElement('div');
		wrap.innerHTML = grid(o);
		var acts = el.nextElementSibling && el.nextElementSibling.classList.contains('kr-grid-actions') ? el.nextElementSibling : null;
		el.parentNode.replaceChild(wrap.firstChild, el);
		if (acts && wrap.firstChild) acts.parentNode.replaceChild(wrap.firstChild, acts);
		refresh();
	}
	ACT.gadd = function (type) {
		var o = GRIDS[type], s = uci.add(type);
		(o.init || []).forEach(function (kvp) { uci.set(s.id, kvp[0], kvp[1]); });
		o.openId = s.id;
		redrawGrid(type);
	};
	ACT.gdel = function (arg) {
		var p = arg.split('|'), o = GRIDS[p[0]], s = uci.sec(p[1]);
		return U.dialog({ title: '刪除「' + (o.title(s) || '未命名') + '」？', body: '<p>按「儲存並套用」後才會真的刪除。</p>', ok: '刪除', danger: true }).then(function (y) {
			if (!y) return;
			uci.remove(p[1]);
			redrawGrid(p[0]);
		});
	};
	ACT.gmove = function (arg) {
		var p = arg.split('|');
		uci.move(p[1], +p[2]);
		GRIDS[p[0]].openId = p[1];
		redrawGrid(p[0]);
	};

	/* ---------- 分頁 ---------- */
	var TABS = [
		['status', '狀態', 'tw_kuro.js'], ['dashboard', '儀表板', 'tw_kuro.js'], ['settings', '基本設定', 'tw_kuro_conf.js'],
		['access', '連線來源', 'tw_kuro_conf.js'], ['filter', '廣告過濾', 'tw_kuro_conf.js'], ['cdn', 'CDN 台灣節點', 'tw_kuro_conf.js'],
		['community', '社群', 'tw_kuro_comm.js'], ['advanced', '進階', 'tw_kuro_conf.js'], ['log', '日誌', 'tw_kuro.js']
	];
	var PAGES = {}, cur = 'status', pageHooks = {}, loaded = {}, timers = [];
	function page(id, o) { PAGES[id] = o; }
	function loadScript(src) {
		if (loaded[src]) return loaded[src];
		return (loaded[src] = new Promise(function (res, rej) {
			var s = document.createElement('script');
			s.src = '/' + src;
			s.onload = res;
			s.onerror = function () { delete loaded[src]; rej(new Error('讀不到 ' + src)); };
			document.head.appendChild(s);
		}));
	}
	/*
	 * 黑潮 3.3.0 起的共用純函式（KuroshioUiCore：恢復預設清單的比對等，LuCI 與 Windows 設定頁用同一份）
	 * 韌體的 /usr/share/kuroshio/shared，www 用連結 kuroshio-shared 指過去；3.2.x 沒有這個檔，回 null 讓各頁用自己的一份
	 */
	var coreP = null;
	function core() {
		if (window.KuroshioUiCore) return Promise.resolve(window.KuroshioUiCore);
		if (coreP) return coreP;
		return (coreP = new Promise(function (res) {
			var s = document.createElement('script');
			s.src = '/kuroshio-shared/ui-core.js';
			s.onload = function () { res(window.KuroshioUiCore || null); };
			s.onerror = function () { res(null); };
			document.head.appendChild(s);
		}));
	}
	function every(fn, ms) { var p = U.poll(fn, ms); timers.push(p); return p; }
	function stopTimers() { timers.forEach(function (p) { p.stop(); }); timers = []; }

	function tabsHtml() {
		return '<nav class="kr-tabs" aria-label="黑潮 DNS 分頁"><ul>' + TABS.map(function (t) {
			return '<li><a href="#' + t[0] + '"' + (t[0] == cur ? ' aria-current="page" class="active"' : '') + '>' + esc(t[1]) + '</a></li>';
		}).join('') + '</ul></nav>';
	}
	function headHtml() {
		var st = statusLine;
		var pro = isPro();
		var seg = '<div class="tw-seg kr-mode" role="group" aria-label="介面模式"><button type="button" data-kact="mode" data-arg="simple" aria-pressed="' + !pro + '">簡易</button><button type="button" data-kact="mode" data-arg="pro" aria-pressed="' + pro + '">專業</button></div>';
		return U.pageHead({ crumbs: [{ label: '網際網路', href: 'tw_internet.asp' }, { label: '黑潮 DNS' }], title: '黑潮 DNS', chip: st ? U.chip(st[1] == 'unknown' ? 'unknown' : st[1], st[0]) : '',
			sub: '台灣 CDN 節點、每天挑最快且沒有汙染的上游、過濾廣告與詐騙網站、加密 DNS。', actions: seg });
	}
	var statusLine = null;

	function render() {
		var p = PAGES[cur];
		stopTimers();
		FIELDS = {}; GRIDS = {}; pageHooks = {}; errors = {};
		var h = headHtml() + tabsHtml() + (noUci() && cur != 'status' && cur != 'log' && cur != 'dashboard' ? U.stateBox('unavailable', '黑潮 DNS 的設定檔還沒建立（第一次啟用時會從預設值建立）：先在「基本設定」啟用並套用，之後才能修改這頁的進階設定。') : '') + '<div id="kr-body" class="kr-body">' + U.stateBox('loading') + '</div>' +
			'<div class="kr-savebar" id="kr-savebar" hidden><span id="kr-save-text"></span><span class="kr-savebar-btns">' + btn('放棄', 'revert', { small: false }) + ' ' +
			'<button type="button" class="tw-btn tw-btn-primary" id="kr-save-btn" data-kact="save">儲存並套用</button></span></div>' + footerHtml();
		U.mount(h);
		if (!p) {
			var t = TABS.filter(function (x) { return x[0] == cur; })[0];
			loadScript(t[2]).then(function () { if (PAGES[cur]) render(); else U.set('kr-body', U.stateBox('error', '這個分頁還沒有內容')); },
				function (e) { U.set('kr-body', U.stateBox('error', e.message)); });
			return;
		}
		var need = p.needDefaults ? loadDefaults() : Promise.resolve();
		need.then(function () {
			pageHooks = p.hooks || {};
			try {
				var out = p.render();
				if (typeof out == 'string') U.set('kr-body', out);
				if (p.after) p.after();
			} catch (e) {
				U.set('kr-body', U.stateBox('error', '頁面發生錯誤：' + e.message));
				if (window.console) console.error(e);
			}
			refresh();
			loadAbout();
		});
	}
	function go() {
		var id = (location.hash || '').replace(/^#/, '');
		if (!TABS.some(function (t) { return t[0] == id; })) id = 'status';
		cur = id;
		render();
		/* 目前的分頁捲進可見範圍（只左右捲，不動整頁） */
		var a = document.querySelector('.kr-tabs a.active'), nav = document.querySelector('.kr-tabs');
		if (a && nav) nav.scrollLeft = Math.max(0, a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2);
	}

	/* ---------- 頁尾：版本、授權、原始碼 ---------- */
	var about = null;
	function footerHtml() {
		return '<footer class="kr-footer" id="kr-footer"><span id="kr-about-line">黑潮 DNS 核心 讀取中…</span>' +
			'<details class="kr-about"><summary>關於</summary><div id="kr-about-body"></div></details></footer>';
	}
	function loadAbout() {
		var p = about ? Promise.resolve(about) : api('about').then(function (a) { about = (a && a.ok !== false && a.version) ? a : { _none: true }; return about; });
		p.then(function (a) {
			var line = U.$('kr-about-line'), body = U.$('kr-about-body');
			if (!line) return;
			var src = /^https?:\/\//.test(a.source || '') ? a.source : 'https://github.com/candy999/kuroshio-dns';
			var lic = /^https?:\/\//.test(a.licenseUrl || '') ? a.licenseUrl : 'https://www.gnu.org/licenses/gpl-3.0.html';
			line.innerHTML = '黑潮 DNS 核心 ' + esc(a._none ? '未回應' : 'v' + a.version) + ' · <a href="' + esc(lic) + '" target="_blank" rel="noopener noreferrer">' + esc(a.license || 'GPL-3.0-or-later') + '</a> · <a href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">原始碼</a>';
			var FEAT = { doh: 'DoH', doh3: 'DoH3', dot: 'DoT', doq: 'DoQ', cdn: 'CDN 台灣節點', community: '好友社群', filter: '過濾', acme: '自動憑證' };
			var qr = '';
			if (typeof a.qrSource == 'string' && a.qrSource.indexOf('svg') > 0) {
				try { qr = '<img class="kr-qr" alt="原始碼網址 QR 碼" width="140" height="140" src="data:image/svg+xml;base64,' + btoa(a.qrSource) + '">'; } catch (e) { qr = ''; }
			}
			body.innerHTML = '<div class="kr-about-grid"><div>' + kv([
				['核心', esc((a.name || '黑潮 DNS') + ' ' + (a._none ? '未回應' : 'v' + a.version))],
				['程式語言 / 平台', esc([a.language, a.target].filter(Boolean).join(' · '))],
				a.features ? ['編入的功能', esc([].concat(a.features).map(function (f) { return FEAT[f] || f; }).join(' · '))] : null,
				['後台介面', 'padavan-tw（移植自 luci-app-kuroshio 3.2.0）'],
				['授權', '<a href="' + esc(lic) + '" target="_blank" rel="noopener noreferrer">' + esc(a.license || 'GPL-3.0-or-later') + '</a>'],
				['原始碼', '<a href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">' + esc(src) + '</a>']
			]) + '<p class="tw-small tw-muted">黑潮 DNS 是開放原始碼軟體，採用 GPL-3.0-or-later 授權：可以自由使用、修改與分享；如果把修改過的版本散布給別人，必須用同樣的授權一併提供原始碼。</p></div>' + qr + '</div>';
		});
	}

	/* ---------- 啟動 ---------- */
	function start(o) {
		nv.orig = o.nv || {};
		uci.load(o.uci || '');
		var F = window.KURO_FILES || {}, fm = {};
		if (F.rules !== undefined) fm['custom-rules.txt'] = F.rules;
		Object.keys(F.bench || {}).forEach(function (k) { fm['benchmark/' + k] = F.bench[k]; });
		fileLoad(fm);
		try { var t = sessionStorage.getItem('kuro-tab'); if (t && !location.hash) location.replace('#' + t); sessionStorage.removeItem('kuro-tab'); } catch (e) {}
		var root = U.$('tw-page');
		root.addEventListener('change', onInput);
		root.addEventListener('input', function (ev) {
			var fn = ev.target.getAttribute && ev.target.getAttribute('data-kfile');
			if (fn) { fileSet(fn, ev.target.value); return; }
			if (ev.target.tagName == 'TEXTAREA' || ev.target.type == 'text') onInput(ev);
		});
		root.addEventListener('click', onClick);
		window.addEventListener('hashchange', go);
		window.addEventListener('beforeunload', function (e) { if (changes()) { e.preventDefault(); e.returnValue = ''; } });
		/* 標題旁的狀態 */
		api('status').then(function (s) {
			if (!s || s.ok === false) statusLine = ['讀不到狀態', 'unknown'];
			else if (!s.enabled) statusLine = ['已停用', 'off'];
			else if (!s.running) statusLine = ['沒有執行', 'bad'];
			else if (s.use == 'fallback') statusLine = ['暫時改用業者 DNS', 'warn'];
			else statusLine = ['運作中', 'ok'];
			var h = document.querySelector('.tw-head h1');
			if (h) h.innerHTML = '黑潮 DNS ' + U.chip(statusLine[1], statusLine[0]);
		});
		go();
	}

	return {
		api: api, view: view, action: action, done: done, updateLists: updateLists, loadDefaults: loadDefaults, def: def,
		uci: uci, nvGet: nvGet, nvSet: nvSet, isPro: isPro, field: field, fields: fields, grid: grid, redrawGrid: redrawGrid,
		refresh: refresh, value: value, valueOfKey: valueOfKey, write: write, range: range, CHECK: CHECK, isIp4: isIp4, isIp6: isIp6, checkCidr: checkCidr,
		card: card, badge: badge, table: table, kv: kv, tiles: tiles, pre: pre, note: note, btn: btn, fmtNum: fmtNum, pct: pct, time: time, bytes: bytes, core: core, fileArea: fileArea, fileReload: fileReload, fileGet: fileGet,
		page: page, every: every, start: start, render: render, current: function () { return cur; }, changes: changes, FIELDS: function () { return FIELDS; }
	};
})();

/* =====================================================================
 * 狀態（移植自 LuCI status.js）
 * ===================================================================== */
var KR_MORE = false, KR_MORE_CH = false;	/* 狀態頁「更多細節」的開合（每次重新整理會重畫） */
(function (K) {
	var U = TW, esc = U.esc;
	var JOBS = { 'dns-benchmark': 'DNS 評測', 'cdn-ranges': 'CDN IP 範圍', 'cdn-scan': 'CDN 網段分類', 'cdn-pool': '台灣節點池', 'tw-ip': '台灣 IP 清單' };
	var MODE = { jffs2: 'Flash（Kuroshio 分割區）', rwfs: 'Flash（RWFS）', ram: '記憶體（每天備份到 /etc/storage）' };
	function mb(kb) { return kb != null ? K.fmtNum(Math.round(kb / 1024)) : '-'; }
	function age(s) { if (s == null) return '-'; if (s <= 0) return '全部已存'; if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' 分鐘'; return (s / 3600).toFixed(1) + ' 小時'; }
	function uptime(s) { if (s == null) return '-'; var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + ' 天 ' : '') + h + ' 小時 ' + m + ' 分'; }
	function memSizes(z) {
		if (!z) return '';
		var out = [];
		if (z.cacheEntries != null) out.push('快取 ' + K.fmtNum(z.cacheEntries) + ' / ' + K.fmtNum(z.cacheMax) + ' 筆');
		if (z.cdnInRam != null) out.push('CDN ' + K.fmtNum(z.cdnInRam) + ' 筆' + (z.cdnOnDiskOnly ? '（另 ' + K.fmtNum(z.cdnOnDiskOnly) + ' 筆在 Flash）' : ''));
		if (z.filterListRules != null) out.push('清單 ' + K.fmtNum(z.filterListRules) + ' 條');
		if (z.otherBytes) out.push('其他 ' + K.bytes(z.otherBytes));	/* 3.4.1 */
		return out.join(' · ');
	}

	function body(st, api) {
		var h = '';
		/* 結論 */
		var c;
		if (!st || st.ok === false) c = { state: 'unknown', title: '讀不到黑潮 DNS 的狀態', sub: esc((st && st.error) || '') };
		else if (!st.enabled) c = { state: 'off', title: '黑潮 DNS 已停用，使用業者的 DNS', sub: '到「基本設定」打開。' };
		else if (!st.running) c = { state: 'bad', title: '黑潮 DNS 沒有執行', sub: '區網暫時使用業者的 DNS，原因請看「日誌」。' };
		else if (st.use == 'fallback') c = { state: 'warn', title: '黑潮 DNS 沒有回應，暫時改用業者的 DNS', sub: '這段期間沒有過濾與 CDN 加速；恢復回答後會自動切回。' };
		else if (api && api.reload && api.reload.usingPrevious) c = { state: 'warn', title: '新設定無法套用，黑潮 DNS 繼續用原本的設定', sub: esc(api.reload.error || '') + '（改好設定再存一次就會換上）' };
		else c = { state: (api && api.warnings && api.warnings.length) ? 'warn' : 'ok', title: (api && api.warnings && api.warnings.length) ? '黑潮 DNS 運作中，但有需要注意的事' : '黑潮 DNS 運作中',
			sub: '區網的 DNS 查詢由黑潮 DNS 回答' + (api && api.stats ? '，這一輪已執行 ' + uptime(api.stats.uptimeSec) : '') + '。' };
		h += U.conclusion(c);
		/* 3.3.2：清單下載失敗、存取控制資料讀不到、時間沒對時、重新載入失敗等都在 warnings */
		if (api && api.warnings && api.warnings.length) h += K.note('<b>需要注意：</b><br>' + api.warnings.map(esc).join('<br>'), 'warn');
		if (st && st.area_note) h += K.note('<b>學習資料區：</b>' + esc(st.area_note) + (/RWFS/.test(st.area_note) ? ' <a href="Advanced_kuroshio.asp">到舊版頁面處理</a>' : ''), 'warn');
		/* 版面：原本的「服務」卡片只有三行，收成結論下面的一行小字 */
		if (st && st.ok !== false) h += '<p class="tw-small tw-muted kr-svc">' + esc(st.version || '-') + ' · 作為 dnsmasq 的上游（DHCP 與區網主機名稱照常由 dnsmasq 處理） · 學習資料存在' + esc(MODE[st.mode] || st.mode || '-') + '</p>';
		if (!api) return h + (st && st.running ? U.stateBox('error', '讀不到黑潮 DNS 的管理 API') : '');

		var d = (api.stats && api.stats.today) || {}, q = d.query || 0, cdn = (api.cdn && api.cdn.stats) || {}, ra = 0, rn = 0;
		Object.keys(d.route || {}).forEach(function (k) { ra += d.route[k].acc || 0; rn += d.route[k].n || 0; });
		h += K.card('今天', K.tiles([
			['查詢', K.fmtNum(q), '快取命中 ' + K.pct(d.hit || 0, q)],
			['攔截', K.fmtNum(d.blocked), '廣告 ' + K.fmtNum(d.blockedAds) + ' · 遙測 ' + K.fmtNum(d.blockedTelemetry) + ' · 惡意 ' + K.fmtNum(d.blockedMalware)],
			['拉回台灣', K.fmtNum(ra), 'CDN 連線的 ' + K.pct(ra, rn)],
			['CDN 置換', K.fmtNum(cdn.rewrites), 'ECS ' + K.fmtNum(cdn.ecsRewrites) + ' · 跨 CDN ' + K.fmtNum(cdn.crossRewrites)],
			['快取筆數', K.fmtNum(api.cacheEntries), 'CDN 網域庫 ' + K.fmtNum(api.cdn && api.cdn.domains)],
			['過濾規則', K.fmtNum(api.filter && (api.filter.lists + api.filter.custom)), '自訂 ' + K.fmtNum(api.filter && api.filter.custom) +
				(api.filter && api.filter.update && api.filter.update.state === 'running' ? ' · 清單更新中…' : '')],
			/* 串接中：3.4.2 chainBypass（上游黑潮擋掉、這台自己解析）、3.4.3 chainRetry（上游解析不到、這台自己再問一次） */
			api.chain && api.chain.state === 'chained' ? ['串接時自己解析', K.fmtNum((d.chainBypass || 0) + (d.chainRetry || 0)), '上游擋掉的 ' + K.fmtNum(d.chainBypass || 0) + ' · 上游解析不到的 ' + K.fmtNum(d.chainRetry || 0)] : null
		]));

		var sys = api.system || {}, per = sys.persist || {}, lat = d.latency || {}, ls = api.listeners || {}, mem = sys.memory || {};
		var ms = function (x) { return x && x.p50 != null ? x.p50 + ' / ' + (x.p95 != null ? x.p95 : '>1000') + ' ms' : '-'; };
		var protos = ['doh', 'doh3', 'dot', 'doq'].filter(function (k) { return ls[k]; }).map(function (k) { return { doh: 'DoH', doh3: 'DoH3', dot: 'DoT', doq: 'DoQ' }[k] + ':' + ls[k]; });
		var sp = per.space || {};
		/* 版面：磚塊只放一眼要看的數字，說明縮短；其他細節收進「更多細節」（重新整理時記住開合） */
		var memState = mem.enabled ? (mem.stateLabel || mem.state || '') + (mem.pressure && mem.pressure !== 'normal' ? '（當下' + ({ low: '偏低', critical: '嚴重不足' }[mem.pressure] || mem.pressure) + '）' : '') : '';
		h += K.card('效能', K.tiles([
			['系統可用記憶體', mem.availKB != null ? mb(mem.availKB) + ' MB' : (sys.memAvailableMB != null ? sys.memAvailableMB + ' MB' : '-'), memState],
			['黑潮 DNS 記憶體', sys.rssKB ? (sys.rssKB / 1024).toFixed(1) + ' MB' : '-', mem.jobs && mem.jobs.running ? '執行中：' + (JOBS[mem.jobs.running] || mem.jobs.running) : ''],
			['快取命中率', d.hitRate != null ? d.hitRate + '%' : '-', '預取 ' + K.fmtNum(d.prefetch)],
			['回應時間 p50 / p95', ms(lat.hit), '問上游 ' + ms(lat.miss)],
			['Flash 寫入（今天）', per.bytesToday != null ? (per.bytesToday / 1024).toFixed(0) + ' KB' : '-', per.estimatedDailyBytes != null ? '預估每天 ' + (per.estimatedDailyBytes / 1024).toFixed(0) + ' KB' : ''],
			sp.reserveBytes != null ? ['儲存空間可用', sp.freeBytes != null ? K.fmtNum(Math.round(sp.freeBytes / 1024)) + ' KB' : '-', sp.keepingOptional === false ? '空間吃緊：只留核心資料' : '保留 ' + K.fmtNum(Math.round(sp.reserveBytes / 1024)) + ' KB'] : null
		]) + '<details class="kr-more"' + (KR_MORE ? ' open' : '') + ' ontoggle="KR_MORE=this.open"><summary>更多細節</summary>' + K.kv([
			['硬體', esc((sys.memTotalMB ? sys.memTotalMB + ' MB · ' : '') + (sys.cores || '?') + ' 核 · ' + (sys.arch || ''))],
			['系統記憶體', esc('保留 ' + mb(mem.reserveKB) + ' MB（' + (mem.reserveAuto ? '自動' : '設定') + '）' + (mem.headroomKB != null ? ' · 保留以上 ' + mb(mem.headroomKB) + ' MB' : '') +
				(mem.growth === false ? ' · 不再長大' : '') + (mem.psi ? ' · PSI ' + mem.psi.someAvg10 + '%' : '') +
				(mem.holdUntil && mem.holdUntil > Date.now() ? ' · 已先讓出記憶體（到 ' + K.time(mem.holdUntil, 'time') + ' 前不長大）' : ''))],
			['黑潮 DNS 記憶體的組成', esc(memSizes(mem.sizes) || '-') + (mem.jobs && mem.jobs.running && mem.jobs.rawBytes ? esc(' · 背景工作原始答案約 ' + (mem.jobs.rawBytes / 1048576).toFixed(1) + ' MB' + (mem.jobs.openConnections ? '、' + K.fmtNum(mem.jobs.openConnections) + ' 條連線' : '')) : '')],
			['快取', esc('預取 ' + K.fmtNum(d.prefetch) + ' · 斷線回舊資料 ' + K.fmtNum(d.stale))],
			['儲存學習資料', esc((per.storage || '') + ' · 間隔 ' + (per.effectiveIntervalMin != null ? per.effectiveIntervalMin : (per.intervalMin || '-')) + ' 分 · 最久未存 ' + age(per.oldestUnsavedSec) +
				(per.maxAgeHours != null ? '（上限 ' + per.maxAgeHours + ' 小時）' : '') + (per.forcedByAge ? ' · 到期強制寫入 ' + K.fmtNum(per.forcedByAge) + ' 次' : '') + (per.lowSpace ? ' · 儲存空間不足（只寫核心資料）' : ''))],
			sp.reserveBytes != null ? ['儲存空間', esc('保留 ' + K.fmtNum(Math.round(sp.reserveBytes / 1024)) + ' KB（' + (sp.reserveAuto ? '自動' : '設定') + '）' + (sp.optionalBytes ? ' · 可重建的資料 ' + K.fmtNum(Math.round(sp.optionalBytes / 1024)) + ' KB' : ''))] : null,
			['加密協議', esc(protos.length ? protos.join(' · ') + (ls.ddr ? ' · DDR' : '') : '未開啟')],
			['過濾', esc(api.filter && api.filter.memoryBytes != null ? '記憶體 ' + (api.filter.memoryBytes / 1048576).toFixed(1) + ' MB' + (api.filter.domains != null ? ' · ' + K.fmtNum(api.filter.domains) + ' 個網域' : '') : '-')]
		]) + '</details>');

		var shed = mem.shed || [], fl = api.filter || {};
		if (shed.length || fl.notice || mem.floor) h += K.card('記憶體控制',
			(mem.protectedSuspended ? K.note('記憶體嚴重不足：連保護清單（惡意 / 反詐騙）都暫停了，只剩自訂規則；DNS 照常轉送。記憶體回來後自動恢復。', 'bad')
				: (mem.floor ? K.note('記憶體不足：只轉送 DNS（暫停 CDN 調整、快取最小）。記憶體回來後自動恢復。', 'bad') : '')) +
			(fl.notice ? K.note(esc(fl.notice), 'warn') : '') +
			'<p>目前：' + esc(mem.stateLabel || mem.state || '-') + '（系統可用 ' + mb(mem.availKB) + ' MB / 保留 ' + mb(mem.reserveKB) + ' MB）' + (mem.waiting ? ' · ' + esc(mem.waiting) : '') + '</p>' +
			K.table(['已釋出', '內容', '約', '時間'], shed.map(function (x) { return [esc(x.label), esc(x.detail || ''), (x.freedBytes / 1024).toFixed(0) + ' KB', K.time(x.at)]; }), '', [2]), { id: 'kuroshio-memory' });

		var ac = api.access;
		if (ac) h += K.card('連線來源',
			(ac.failOpen ? K.note('台灣 IP 資料讀不到，現在不擋任何來源（封鎖名單照樣有效）' + (ac.warning ? '：' + esc(ac.warning) : ''), 'bad') : (ac.warning ? K.note(esc(ac.warning), 'warn') : '')) +
			'<p><b>' + esc({ taiwan: '只開放台灣', custom: '自訂 ISP', open: '全開放' }[ac.mode] || ac.mode || '-') + '</b> · 已拒絕 ' + K.fmtNum(ac.denied && ac.denied.total) + ' 次（啟動後）' +
			(ac.generatedAt ? ' · 台灣 IP 資料 ' + esc(ac.generatedAt) : '') + ' · <a href="#access">設定</a></p>', { id: 'kuroshio-access' });

		var detail = [].concat(api.listenersDetail || []);
		if (detail.length) h += K.card('加密監聽', listenerTable(detail), { id: 'kuroshio-listeners' });

		/* 3.4.0 串接：前面有另一台黑潮（例如主路由器）時自動串接，共用它的評測結果與 CDN 節點 */
		var ch = api.chain;
		if (ch && (ch.state !== 'none' || (ch.serving && (ch.serving.downstreams || []).length))) h += chainCard(ch);
		h += K.card('上游', '<p class="tw-small tw-muted">' + (api.autoUpstreams ? '自動上游來自 ' + esc(K.time(api.autoUpstreams.generatedAt)) + ' 的評測' : '還沒有每日評測結果，暫時使用固定上游與備援。') + '</p>' +
			K.table(['上游', '角色', '成功', '失敗', '平均延遲', ''], (api.upstreams || []).map(function (u) {
				return ['<span class="kr-break">' + esc(u.id) + '</span>', esc({ pinned: '固定', auto: '自動', fallback: '備援', chain: '串接（上游黑潮）' }[u.role] || u.role), K.fmtNum(u.ok), K.fmtNum(u.fail), u.avgMs != null ? u.avgMs + ' ms' : '-', u.paused ? K.badge('暫停中', 'warn') : ''];
			}), '沒有上游', [2, 3, 4]));

		var jobs = api.jobs || {};
		h += K.card('排程工作', K.table(['工作', '排程', '上次結束', '結果', ''], Object.keys(jobs.config || {}).map(function (n) {
			var c = jobs.config[n], s = (jobs.state || {})[n] || {}, run = jobs.running && jobs.running.name === n;
			return [esc(JOBS[n] || n),
				esc((c.monthDays ? '每月 ' + [].concat(c.monthDays).join(',') + ' 日' + (c.jitterDays ? '起（每台錯開）' : '') + ' ' : '') + [].concat(c.at || []).join(', ') + (c.weekdays ? '（' + [].concat(c.weekdays).map(function (w) { return '週' + ('日一二三四五六'.charAt(+w) || w); }).join('、') + '）' : '') + (c.enabled === false ? ' 已停用' : '')),
				run ? K.badge('執行中…', 'info') : K.time(s.lastEnd),
				/* 3.4.0 catchUpWaiting、3.4.2 catchUpProvided（串接中由上游提供的工作不補跑） */
				esc((jobs.detail && jobs.detail[n] && jobs.detail[n].text) || ((jobs.catchUpProvided || []).indexOf(n) >= 0 ? '由上游黑潮提供，暫不補跑' :
					(jobs.catchUpWaiting || []).indexOf(n) >= 0 ? '等補跑時段（' + (jobs.catchUpWindow || '-') + '）' : '') || (s.lastCode === 0 ? '成功' : (s.lastCode == null ? '-' : '失敗（' + s.lastCode + '）'))),
				K.btn('立即執行', 'job', { arg: n, disabled: run })];
		}), '沒有排程工作') + ((jobs.queue || []).length ? '<p class="tw-small tw-muted">排隊中：' + esc(jobs.queue.map(function (x) { return (JOBS[x.name] || x.name) + (x.reason ? '（' + x.reason + '）' : ''); }).join('、')) + '</p>' : ''));

		var extra = [];
		if (api.ownIp) extra.push(['網域目前指向', esc((api.ownIp.ips || []).join(', ') + (api.ownIp.changedAt ? '（' + K.time(api.ownIp.changedAt) + ' 變更）' : ''))]);
		if (api.tls && api.tls.info) { var ti = api.tls.info; extra.push(['憑證', esc((ti.san || ti.subject || '') + ' · 到期 ' + ti.validTo + '（剩 ' + ti.daysLeft + ' 天）')]); }
		if (extra.length) h += K.card('其他', K.kv(extra));

		var errs = (api.errors && api.errors.recent) || [];
		if (errs.length) h += K.card('最近的錯誤（共 ' + api.errors.count + ' 次）', K.pre(errs.slice(0, 10).map(function (e) { return K.time(e.at, 'sec') + '  ' + e.msg; }).join('\n')));
		return h;
	}
	/* 串接卡片（比照黑潮 LuCI ui-core.js 的 chainView，3.4.4）：句子照 API 的 text 整句顯示，
	 * 這裡只把狀態做成標籤、把其他欄位整理成「標籤：值」。原因代碼放在句子後面的括號，給回報問題時用 */
	var CHAIN_CALM = { 'not-allowed': 1, 'upstream-too-old': 1, 'unsupported': 1, 'gone': 1 };
	var CHAIN_KIND = { upstreams: '上游評測結果', 'cdn-pools': 'CDN 節點池', 'cdn-v6': 'CDN IPv6 節點', 'cdn-ranges': 'CDN 官方範圍', 'filter-copy': '過濾清單副本' };
	var CHAIN_ERR = {
		'no-room': '這台留不下副本', 'not-subscribed': '這台沒有訂閱這份清單', 'newer-format': '格式比這台新', 'hash-mismatch': '內容跟清單對不上',
		'too-large': '太大', 'memory': '記憶體不夠，這次沒有同步', 'no-share': '上游還沒有共用結果', 'no-response': '上游沒有回應', 'no-tcp': '上游不能用 TCP 傳',
		'key-changed': '上游換了節點金鑰', 'import-failed': '匯入失敗', 'own-newer': '這台自己的比較新（不算失敗）'
	};
	function chainCard(c) {
		var rows = [], more = [], u = c.upstream, sv = c.serving || {}, ds = sv.downstreams || [], sh = c.shared, au = c.audit;
		var row = function (l, v) { if (v !== null && v !== undefined && v !== '') rows.push([l, v]); };
		/* 版面：常看的留在外面，其餘收進「更多細節」 */
		var row2 = function (l, v) { if (v !== null && v !== undefined && v !== '') more.push([l, v]); };
		var errText = function (e) { return esc(CHAIN_ERR[e] ? CHAIN_ERR[e] + '（' + e + '）' : e); };
		var keyChanged = !!(u && u.keyChangedAt && Date.now() - u.keyChangedAt < 86400000);
		var b;
		if (c.enabled === false) b = ['已關閉', 'off'];
		else if (c.state === 'chained') b = c.backupActive ? ['串接中（暫時用自己的上游）', 'warn'] : ['串接中', 'ok'];
		else if (c.state === 'detected' || c.state === 'verifying') b = ['驗證中', 'warn'];
		else if (c.state === 'released') b = ['沒有串接', CHAIN_CALM[c.reason] ? 'off' : 'warn'];
		else b = ['沒有偵測到', 'off'];
		var warn = b[1] === 'warn' || keyChanged || /重複/.test(c.text || '');
		if (u) {
			row('上游', u.address ? esc(u.address) + (u.via === 'intercept' ? '（經攔截）' : '') + (u.proto ? ' · ' + esc(String(u.proto).toUpperCase()) : '') + (u.version ? ' · 黑潮 ' + esc(u.version) : '') : null);
			row2('上游指紋', u.fingerprint ? '<code>' + esc(u.fingerprint) + '</code>' : null);
			if (keyChanged) row('換過的舊指紋', '<code>' + esc(u.previousFingerprint || '?') + '</code>（' + K.time(u.keyChangedAt) + ' 換過）');
			if (c.state === 'chained') {
				row2('串接層數', (u.depth || 2) + ' 層（上限 4 層）' + (u.viaNat ? ' · 經 NAT' : ''));
				row2('串接開始', u.since ? K.time(u.since) : null);
				row('上游最後確認（心跳）', u.lastOkAt ? K.time(u.lastOkAt, 'sec') : null);
			}
			if (u.failures) row('連續失敗', u.failures + ' 次');
			/* 3.4.4：鎖定的指紋（chain_pin）不符時不會向上游登記 */
			var r = u.registered;
			if (r) row('向上游登記', r.ok ? '已登記 ' + K.fmtNum(r.names || 0) + ' 個主機名稱，到期 ' + K.time(r.expiresAt) : '登記失敗' + (r.error ? '：' + esc(r.error) : ''));
		}
		if (c.backupActive) row('目前的上游', '暫時用自己的加密上游');
		if (c.retryAt) row('下次重試', K.time(c.retryAt, 'sec'));
		if (sh) {
			row2('共用結果上次同步', sh.lastSyncAt ? K.time(sh.lastSyncAt) + (sh.error ? ' · ' + errText(sh.error) : '') : (sh.error ? errText(sh.error) : '還沒同步'));
			var objs = (sh.objects || []).map(function (o) {
				return esc(CHAIN_KIND[o.kind] || o.kind) + ' ' + (o.error ? K.badge('沒有匯入', 'warn') + ' ' + errText(o.error) : (o.fresh ? K.badge('新鮮', 'ok') : K.badge('過期（照排程自己做）', 'off')));
			});
			if (objs.length) row2('共用的內容', objs.join('<br>'));
			if ((sh.skippedJobs || []).length) row2('這台跳過的工作', esc(sh.skippedJobs.map(function (j) { return JOBS[j] || j; }).join('、')) + '（由上游提供）');
		}
		/* 3.4.2：抽查上游給的 CDN 節點 */
		if (au && au.sampled) row2('抽查上游的答案', '抽查 ' + K.fmtNum(au.sampled) + ' 筆：正確 ' + K.fmtNum(au.valid) + ' · 無法驗證 ' + K.fmtNum(au.unverified) +
			(au.siteInvalid ? ' · 網站本身異常 ' + K.fmtNum(au.siteInvalid) : '') + ' · 可疑 ' + K.fmtNum(au.suspicious) + (au.releases ? ' · 因此解除串接 ' + K.fmtNum(au.releases) + ' 次' : ''));
		var text = esc(c.text || '沒有串接的資料') + (c.reason ? ' <span class="tw-small tw-muted">（' + esc(c.reason) + '）</span>' : '');
		return K.card('串接', '<p>' + K.badge(b[0], b[1]) + '</p>' + (warn ? K.note(text, 'warn') : '<p>' + text + '</p>') + (rows.length ? K.kv(rows) : '') +
			(more.length ? '<details class="kr-more"' + (KR_MORE_CH ? ' open' : '') + ' ontoggle="KR_MORE_CH=this.open"><summary>更多細節</summary>' + K.kv(more) + '</details>' : '') +
			(sv.text ? '<p class="tw-small tw-muted">' + esc(sv.text) + (ds.length ? '：' + ds.map(function (d) { return esc(d.address || d.ip || d.nodeId || ''); }).join('、') : '') + '</p>' : ''), { id: 'kuroshio-chain' });
	}
	function listenerTable(detail) {
		var P = { doh: 'DoH（TCP）', doh3: 'DoH3（UDP）', dot: 'DoT（TCP）', doq: 'DoQ（UDP）' };
		return K.table(['協議', '位址', '埠號', '狀態'], [].concat(detail || []).map(function (x) {
			return [esc(P[x.proto] || x.proto), esc(x.bind), esc(x.port), x.ok ? K.badge(x.proto == 'doh' ? (x.tls ? '執行中（TLS）' : '執行中（純 HTTP）') : '執行中', 'ok')
				: K.badge('綁定失敗', 'err') + '<div class="tw-small" style="color:var(--bad)">' + esc(x.error || '原因不明（請看日誌）') + '</div>'];
		}), '沒有開啟任何加密協議（DoH / DoT / DoQ）', [2]);
	}
	K.listenerTable = listenerTable;

	function actions() {
		var ddnsOn = K.nvGet('kuroshio_ddns') == '1';
		return K.card('操作', '<div class="tw-actions">' + K.btn('清除快取', 'flushCache') + K.btn('更新過濾清單', 'updateLists') + K.btn('立即更新 DDNS', 'ddns', { disabled: !ddnsOn }) +
			(ddnsOn ? '' : '<span class="tw-cost">DDNS 沒有開啟（在「基本設定」設定）</span>') + '</div>' +
			'<div class="tw-actions" style="margin-top:12px">' + K.btn('立即儲存學習資料', 'persist', { primary: true, id: 'kuroshio-persist-flush' }) +
			'<span class="tw-cost">更新韌體或要斷電前先按一下，學到的資料會馬上寫進儲存空間</span></div><div id="kr-persist-out" class="tw-small" role="status"></div>');
	}
	function draw() {
		return Promise.all([K.api('status'), K.view('/api/status', { lite: 1 })]).then(function (r) {
			var el = U.$('kr-status');
			if (el) el.innerHTML = body(r[0], r[1]);
		});
	}
	K.page('status', {
		render: function () { return '<div id="kr-status">' + U.stateBox('loading') + '</div>' + actions(); },
		after: function () { K.every(draw, 10000); },
		hooks: { act: {
			job: function (n) { return K.action('/api/jobs/run', { name: n }).then(function (r) { if (K.done(r, '已排入背景執行')) draw(); }); },
			flushCache: function () { return K.action('/api/cache/flush').then(function (r) { K.done(r, '快取已清除'); }); },
			updateLists: function () { return K.updateLists(); },
			ddns: function () { return K.action('/api/ddns/update').then(function (r) { K.done(r, 'DDNS 已更新'); }); },
			/* 3.2.0：立即儲存學習資料（POST /api/persist/flush），顯示時間、寫了幾份、多大 */
			persist: function () {
				return K.action('/api/persist/flush').then(function (r) {
					var x = K.done(r);
					if (!x) return;
					var at = K.time(x.at, 'sec');
					var t = x.files ? '已儲存學習資料（' + at + '）：寫了 ' + x.files + ' 份快照，共 ' + K.bytes(x.bytes) : '已儲存學習資料（' + at + '）：沒有新的變動，不需要寫入';
					U.toast(t, 'ok');
					U.set('kr-persist-out', esc(t) + (x.dir ? '<br>位置：<code>' + esc(x.dir) + '</code>' : ''));
				});
			}
		} }
	});

	/* =====================================================================
	 * 儀表板：跟 LuCI 共用黑潮 DNS 的 dashboard.js（韌體的 /usr/share/kuroshio/dashboard，www 用連結指過去）
	 * ===================================================================== */
	var dashP = null;
	function loadDash() {
		if (window.KuroshioDashboard) return Promise.resolve(true);
		if (dashP) return dashP;
		var css = document.createElement('link');
		css.rel = 'stylesheet'; css.href = '/kuroshio/dashboard.css';
		document.head.appendChild(css);
		return (dashP = new Promise(function (res) {
			var s = document.createElement('script');
			s.src = '/kuroshio/dashboard.js';
			s.onload = function () { res(!!window.KuroshioDashboard); };
			s.onerror = function () { dashP = null; res(false); };
			document.head.appendChild(s);
		}));
	}
	/* 儀表板的顏色跟著後台的主題（淺色／深色） */
	function theme(root) {
		var cs = getComputedStyle(document.documentElement), v = function (n) { return cs.getPropertyValue(n).trim(); };
		var map = { '--text': v('--text'), '--text-2': v('--text'), '--text-3': v('--muted'), '--bg': v('--bg'), '--glass': v('--surface'), '--glass-2': v('--surface-2'),
			'--glass-edge': v('--line'), '--line': v('--line'), '--chip': v('--surface-2'), '--track': v('--surface-2'), '--accent': v('--accent'), '--btn': v('--accent'),
			'--ok': v('--good'), '--warn': v('--warn'), '--bad': v('--bad'), '--shadow': 'none', '--kd-radius': '12px' };
		Object.keys(map).forEach(function (k) { if (map[k]) root.style.setProperty(k, map[k]); });
		root.setAttribute('data-kd-host', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	}
	var mounted = null;
	K.page('dashboard', {
		render: function () {
			return '<p class="tw-lead">查詢量、加速成效、上游、CDN 台灣節點與網域資料庫、過濾規則、排程工作。資料直接從路由器上的黑潮 DNS 讀取（完整資料，不受公開頁的人數門檻限制），不需要開任何埠。</p><div id="kr-dash" class="kd-theme kr-dash">' + U.stateBox('loading') + '</div>';
		},
		after: function () {
			loadDash().then(function (ok) {
				var root = U.$('kr-dash');
				if (!root) return;
				if (!ok) { root.innerHTML = U.stateBox('unavailable', '讀不到儀表板程式（/kuroshio/dashboard.js），這個韌體可能沒有附帶，請更新韌體'); return; }
				root.innerHTML = '';
				theme(root);
				var KD = window.KuroshioDashboard;
				var call = function (path, params) {
					return K.api('api', path, params).then(function (r) {
						if (!r || r.ok === false) throw new Error((r && r.error) || '服務沒有回應（可能尚未啟動）');
						return r.result;
					});
				};
				if (mounted && mounted.destroy) try { mounted.destroy(); } catch (e) {}
				mounted = KD.mount(root, { adapter: KD.callAdapter(call), sections: KD.ADMIN_SECTIONS, idPrefix: 'kd-', rich: true, toolbar: true,
					domainsMode: 'server', showErrors: true, refreshMs: 15000 });
			});
		}
	});
	window.addEventListener('hashchange', function () {
		/* 離開儀表板就停止自動更新 */
		if (location.hash != '#dashboard' && mounted) { try { if (mounted.destroy) mounted.destroy(); else if (mounted.stop) mounted.stop(); } catch (e) {} mounted = null; }
	});

	/* =====================================================================
	 * 日誌（op=log）
	 * ===================================================================== */
	K.page('log', {
		render: function () {
			return K.card('最近的執行紀錄', '<div class="tw-toolbar"><label class="tw-switch"><input type="checkbox" id="kr-log-follow" checked><span class="tw-track"></span>自動捲到最新</label>' +
				'<span class="tw-small tw-muted">系統日誌裡黑潮 DNS 的部分，每 5 秒更新。要看每一筆查詢，請在「基本設定」的專業模式打開「記錄每筆查詢」。</span></div>' + K.pre('讀取中…', 'kr-log'));
		},
		after: function () {
			K.every(function () {
				return K.api('log', null, null, false, '&n=300').then(function (r) {
					var el = U.$('kr-log');
					if (!el) return;
					el.textContent = r && r.ok !== false && (r.lines || []).length ? r.lines.join('\n') : (r && r.error) || '沒有紀錄（服務可能還沒啟動）';
					if (U.$('kr-log-follow') && U.$('kr-log-follow').checked) el.scrollTop = el.scrollHeight;
				});
			}, 5000);
		}
	});
})(KURO);
