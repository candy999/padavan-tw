/*
 * padavan-tw 新介面：共用元件與資料層
 *
 * - TW.api(名稱)：依 docs/HANDOFF-UI.md 第 6 節的約定取得 JSON。
 *   先問 /tw_api.asp（B 階段實作）；沒有回應時，改用路由器現有的資料（tw_status.asp 等）組出能給的部分；
 *   都沒有就回傳 { available: false }，畫面顯示「功能未提供」，不顯示假資料。
 * - 元件：狀態點、結論卡、指標卡、時間序列圖（純 SVG）、清單／卡片、事件時間軸、
 *   套用確認對話框、空狀態／載入中／錯誤／功能未提供、QR 碼、可複製欄位。
 * - 寫入設定：TW.apply()／TW.listAdd()，沿用 /start_apply.htm 的表單機制。
 *
 * 注意：httpd 會處理 .js 裡的範本標記，這個檔案不能出現「小於號＋百分比」或「小於號＋井字號」的連續字元。
 */
var TW = (function () {
	'use strict';

	/* ---------- 小工具 ---------- */
	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}
	/* nvram_get_x 會把 " & < > 轉成 &#nn;，這裡轉回來 */
	function unent(s) {
		return String(s == null ? '' : s).replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); });
	}
	function $id(id) { return document.getElementById(id); }
	function num(n, d) {
		if (n == null || isNaN(n)) return '--';
		return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: 0 });
	}
	function fmtRate(kbps) {
		if (kbps == null || isNaN(kbps)) return { v: '--', u: '' };
		if (kbps >= 1000000) return { v: num(kbps / 1000000, 2), u: 'Gbps' };
		if (kbps >= 1000) return { v: num(kbps / 1000, kbps >= 100000 ? 0 : 1), u: 'Mbps' };
		return { v: num(kbps, 0), u: 'kbps' };
	}
	function rateText(kbps) { var r = fmtRate(kbps); return r.v + (r.u ? ' ' + r.u : ''); }
	function fmtBytes(b) {
		if (b == null || isNaN(b)) return '--';
		var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
		while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
		return num(b, i >= 3 ? 2 : (i ? 1 : 0)) + ' ' + u[i];
	}
	function fmtDur(sec) {
		if (sec == null || isNaN(sec) || sec < 0) return '--';
		sec = Math.floor(sec);
		var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
		if (d) return d + ' 天' + (h ? ' ' + h + ' 小時' : '');
		if (h) return h + ' 小時' + (m ? ' ' + m + ' 分' : '');
		if (m) return m + ' 分鐘';
		return sec + ' 秒';
	}
	function pad2(n) { return (n < 10 ? '0' : '') + n; }
	function fmtTime(ts, withDate) {
		if (!ts) return '--';
		var d = new Date(ts * 1000), now = new Date();
		var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
		if (!withDate && d.toDateString() == now.toDateString()) return hm;
		var y = new Date(now.getTime() - 86400000);
		if (!withDate && d.toDateString() == y.toDateString()) return '昨天 ' + hm;
		return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
	}
	function fmtAgo(ts) {
		if (!ts) return '從未';
		var s = Math.floor(Date.now() / 1000 - ts);
		if (s < 60) return '剛剛';
		if (s < 3600) return Math.floor(s / 60) + ' 分鐘前';
		if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
		return Math.floor(s / 86400) + ' 天前';
	}
	/* 訊號強度白話等級（5.3 原則 6：每個數字都有參考） */
	function signal(dbm) {
		if (dbm == null || isNaN(dbm)) return { state: 'unknown', label: '--' };
		if (dbm >= -65) return { state: 'ok', label: '強' };
		if (dbm >= -75) return { state: 'warn', label: '普通' };
		return { state: 'bad', label: '弱' };
	}
	/* nvram 清單裡的 MAC 多半沒有冒號（例如 dhcp_staticmac_x 只有 14 字元），比對前先統一 */
	function macKey(mac) { return String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, ''); }
	function macColon(mac) { var k = macKey(mac); return k.length == 12 ? k.match(/../g).join(':') : String(mac || ''); }
	function maskMac(mac) {
		var p = String(mac || '').split(':');
		return p.length == 6 ? p[0] + ':' + p[1] + ':' + p[2] + ':··:··:' + p[5] : mac;
	}
	function isPrivateIp(ip) {
		var a = String(ip || '').split('.').map(function (x) { return parseInt(x, 10); });
		if (a.length != 4 || isNaN(a[0])) return false;
		return a[0] == 10 || a[0] == 127 || a[0] == 0 || (a[0] == 172 && a[1] >= 16 && a[1] <= 31) ||
			(a[0] == 192 && a[1] == 168) || (a[0] == 169 && a[1] == 254);
	}
	function isCgnatIp(ip) {
		var a = String(ip || '').split('.').map(function (x) { return parseInt(x, 10); });
		return a.length == 4 && a[0] == 100 && a[1] >= 64 && a[1] <= 127;
	}
	function qs(name) {
		var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
		return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
	}

	/* ---------- 圖示（線條，stroke 2，跟隨文字顏色） ---------- */
	var ICONS = {
		home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
		devices: '<rect x="3" y="4" width="13" height="10" rx="2"/><rect x="15" y="9" width="6" height="11" rx="1"/><path d="M7 18h5"/>',
		wifi: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="M8 14a4 4 0 0 1 8 0"/><circle cx="12" cy="14" r="1"/><path d="M5 19h14"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
		remote: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="M9 12l2 2 4-4"/>',
		gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
		gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M4.9 4.9l2.1 2.1"/><path d="M17 17l2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M4.9 19.1 7 17"/><path d="M17 7l2.1-2.1"/>',
		sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><circle cx="18" cy="18" r="2"/>',
		more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
		phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
		computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
		tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
		game: '<path d="M6 9h12a3 3 0 0 1 3 3v3a2 2 0 0 1-3.4 1.4L15 14H9l-2.6 2.4A2 2 0 0 1 3 15v-3a3 3 0 0 1 3-3z"/><path d="M8 11v2"/><path d="M7 12h2"/>',
		iot: '<circle cx="12" cy="12" r="3"/><path d="M5 5a10 10 0 0 0 0 14"/><path d="M19 5a10 10 0 0 1 0 14"/>',
		other: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
		nas: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>',
		camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
		router: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01"/><path d="M12 13V8"/><path d="M8.5 6a5 5 0 0 1 7 0"/>',
		cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>',
		dns: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
		isp: '<path d="M12 21V8"/><path d="M8 21h8"/><path d="M6 8a6 6 0 0 1 12 0"/><path d="M3.5 5.5a10 10 0 0 1 17 0"/>',
		chevron: '<path d="m9 6 6 6-6 6"/>',
		check: '<path d="m5 12 5 5 9-10"/>',
		alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
		x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
		copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
		qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3"/><path d="M21 14v7h-7"/>',
		pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
		play: '<path d="M7 5l12 7-12 7z"/>',
		edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
		pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
		power: '<path d="M12 3v9"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
		restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
		download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
		upload: '<path d="M12 20V9"/><path d="M7 14l5-5 5 5"/><path d="M5 4h14"/>',
		plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
		link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
	};
	function icon(name, size) {
		var sz = size || 18;
		return '<svg class="tw-ico" width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.other) + '</svg>';
	}

	/* ---------- 狀態語彙（5.3 原則 7：不嚇人） ---------- */
	var STATE_LABEL = { ok: '正常', warn: '注意', bad: '問題', unknown: '未知', off: '關閉' };
	function dot(state, label) {
		var s = STATE_LABEL[state] ? state : 'unknown';
		return '<span class="tw-dot tw-s-' + s + '" role="img" aria-label="' + esc(label || STATE_LABEL[s]) + '"></span>';
	}
	function chip(state, text) {
		var s = STATE_LABEL[state] ? state : 'unknown';
		return '<span class="tw-chip tw-s-' + s + '">' + esc(text || STATE_LABEL[s]) + '</span>';
	}
	function worst(states) {
		var rank = { bad: 3, warn: 2, unknown: 1, ok: 0, off: 0 }, w = 'ok';
		for (var i = 0; i < states.length; i++) if ((rank[states[i]] || 0) > rank[w]) w = states[i];
		return w;
	}

	/* ---------- 版面元件 ---------- */
	function pageHead(o) {
		var h = '<header class="tw-head"><div class="tw-head-text">';
		if (o.crumbs) h += '<nav class="tw-crumbs" aria-label="位置">' + o.crumbs.map(function (c) {
			return c.href ? '<a href="' + esc(c.href) + '">' + esc(c.label) + '</a>' : '<span>' + esc(c.label) + '</span>';
		}).join(' / ') + '</nav>';
		h += '<h1>' + esc(o.title) + (o.chip ? ' ' + o.chip : '') + '</h1>';
		if (o.sub) h += '<p class="tw-sub">' + o.sub + '</p>';
		h += '</div>';
		if (o.actions) h += '<div class="tw-head-actions">' + o.actions + '</div>';
		return h + '</header>';
	}
	function card(o) {
		var id = o.id ? ' id="' + esc(o.id) + '"' : '';
		var h = '<section class="tw-card' + (o.cls ? ' ' + o.cls : '') + '"' + id + (o.title ? ' aria-label="' + esc(o.title) + '"' : '') + '>';
		if (o.title || o.extra) {
			h += '<div class="tw-card-head"><h2>' + esc(o.title || '') + (o.badge ? ' ' + o.badge : '') + '</h2>';
			if (o.extra) h += '<div class="tw-card-extra">' + o.extra + '</div>';
			h += '</div>';
		}
		if (o.lead) h += '<p class="tw-lead">' + o.lead + '</p>';
		h += '<div class="tw-card-body"' + (o.bodyId ? ' id="' + esc(o.bodyId) + '"' : '') + '>' + (o.body || '') + '</div>';
		return h + '</section>';
	}
	/* 結論卡：先回答問題，再給數字（5.3 原則 1） */
	function conclusion(o) {
		var ic = { ok: 'check', warn: 'alert', bad: 'alert', unknown: 'info', off: 'info' }[o.state] || 'info';
		return '<div class="tw-conclusion tw-s-' + (o.state || 'unknown') + '">' +
			'<span class="tw-conclusion-ico">' + icon(ic, 20) + '</span>' +
			'<div><div class="tw-conclusion-title">' + esc(o.title) + '</div>' +
			(o.sub ? '<div class="tw-conclusion-sub">' + o.sub + '</div>' : '') + '</div></div>';
	}
	/* 指標卡：數字＋參考值＋迷你曲線 */
	function metric(o) {
		var cls = 'tw-metric' + (o.state ? ' tw-v-' + o.state : '');
		var h = '<div class="' + cls + '"><div class="tw-metric-label">' + esc(o.label) + '</div>';
		h += '<div class="tw-metric-value"><span class="tw-num">' + esc(o.value) + '</span>' + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') + '</div>';
		if (o.ref) h += '<div class="tw-metric-ref">' + o.ref + '</div>';
		if (o.spark && o.spark.length > 1) h += spark(o.spark, o.sparkColor);
		return h + '</div>';
	}
	function spark(values, color) {
		var v = values.filter(function (x) { return x != null; });
		if (v.length < 2) return '';
		var max = Math.max.apply(null, v), min = Math.min.apply(null, v);
		if (max == min) { max += 1; min -= 1; }
		var d = '', n = values.length, first = true;
		values.forEach(function (x, i) {
			if (x == null) { first = true; return; }
			var px = (i / (n - 1)) * 100, py = 26 - ((x - min) / (max - min)) * 24;
			d += (first ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
			first = false;
		});
		return '<svg class="tw-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (color || 'var(--accent)') + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
	}
	/*
	 * 時間序列圖（純 SVG）
	 * o.series: [{ values, color, label, area }]；o.step、o.start：第 6 節的序列格式（秒）
	 * o.guide: { value, label } 參考線；o.bands: [{ from, to, color }] 背景區間；o.marks: [Unix 秒] 事件直線
	 * o.unit、o.fmt(v)：Y 軸標示；o.label：給螢幕閱讀器的說明
	 */
	function chart(o) {
		var W = 600, H = o.height || 160, padT = 8, padB = 4;
		var all = [];
		o.series.forEach(function (s) { (s.values || []).forEach(function (x) { if (x != null) all.push(x); }); });
		if (!all.length) return stateBox('warming', o.emptyText || '還沒有資料');
		var max = o.max != null ? o.max : Math.max.apply(null, all.concat(o.guide ? [o.guide.value] : []));
		var min = o.min != null ? o.min : Math.min(0, Math.min.apply(null, all));
		if (max == min) max = min + 1;
		if (o.max == null) max = max + (max - min) * 0.08;
		var n = 0;
		o.series.forEach(function (s) { n = Math.max(n, (s.values || []).length); });
		function X(i) { return n > 1 ? (i / (n - 1)) * W : 0; }
		function Y(v) { return padT + (1 - (v - min) / (max - min)) * (H - padT - padB); }
		var g = '';
		(o.bands || []).forEach(function (b) {
			var y1 = Y(Math.min(max, b.to)), y2 = Y(Math.max(min, b.from));
			g += '<rect x="0" y="' + y1.toFixed(1) + '" width="' + W + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="' + b.color + '"/>';
		});
		[0.25, 0.5, 0.75].forEach(function (f) {
			var y = (padT + f * (H - padT - padB)).toFixed(1);
			g += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" class="tw-grid"/>';
		});
		if (o.guide) {
			var gy = Y(o.guide.value).toFixed(1);
			g += '<line x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" class="tw-guide"/>';
		}
		if (o.marks && o.start && o.step) o.marks.forEach(function (t) {
			var i = (t - o.start) / o.step;
			if (i < 0 || i > n - 1) return;
			g += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="0" y2="' + H + '" class="tw-mark"/>';
		});
		o.series.forEach(function (s) {
			var d = '', area = '', open = false, segStart = 0;
			(s.values || []).forEach(function (v, i) {
				if (v == null) {
					if (open && s.area) area += 'L' + X(i - 1).toFixed(1) + ' ' + H + ' L' + X(segStart).toFixed(1) + ' ' + H + ' Z ';
					open = false; return;
				}
				var p = X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
				if (!open) { d += 'M' + p + ' '; if (s.area) area += 'M' + p + ' '; segStart = i; open = true; }
				else { d += 'L' + p + ' '; if (s.area) area += 'L' + p + ' '; }
			});
			if (open && s.area) area += 'L' + X(s.values.length - 1).toFixed(1) + ' ' + H + ' L' + X(segStart).toFixed(1) + ' ' + H + ' Z';
			if (area) g += '<path d="' + area + '" fill="' + s.color + '" fill-opacity="0.12"/>';
			g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';
		});
		var fmt = o.fmt || function (v) { return num(v); };
		var h = '<div class="tw-chart">';
		h += '<div class="tw-chart-y"><span>' + esc(fmt(max)) + '</span><span>' + esc(fmt(min)) + '</span></div>';
		h += '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(o.label || '') + '" style="height:' + H + 'px">' + g + '</svg>';
		if (o.start && o.step && n > 1) {
			var t0 = o.start, t1 = o.start + o.step * (n - 1);
			h += '<div class="tw-chart-x tw-num"><span>' + fmtTime(t0) + '</span><span>' + fmtTime((t0 + t1) / 2) + '</span><span>' + fmtTime(t1) + '</span></div>';
		}
		if (o.series.length > 1 || o.guide) {
			h += '<div class="tw-legend">' + o.series.map(function (s) {
				return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + '</span>';
			}).join('') + (o.guide ? '<span><i class="tw-legend-guide"></i>' + esc(o.guide.label) + '</span>' : '') + '</div>';
		}
		return h + '</div>';
	}
	/* 事件時間軸 */
	var EVENT_ICON = { wan: 'globe', channel: 'wifi', device: 'devices', qos: 'gauge', dns: 'dns', system: 'gear', roam: 'wifi', vpn: 'remote' };
	function timeline(events, empty) {
		if (!events || !events.length) return stateBox('empty', empty || '這段時間沒有事件');
		return '<ol class="tw-timeline">' + events.map(function (e) {
			return '<li class="tw-s-' + (e.level || 'ok') + '"><span class="tw-tl-ico">' + icon(EVENT_ICON[e.type] || 'info', 16) + '</span>' +
				'<div class="tw-tl-body"><div class="tw-tl-text">' + esc(e.text) + '</div>' +
				'<div class="tw-tl-meta tw-num">' + fmtTime(e.ts) + (e.device ? ' · ' + esc(e.device) : '') + '</div></div></li>';
		}).join('') + '</ol>';
	}
	/* 清單：桌機表格、手機卡片 */
	function table(o) {
		if (!o.rows.length) return stateBox('empty', o.empty || '沒有項目');
		var h = '<div class="tw-table-wrap"><table class="tw-table"><thead><tr>';
		o.cols.forEach(function (c) { h += '<th' + (c.cls ? ' class="' + c.cls + '"' : '') + ' scope="col">' + esc(c.label) + '</th>'; });
		h += '</tr></thead><tbody>';
		o.rows.forEach(function (r) {
			h += '<tr' + (r._attr ? ' ' + r._attr : '') + '>';
			o.cols.forEach(function (c) {
				h += '<td data-label="' + esc(c.label) + '"' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (r[c.key] == null ? '' : r[c.key]) + '</td>';
			});
			h += '</tr>';
		});
		return h + '</tbody></table></div>';
	}
	/* 空狀態／載入中／錯誤／功能未提供／資料收集中 */
	function stateBox(kind, text, extra) {
		var def = {
			loading: '讀取中…',
			empty: '沒有資料',
			error: '讀取失敗，稍後會自動重試',
			unavailable: '這個功能需要更新韌體後才能使用',
			warming: '資料收集中，約需 10 分鐘'
		};
		var ic = { loading: 'clock', empty: 'info', error: 'alert', unavailable: 'info', warming: 'clock' }[kind] || 'info';
		return '<div class="tw-state tw-state-' + kind + '" role="status">' + icon(ic, 18) + '<span>' + esc(text || def[kind]) + '</span>' + (extra || '') + '</div>';
	}
	/* 回應不能用時，回傳對應的狀態框；能用則回傳 null */
	function guard(r, opt) {
		opt = opt || {};
		if (!r) return stateBox('loading');
		if (r._error) return stateBox('error', opt.error);
		if (r.available === false) return stateBox('unavailable', opt.unavailable);
		if (r.warming_up) return stateBox('warming', opt.warming);
		return null;
	}
	function button(label, o) {
		o = o || {};
		var cls = 'tw-btn' + (o.primary ? ' tw-btn-primary' : '') + (o.danger ? ' tw-btn-danger' : '') + (o.small ? ' tw-btn-sm' : '') + (o.ghost ? ' tw-btn-ghost' : '');
		var attrs = (o.id ? ' id="' + esc(o.id) + '"' : '') + (o.disabled ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '');
		var inner = (o.icon ? icon(o.icon, 16) : '') + '<span>' + esc(label) + '</span>';
		if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '"' + attrs + '>' + inner + '</a>';
		return '<button type="button" class="' + cls + '"' + attrs + (o.onclick ? ' onclick="' + esc(o.onclick) + '"' : '') + '>' + inner + '</button>';
	}
	/* 可複製的文字欄位 */
	function copyField(value, label, secret) {
		var id = 'twc' + Math.random().toString(36).slice(2, 8);
		return '<div class="tw-copy">' + (label ? '<span class="tw-copy-label">' + esc(label) + '</span>' : '') +
			'<code id="' + id + '"' + (secret ? ' data-secret="1" data-value="' + esc(value) + '">' + '••••••••' : '>' + esc(value)) + '</code>' +
			(secret ? '<button type="button" class="tw-btn tw-btn-sm tw-btn-ghost" onclick="TW.reveal(\'' + id + '\', this)">顯示</button>' : '') +
			'<button type="button" class="tw-btn tw-btn-sm tw-btn-ghost" onclick="TW.copy(\'' + id + '\', this)" aria-label="複製' + esc(label || '') + '">' + icon('copy', 16) + '<span>複製</span></button></div>';
	}
	function reveal(id, btn) {
		var el = $id(id);
		if (!el) return;
		var on = el.getAttribute('data-shown') == '1';
		el.textContent = on ? '••••••••' : el.getAttribute('data-value');
		el.setAttribute('data-shown', on ? '0' : '1');
		btn.textContent = on ? '顯示' : '隱藏';
	}
	function copy(id, btn) {
		var el = $id(id);
		if (!el) return;
		var text = el.getAttribute('data-value') || el.textContent;
		var done = function () {
			var s = btn.querySelector('span');
			if (s) { var old = s.textContent; s.textContent = '已複製'; setTimeout(function () { s.textContent = old; }, 1500); }
		};
		if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
		else { fallbackCopy(text); done(); }
	}
	function fallbackCopy(text) {
		var t = document.createElement('textarea');
		t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
		document.body.appendChild(t); t.select();
		try { document.execCommand('copy'); } catch (e) {}
		document.body.removeChild(t);
	}
	/* QR 碼（qrcode.js，UTF-8，中文 SSID 也正確） */
	function qrSvg(text, cell) {
		if (typeof qrcode !== 'function') return stateBox('error', '無法產生 QR 碼');
		if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
		var q = qrcode(0, 'M');
		q.addData(text);
		q.make();
		return '<div class="tw-qr">' + q.createSvgTag(cell || 5, 12) + '</div>';
	}
	function wifiQrText(ssid, psk, auth) {
		function e(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }
		var t = (!psk || auth == 'open') ? 'nopass' : 'WPA';
		return 'WIFI:T:' + t + ';S:' + e(ssid) + ';' + (t == 'nopass' ? '' : 'P:' + e(psk) + ';') + ';';
	}

	/* ---------- 對話框（套用前說清楚影響：5.3 原則 4） ---------- */
	var dlgResolve = null;
	function dialog(o) {
		var d = $id('tw-dialog');
		if (!d) {
			d = document.createElement('div');
			d.id = 'tw-dialog';
			d.className = 'tw-dialog-scrim';
			d.innerHTML = '<div class="tw-dialog" role="dialog" aria-modal="true" aria-labelledby="tw-dialog-title"></div>';
			document.body.appendChild(d);
			d.addEventListener('click', function (e) { if (e.target === d) closeDialog(false); });
			document.addEventListener('keydown', function (e) { if (e.key == 'Escape' && d.classList.contains('open')) closeDialog(false); });
		}
		var box = d.firstChild;
		var h = '<h2 id="tw-dialog-title">' + esc(o.title) + '</h2>';
		if (o.body) h += '<div class="tw-dialog-body">' + o.body + '</div>';
		if (o.impacts && o.impacts.length) {
			h += '<div class="tw-impacts"><div class="tw-impacts-title">套用後會發生</div><ul>' +
				o.impacts.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
		}
		if (o.confirmText) h += '<label class="tw-confirm-check"><input type="checkbox" id="tw-dialog-check"> ' + esc(o.confirmText) + '</label>';
		h += '<div class="tw-dialog-actions">';
		if (o.cancel !== false) h += '<button type="button" class="tw-btn" id="tw-dialog-cancel">' + esc(o.cancel || '取消') + '</button>';
		h += '<button type="button" class="tw-btn ' + (o.danger ? 'tw-btn-danger' : 'tw-btn-primary') + '" id="tw-dialog-ok"' + (o.confirmText ? ' disabled' : '') + '>' + esc(o.ok || '套用') + '</button></div>';
		box.innerHTML = h;
		d.classList.add('open');
		var ok = $id('tw-dialog-ok');
		var chk = $id('tw-dialog-check');
		if (chk) chk.onchange = function () { ok.disabled = !chk.checked; };
		ok.onclick = function () {
			if (o.onOk && o.onOk(box) === false) return;
			closeDialog(true);
		};
		var c = $id('tw-dialog-cancel');
		if (c) c.onclick = function () { closeDialog(false); };
		setTimeout(function () { var f = box.querySelector('input:not([type=checkbox]), select') || ok; f.focus(); }, 30);
		return new Promise(function (res) { dlgResolve = res; });
	}
	function closeDialog(v) {
		var d = $id('tw-dialog');
		if (d) d.classList.remove('open');
		if (dlgResolve) { var r = dlgResolve; dlgResolve = null; r(v); }
	}
	function toast(text, state) {
		var t = $id('tw-toast');
		if (!t) { t = document.createElement('div'); t.id = 'tw-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
		t.className = 'tw-toast tw-s-' + (state || 'ok') + ' show';
		t.textContent = text;
		clearTimeout(t._h);
		t._h = setTimeout(function () { t.className = 'tw-toast'; }, 3200);
	}

	/* ---------- 寫入設定：沿用 /start_apply.htm（HANDOFF 3.3） ---------- */
	function hiddenForm(fields) {
		var f = document.createElement('form');
		f.method = 'post';
		f.action = '/start_apply.htm';
		f.target = 'hidden_frame';
		f.style.display = 'none';
		Object.keys(fields).forEach(function (k) {
			var i = document.createElement('input');
			i.type = 'hidden'; i.name = k; i.value = fields[k] == null ? '' : fields[k];
			f.appendChild(i);
		});
		document.body.appendChild(f);
		return f;
	}
	function currentPage() { return location.pathname.replace(/^\//, '') || 'index.asp'; }
	/*
	 * o.sid：變數群組（例如 'WLANConfig11b;WLANConfig11a;'）
	 * o.fields：要寫入的 nvram 變數
	 * o.script：action_script（選用）
	 * o.impacts、o.title：確認對話框；o.noConfirm：不問
	 */
	function apply(o) {
		var go = function () {
			var fields = { current_page: o.page || currentPage(), next_page: '', sid_list: o.sid || '', group_id: '', action_mode: ' Apply ', action_script: o.script || '' };
			Object.keys(o.fields || {}).forEach(function (k) { fields[k] = o.fields[k]; });
			hiddenForm(fields).submit();
			if (typeof showLoading === 'function') showLoading();
			return true;
		};
		if (o.noConfirm) return Promise.resolve(go());
		return dialog({ title: o.title || '套用設定？', body: o.body, impacts: o.impacts, ok: o.ok, danger: o.danger, confirmText: o.confirmText })
			.then(function (yes) { return yes ? go() : false; });
	}
	/*
	 * 清單類設定（ManualDHCPList、MFList、VSList…）：先 " Add "（或 " Del "）再 " Restart "，與舊頁面相同
	 * 新增：o.fields 是 <變數>_x_0 欄位；刪除：o.fields 是 { <群組>_s: 索引 }
	 * o.extra：兩次送出都帶的欄位（例如同時打開功能的開關）
	 */
	function listDel(o) { o.mode = ' Del '; return listAdd(o); }
	function listAdd(o) {
		var run = function () {
			var base = { current_page: o.page || currentPage(), next_page: '', sid_list: o.sid, group_id: o.group, action_script: '' };
			var add = {}; Object.keys(base).forEach(function (k) { add[k] = base[k]; });
			add.action_mode = o.mode || ' Add ';
			var fields = typeof o.fields == 'function' ? o.fields() : (o.fields || {});	/* 函式：確認對話框按下後才取值 */
			Object.keys(fields).forEach(function (k) { add[k] = fields[k]; });
			Object.keys(o.extra || {}).forEach(function (k) { add[k] = o.extra[k]; });
			if (typeof showLoading === 'function') showLoading();
			return new Promise(function (res) {
				/* start_apply.htm 會呼叫 parent.done_validating(action, group_id) */
				var prev = window.done_validating;
				var timer = setTimeout(function () { window.done_validating = prev; toast('路由器沒有回應，請重新整理後再試', 'bad'); if (typeof hideLoading === 'function') hideLoading(); res(false); }, 15000);
				window.done_validating = function () {
					clearTimeout(timer);
					window.done_validating = prev;
					var r = {}; Object.keys(base).forEach(function (k) { r[k] = base[k]; });
					r.action_mode = ' Restart ';
					Object.keys(o.extra || {}).forEach(function (k) { r[k] = o.extra[k]; });
					hiddenForm(r).submit();
					res(true);
				};
				hiddenForm(add).submit();
			});
		};
		if (o.noConfirm) return run();
		return dialog({ title: o.title || '新增項目？', body: o.body, impacts: o.impacts, ok: o.ok || '新增並套用', danger: o.danger, onOk: o.onOk })
			.then(function (yes) { return yes ? run() : false; });
	}

	/* ---------- 輪詢：至少 2 秒、頁面不在前景時停止（HANDOFF 4-4） ---------- */
	var pollers = [];
	function poll(fn, ms) {
		var p = { fn: fn, ms: Math.max(2000, ms || 5000), t: 0, busy: false };
		function tick() {
			if (document.visibilityState == 'hidden') { p.t = 0; return; }
			if (p.busy) { p.t = setTimeout(tick, p.ms); return; }
			p.busy = true;
			Promise.resolve().then(fn).catch(function () {}).then(function () {
				p.busy = false;
				p.t = setTimeout(tick, p.ms);
			});
		}
		p.start = function () { if (!p.t) tick(); };
		p.stop = function () { clearTimeout(p.t); p.t = 0; };
		pollers.push(p);
		p.start();
		return p;
	}
	document.addEventListener('visibilitychange', function () {
		pollers.forEach(function (p) { if (document.visibilityState == 'hidden') p.stop(); else p.start(); });
	});

	/* ---------- 資料層 ---------- */
	var scenario = qs('scenario');	/* 只有預覽工具會用到 */
	var apiMissing = false;
	try { apiMissing = sessionStorage.getItem('tw_api_missing') == '1'; } catch (e) {}

	function getText(url) {
		return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.text();
		});
	}
	function withMeta(o, src) {
		o = o || {};
		if (o.ok == null) o.ok = true;
		if (o.available == null) o.available = true;
		if (o.warming_up == null) o.warming_up = false;
		if (o.ts == null) o.ts = Math.floor(Date.now() / 1000);
		o._source = src;
		return o;
	}
	/* B 階段的 /tw_api.asp；韌體還沒有時 httpd 回 200 空白 */
	function fromApi(name, params) {
		if (apiMissing && !scenario) return Promise.resolve(null);
		var url = '/tw_api.asp?q=' + encodeURIComponent(name);
		Object.keys(params || {}).forEach(function (k) { url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
		if (scenario) url += '&scenario=' + encodeURIComponent(scenario);
		return getText(url).then(function (t) {
			t = t.trim();
			if (!t) {
				if (!scenario) { apiMissing = true; try { sessionStorage.setItem('tw_api_missing', '1'); } catch (e) {} }
				return null;
			}
			return JSON.parse(t);
		});
	}
	/* 路由器現有資料（tw_status.asp 把現有 ej 函式包成一次請求） */
	var baseCache = null, baseAt = 0, basePending = null, prevCpu = null, prevNet = null;
	function base() {
		if (baseCache && Date.now() - baseAt < 1800) return Promise.resolve(baseCache);
		if (basePending) return basePending;
		basePending = getText('/tw_status.asp' + (scenario ? '?scenario=' + encodeURIComponent(scenario) : '')).then(function (t) {
			var names = ['wanlink_status', 'wanlink_etherlink', 'wanlink_uptime', 'wanlink_dltime', 'wanlink_type', 'wanlink_ip4_wan', 'wanlink_gw4_wan',
				'wanlink_ip4_man', 'wanlink_ip6_wan', 'wanlink_dns', 'wanlink_bytes_rx', 'wanlink_bytes_tx', 'nf_conntrack_count', 'kuroshio_status'];
			var body = t + '\n;return {' + names.map(function (n) { return n + ': (typeof ' + n + ' == "function") ? ' + n + '() : null'; }).join(',') +
				', sys: typeof tw_sys != "undefined" ? tw_sys : null, clients: typeof tw_clients != "undefined" ? tw_clients : [],' +
				' wl: typeof tw_wl != "undefined" ? tw_wl : {}, dhcp_static: typeof tw_dhcp_static != "undefined" ? tw_dhcp_static : [],' +
				' mf: typeof tw_mf != "undefined" ? tw_mf : [], nv: typeof tw_nv != "undefined" ? tw_nv : {}, netdevs: typeof netdevs != "undefined" ? netdevs : null };';
			/* eslint-disable-next-line no-new-func */
			var b = (new Function(body))();
			b.at = Date.now();
			/* CPU 使用率：兩次取樣的差 */
			if (b.sys && b.sys.cpu) {
				var c = b.sys.cpu;
				if (prevCpu && c.total > prevCpu.total) b.cpu_pct = Math.round((c.busy - prevCpu.busy) / (c.total - prevCpu.total) * 100);
				prevCpu = { busy: c.busy, total: c.total };
			}
			/* 網際網路即時速率：兩次取樣的差（交換器硬體計數，硬體 NAT 也算得到） */
			if (b.netdevs && b.netdevs.WAN) {
				var w = b.netdevs.WAN;
				if (prevNet && b.at > prevNet.at && w.rx >= prevNet.rx) {
					var dt = (b.at - prevNet.at) / 1000;
					b.rx_kbps = Math.round((w.rx - prevNet.rx) * 8 / 1000 / dt);
					b.tx_kbps = Math.round((w.tx - prevNet.tx) * 8 / 1000 / dt);
				}
				prevNet = { rx: w.rx, tx: w.tx, at: b.at };
			}
			baseCache = b; baseAt = Date.now(); basePending = null;
			return b;
		}, function (e) { basePending = null; throw e; });
		return basePending;
	}
	/* 24 小時流量（rstats）；路由器要等 rstats 寫檔，最多 60 秒取一次 */
	var rstatsCache = null, rstatsAt = 0;
	function rstats() {
		if (rstatsCache && Date.now() - rstatsAt < 60000) return Promise.resolve(rstatsCache);
		return getText('/tw_rstats.asp' + (scenario ? '?scenario=' + encodeURIComponent(scenario) : '')).then(function (t) {
			var r = (new Function(t + '\n;return { hist: typeof speed_history != "undefined" ? speed_history : null, period: typeof data_period != "undefined" ? data_period : 120 };'))();
			rstatsCache = r; rstatsAt = Date.now();
			return r;
		});
	}

	/* 以路由器現有資料組出第 6 節的格式（能給多少給多少，沒有的欄位是 null） */
	var adapters = {
		router: function () {
			return base().then(function (b) {
				var s = b.sys || {}, ram = s.ram || {}, up = s.uptime || {};
				return withMeta({
					cpu_pct: b.cpu_pct == null ? null : b.cpu_pct,
					mem_total_kb: ram.total || null,
					mem_used_pct: ram.total ? Math.round((ram.total - ram.free - (ram.buffers || 0) - (ram.cached || 0)) / ram.total * 100) : null,
					uptime_s: (up.days || 0) * 86400 + (up.hours || 0) * 3600 + (up.minutes || 0) * 60,
					load: s.lavg ? String(s.lavg).split(' ').map(Number) : null,
					conntrack_count: b.nf_conntrack_count != null ? parseInt(b.nf_conntrack_count, 10) : null,
					conntrack_max: (typeof support_max_conn == 'function') ? support_max_conn() : null,
					temp_c: null
				}, 'base');
			});
		},
		wan: function () {
			return base().then(function (b) {
				/* wanlink_status()：0＝已連線，其他是原因代碼（同 device-map/internet.asp 的 InetState） */
				var WAN_ERR = { 1: '沒有接上網路線（WAN 孔）', 2: '沒有連上上游的 Wi-Fi 基地台', 3: '沒有連上行動網路基地台', 4: '網路介面還沒就緒',
					5: '正在向業者取得 IP 位址', 6: '正在等待 PPPoE 撥號連線（帳號密碼錯誤也會停在這裡）', 7: 'PPPoE 連線沒有啟用', 8: '沒有預設閘道',
					9: '網際網路的網段和家裡的區域網路衝突（例如兩邊都是 192.168.1.x），請改區域網路的 IP' };
				var o = {
					connected: b.wanlink_status === 0,
					last_error: b.wanlink_status ? (WAN_ERR[b.wanlink_status] || '狀態代碼 ' + b.wanlink_status) : '',
					internet: b.nv.link_internet == '1' ? 'ok' : (b.nv.link_internet == '2' ? 'warn' : 'bad'),
					proto_label: ({ 'Automatic IP': '自動取得 IP', 'Static IP': '固定 IP' })[b.wanlink_type] || b.wanlink_type || '',
					ether: b.wanlink_etherlink || '',
					ip4: b.wanlink_ip4_wan || '',
					gw4: b.wanlink_gw4_wan || '',
					ip6: b.wanlink_ip6_wan || '',
					dns: b.wanlink_dns ? String(b.wanlink_dns).split(/\s+/).filter(Boolean) : [],
					uptime_s: b.wanlink_uptime || 0,
					rx_kbps: b.rx_kbps == null ? null : b.rx_kbps,
					tx_kbps: b.tx_kbps == null ? null : b.tx_kbps,
					plan_down_kbps: null, plan_up_kbps: null,
					series: null
				};
				return rstats().then(function (r) {
					var h = r.hist && r.hist.WAN;
					if (h && h.rx && h.rx.length > 2) {
						var step = r.period || 120, k = 8 / 1000 / step, n = h.rx.length;
						o.series = {
							step: step, start: Math.floor(Date.now() / 1000) - step * (n - 1),
							down_kbps: h.rx.map(function (x) { return Math.round(x * k); }),
							up_kbps: h.tx.map(function (x) { return Math.round(x * k); })
						};
					}
					return withMeta(o, 'base');
				}, function () { return withMeta(o, 'base'); });
			});
		},
		devices: function () {
			return base().then(function (b) {
				var statics = {}, blocked = {}, list = [], seen = {}, wl = {};
				(b.dhcp_static || []).forEach(function (r, i) { statics[macKey(r[0])] = { ip: r[1], name: r[2], index: i }; });
				var mfMode = b.nv.macfilter;	/* 0 關閉、1 白名單、2 黑名單 */
				(b.mf || []).forEach(function (r, i) { blocked[macKey(r[0])] = { index: i }; });
				Object.keys(b.wl || {}).forEach(function (m) { wl[macKey(m)] = b.wl[m]; });
				(b.clients || []).forEach(function (c) {
					var key = macKey(c[1]), mac = macColon(c[1]);
					if (!key || seen[key]) return;
					seen[key] = 1;
					var st = statics[key], rssi = wl[key], bl = mfMode == '2' ? blocked[key] : null;
					list.push({
						mac: mac,
						name: (st && st.name) || cleanHost(c[2]) || '',
						hostname: cleanHost(c[2]) || '',
						type: guessType(c[2], c[3]),
						conn: rssi != null ? 'wifi' : 'wired_guess',	/* 現有資料分不出有線或剛離開 Wi-Fi */
						band: null, ap: null,
						signal_dbm: rssi != null ? rssi : null,
						tx_rate_mbps: null,
						ip: c[0] || (st && st.ip) || '',
						static_ip: !!st, static_index: st ? st.index : null,
						online: true,
						since_s: null,
						paused: !!bl, pause_index: bl ? bl.index : null
					});
				});
				/* 固定 IP 或被暫停、但目前不在線上的裝置 */
				var offline = function (key, st, bl) {
					if (seen[key]) return;
					seen[key] = 1;
					list.push({ mac: macColon(key), name: (st && st.name) || '', hostname: '', type: guessType(st && st.name), conn: null, band: null, ap: null,
						signal_dbm: null, tx_rate_mbps: null, ip: st ? st.ip : '', static_ip: !!st, static_index: st ? st.index : null,
						online: false, since_s: null, paused: !!bl, pause_index: bl ? bl.index : null });
				};
				Object.keys(statics).forEach(function (k) { offline(k, statics[k], mfMode == '2' ? blocked[k] : null); });
				if (mfMode == '2') Object.keys(blocked).forEach(function (k) { offline(k, statics[k], blocked[k]); });
				return withMeta({ devices: list, macfilter_mode: mfMode, static_count: (b.dhcp_static || []).length, pause_count: (b.mf || []).length, partial: true }, 'base');
			});
		},
		wifi: function () {
			return base().then(function (b) {
				var n = Object.keys(b.wl || {}).length;
				return withMeta({
					bands: null,
					clients_total: n,
					radio: { '2.4': b.nv.rt_radio == '1', '5': b.nv.wl_radio == '1' },
					guest: { '2.4': b.nv.rt_guest == '1', '5': b.nv.wl_guest == '1' },
					channel: { '2.4': b.nv.rt_channel, '5': b.nv.wl_channel },
					partial: true
				}, 'base');
			});
		},
		dns: function () {
			return base().then(function (b) {
				if (b.kuroshio_status == null) return withMeta({ available: false }, 'none');
				return withMeta({
					enabled: b.nv.kuroshio_enable == '1',
					running: b.kuroshio_status >= 1,
					healthy: b.kuroshio_status == 2,
					queries: null, blocked: null, cdn_rewrites: null,
					partial: true
				}, 'base');
			});
		},
		cgnat: function () {
			return base().then(function (b) {
				var ip = b.wanlink_ip4_wan || '';
				var o = { wan_ip: ip, public_ip: null, method: 'wan_ip' };
				if (!ip || ip == '0.0.0.0') { o.cgnat = null; o.reason = '網際網路還沒有連線，無法判斷'; }
				else if (isCgnatIp(ip)) { o.cgnat = true; o.kind = 'cgnat'; o.reason = '路由器拿到的位址 ' + ip + ' 屬於業者共用位址（100.64.0.0/10）'; }
				else if (isPrivateIp(ip)) { o.cgnat = true; o.kind = 'double_nat'; o.reason = '路由器拿到的是私人位址 ' + ip + '：前面還有一台路由器或數據機在做路由（雙層 NAT），也可能是業者共用位址'; }
				else { o.cgnat = false; o.reason = '路由器直接拿到公網位址 ' + ip; }
				return withMeta(o, 'base');
			});
		},
		health: function () {
			return Promise.all([adapters.wan(), adapters.router(), adapters.wifi(), adapters.dns().catch(function () { return null; }), adapters.devices()]).then(function (a) {
				return withMeta(healthFromBase(a[0], a[1], a[2], a[3], a[4]), 'base');
			});
		},
		diag: function () { return adapters.health().then(function (h) { h.report = reportText(h); return h; }); }
	};
	function cleanHost(h) { return String(h || '').replace(/\.lan$/i, '').replace(/^\*$/, ''); }
	function guessType(name, t) {
		var n = String(name || '').toLowerCase();
		if (/iphone|android|galaxy|pixel|redmi|xiaomi|oppo|vivo|huawei|s2\d|phone|mi-/.test(n)) return 'phone';
		if (/ipad|tab/.test(n)) return 'phone';
		if (/tv|bravia|chromecast|appletv|mibox|mod/.test(n)) return 'tv';
		if (/ps[45]|playstation|xbox|switch|nintendo/.test(n)) return 'game';
		if (/nas|synology|diskstation|qnap/.test(n)) return 'nas';
		if (/cam|ipc|tapo|ezviz/.test(n)) return 'camera';
		if (/desktop|laptop|macbook|imac|pc|win|notebook/.test(n)) return 'computer';
		if (/esp|tuya|plug|bulb|robot|vacuum|roborock|sensor|iot/.test(n)) return 'iot';
		if (t == '2' || t == '3') return 'router';
		return 'other';
	}
	/* 用現有資料組出健康路徑：只說得出確定的事，不能判斷的段落標「未知」 */
	function healthFromBase(wan, router, wifi, dns, dev) {
		var seg = [];
		var weak = (dev.devices || []).filter(function (d) { return d.online && d.signal_dbm != null && d.signal_dbm < -75; });
		var wl = (dev.devices || []).filter(function (d) { return d.online && d.conn == 'wifi'; });
		seg.push({ id: 'device', label: '裝置', state: weak.length ? 'warn' : 'ok',
			summary: weak.length ? weak.length + ' 台 Wi-Fi 訊號弱' : (dev.devices || []).filter(function (d) { return d.online; }).length + ' 台在線',
			evidence: weak.length ? weak.map(function (d) { return (d.name || d.mac) + ' ' + d.signal_dbm + ' dBm'; }).join('、') : '',
			actions: weak.length ? [{ label: '查看裝置', href: 'tw_devices.asp?filter=weak' }] : [] });
		var radioOn = wifi.radio['2.4'] || wifi.radio['5'];
		seg.push({ id: 'wifi', label: 'Wi-Fi', state: radioOn ? 'ok' : 'warn',
			summary: radioOn ? wl.length + ' 台連線中' : 'Wi-Fi 已關閉',
			evidence: '頻道：2.4G ' + (wifi.channel['2.4'] == '0' ? '自動' : wifi.channel['2.4']) + '、5G ' + (wifi.channel['5'] == '0' ? '自動' : wifi.channel['5']) + '（鄰近干擾需要更新韌體後才看得到）',
			actions: [{ label: 'Wi-Fi 設定', href: 'tw_wifi.asp' }] });
		var rs = 'ok', rsum = (router.cpu_pct == null ? '' : 'CPU ' + router.cpu_pct + ' %、') + '記憶體 ' + (router.mem_used_pct == null ? '--' : router.mem_used_pct) + ' %';
		if (router.cpu_pct > 90 || router.mem_used_pct > 90) rs = 'warn';
		var ct = router.conntrack_count && router.conntrack_max ? router.conntrack_count / router.conntrack_max : 0;
		if (ct > 0.9) { rs = 'bad'; rsum += '、連線追蹤表快滿了'; }
		seg.push({ id: 'router', label: '路由器', state: rs, summary: rsum, evidence: '已運作 ' + fmtDur(router.uptime_s), actions: [] });
		seg.push({ id: 'isp', label: '業者', state: wan.connected ? 'ok' : 'bad',
			summary: wan.connected ? '已連線 ' + fmtDur(wan.uptime_s) : '沒有連線',
			evidence: (wan.proto_label || '') + (wan.ip4 ? ' · ' + wan.ip4 : '') + (wan.ether ? ' · 網路線 ' + wan.ether : ''),
			actions: wan.connected ? [] : [{ label: '檢查網際網路設定', href: 'tw_internet.asp' }] });
		seg.push({ id: 'internet', label: '網際網路', state: wan.connected ? wan.internet : 'bad',
			summary: wan.internet == 'ok' ? '連得到外面' : (wan.internet == 'warn' ? '偵測中或不穩定' : '連不到外面'),
			evidence: '延遲與掉包紀錄需要更新韌體後才有', actions: [] });
		if (dns && dns.available !== false) {
			var ds = !dns.enabled ? 'off' : (dns.healthy ? 'ok' : (dns.running ? 'warn' : 'bad'));
			seg.push({ id: 'dns', label: 'DNS', state: ds,
				summary: !dns.enabled ? '使用業者 DNS' : (dns.healthy ? '黑潮 DNS 運作中' : (dns.running ? '黑潮 DNS 暫時改用業者 DNS' : '黑潮 DNS 沒有執行')),
				evidence: '', actions: [{ label: 'DNS 設定', href: 'tw_internet.asp#dns' }] });
		} else {
			seg.push({ id: 'dns', label: 'DNS', state: 'unknown', summary: '使用業者 DNS', evidence: '', actions: [] });
		}
		var bad = seg.filter(function (s) { return s.state == 'bad'; }), warn = seg.filter(function (s) { return s.state == 'warn'; });
		var headline, level;
		if (bad.length) { level = 'bad'; headline = bad[0].label + '：' + bad[0].summary; }
		else if (warn.length) { level = 'warn'; headline = '網路正常，有 ' + warn.length + ' 件事值得注意'; }
		else { level = 'ok'; headline = '一切正常'; }
		var notices = [];
		weak.slice(0, 2).forEach(function (d) {
			notices.push({ level: 'warn', title: (d.name || d.mac) + ' 的 Wi-Fi 訊號弱', evidence: d.signal_dbm + ' dBm（建議 -65 dBm 以上）', href: 'tw_devices.asp?mac=' + encodeURIComponent(d.mac), action: '查看' });
		});
		if (ct > 0.8) notices.push({ level: ct > 0.9 ? 'bad' : 'warn', title: '連線追蹤表用量偏高', evidence: router.conntrack_count + ' / ' + router.conntrack_max, href: 'tw_diag.asp', action: '診斷' });
		return { headline: headline, level: level, segments: seg, notices: notices.slice(0, 3), partial: true };
	}
	function reportText(h) {
		var lines = ['padavan-tw 診斷報告', '時間：' + new Date().toLocaleString('zh-TW'), '結論：' + h.headline, ''];
		(h.segments || []).forEach(function (s) {
			lines.push('[' + (STATE_LABEL[s.state] || s.state) + '] ' + s.label + '：' + s.summary + (s.evidence ? '（' + s.evidence + '）' : ''));
		});
		return lines.join('\n');
	}

	/*
	 * 取得資料：先 B 階段的 API，再路由器現有資料，最後「功能未提供」
	 * 回傳的物件一定有 ok／available／warming_up／ts／_source（api｜base｜none）
	 */
	function api(name, params) {
		return fromApi(name, params).catch(function () { return null; }).then(function (r) {
			if (r) return withMeta(r, 'api');
			var key = name.split('?')[0];
			if (adapters[key] && !params) return adapters[key]().catch(function () { return withMeta({ ok: false, _error: true }, 'base'); });
			return withMeta({ available: false }, 'none');
		});
	}
	/* 瀏覽器向 GitHub 查最新 Release（使用者選擇：路由器不用連外） */
	function latestRelease(repo) {
		return fetch('https://api.github.com/repos/' + repo + '/releases/latest', { cache: 'no-store', credentials: 'omit' }).then(function (r) {
			if (r.status == 404) return { none: true };
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.json();
		});
	}

	/* ---------- 常用動作（都先說清楚影響） ---------- */
	function wanReconnect() {
		return dialog({ title: '重新連線網際網路？', ok: '重新連線',
			impacts: ['網際網路中斷約 10～20 秒（PPPoE 會重新撥號）', '家裡所有裝置的連線都會斷一下，視訊通話可能中斷', '公網 IP 可能會換'] }).then(function (yes) {
			if (!yes) return false;
			var f = hiddenForm({ wan_action: 'Connect', modem_prio: '' });
			f.action = '/device-map/wan_action.asp';
			f.submit();
			return true;
		});
	}
	function rebootRouter() {
		return dialog({ title: '重新開機？', ok: '重新開機', danger: true,
			impacts: ['路由器重新開機約 1～2 分鐘', 'Wi-Fi 與網際網路在這段時間都不能用', '開機完成後這個頁面會自動重新載入'] }).then(function (yes) {
			if (!yes) return false;
			if (typeof showLoading === 'function') showLoading(typeof board_boot_time == 'function' ? board_boot_time() : 60, 'waiting');
			fetch('/apply.cgi', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action_mode=+Reboot+' });
			waitRouterBack();
			return true;
		});
	}
	/* 等路由器真的關掉又回來才重新載入（Padavan 的進度條只會在時間到時把遮罩收起來，不會重新載入） */
	function waitRouterBack() {
		var sawDown = false, t0 = Date.now();
		function ping() {
			var ctl = window.AbortController ? new AbortController() : null;
			var to = setTimeout(function () { if (ctl) ctl.abort(); }, 2500);
			fetch('/httpd_check.htm?t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined }).then(function (r) {
				clearTimeout(to);
				/* 回應正常：之前看過斷線，或已經超過 2 分鐘（斷線太短沒看到）就重新載入 */
				if (r.ok && (sawDown || Date.now() - t0 > 120000)) location.reload();
				else setTimeout(ping, 3000);
			}, function () { clearTimeout(to); sawDown = true; setTimeout(ping, 3000); });
		}
		setTimeout(ping, 5000);
		setTimeout(function () { location.reload(); }, 240000);
	}

	/* ---------- 頁面骨架 ---------- */
	/* 新頁面的 body onload：頂部列、主選單、頁尾，再交給頁面 */
	function start(id, init) {
		if (typeof show_banner == 'function') show_banner(0);
		if (typeof tw_show_menu == 'function') tw_show_menu(id);
		if (typeof show_footer == 'function') show_footer();
		if (init) {
			try { init(); } catch (e) {
				mount(stateBox('error', '頁面發生錯誤：' + e.message));
				if (window.console) console.error(e);
			}
		}
	}
	function mount(html) {
		var el = $id('tw-page');
		if (el) el.innerHTML = html;
		return el;
	}
	function set(id, html) { var el = $id(id); if (el) el.innerHTML = html; return el; }

	return {
		esc: esc, unent: unent, $: $id, num: num, fmtRate: fmtRate, rateText: rateText, fmtBytes: fmtBytes, fmtDur: fmtDur,
		fmtTime: fmtTime, fmtAgo: fmtAgo, signal: signal, maskMac: maskMac, isPrivateIp: isPrivateIp, isCgnatIp: isCgnatIp, qs: qs,
		icon: icon, dot: dot, chip: chip, worst: worst, STATE_LABEL: STATE_LABEL,
		pageHead: pageHead, card: card, conclusion: conclusion, metric: metric, spark: spark, chart: chart, timeline: timeline,
		table: table, stateBox: stateBox, guard: guard, button: button, copyField: copyField, copy: copy, reveal: reveal,
		qrSvg: qrSvg, wifiQrText: wifiQrText, dialog: dialog, closeDialog: closeDialog, toast: toast,
		apply: apply, listAdd: listAdd, listDel: listDel, hiddenForm: hiddenForm, poll: poll, macKey: macKey, macColon: macColon,
		api: api, base: base, rstats: rstats, adapters: adapters, reportText: reportText, latestRelease: latestRelease,
		guessType: guessType, scenario: scenario, mount: mount, set: set, start: start,
		wanReconnect: wanReconnect, rebootRouter: rebootRouter
	};
})();
