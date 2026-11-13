/* padavan-tw 總覽：網路現在好不好？要注意什麼？（docs/HANDOFF-UI.md 5.5） */
var HM = { health: null, open: null, tick: 0 };

function page_init() {
	var U = TW;
	var actions = U.button('分享 Wi-Fi', { icon: 'qr', onclick: 'hm_share()' }) +
		U.button('重新連線', { icon: 'restart', onclick: 'TW.wanReconnect()', title: '重新連線網際網路' }) +
		U.button('重開機', { icon: 'power', onclick: 'TW.rebootRouter()' });
	var h = U.pageHead({ title: '總覽', sub: '<span id="hm-sub">' + U.esc(U.unent(NV.productid)) + '</span>', actions: actions });
	h += '<section class="tw-card" id="hm-health" aria-label="網路健康狀態">' + U.stateBox('loading') + '</section>';
	h += '<div id="hm-notices"></div>';
	h += '<div class="tw-grid-2">' +
		U.card({ title: '網際網路', extra: '<a href="tw_internet.asp">設定</a>', bodyId: 'hm-wan', body: U.stateBox('loading') }) +
		U.card({ title: '路由器', extra: '<a href="tw_system.asp">系統</a>', bodyId: 'hm-router', body: U.stateBox('loading') }) +
		'</div>';
	h += '<div class="tw-grid-2">' +
		U.card({ title: 'Wi-Fi', extra: '<a href="tw_wifi.asp">管理</a>', bodyId: 'hm-wifi', body: U.stateBox('loading') }) +
		U.card({ title: '線上裝置', extra: '<a href="tw_devices.asp">全部裝置</a>', bodyId: 'hm-dev', body: U.stateBox('loading') }) +
		'</div>';
	h += U.card({ title: 'DNS', extra: '<a href="tw_internet.asp#dns">設定</a>', bodyId: 'hm-dns', body: U.stateBox('loading') });
	U.mount(h);

	U.poll(function () {
		var slow = (HM.tick++ % 6) == 0;	/* 每 30 秒更新一次的區塊 */
		var lat = slow ? U.api('latency').then(hm_latency) : Promise.resolve();
		var jobs = [U.api('health').then(hm_health), lat.then(function () { return U.api('wan'); }).then(hm_wan_now), U.api('router').then(hm_router)];
		if (slow) jobs.push(U.api('wifi').then(hm_wifi), U.api('devices').then(hm_devices), U.api('dns').then(hm_dns));
		return Promise.all(jobs);
	}, 5000);
}

/* ---------- 健康路徑 ---------- */
var HM_SEG_ICON = { device: 'devices', wifi: 'wifi', router: 'router', isp: 'isp', internet: 'globe', dns: 'dns' };
function hm_health(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('hm-health', g); return; }
	HM.health = r;
	var h = U.conclusion({ state: r.level, title: r.headline, sub: r.partial ? '依路由器目前能取得的資料判斷；延遲、掉包、干擾等細項需要更新韌體後才有' : '' });
	h += '<ol class="tw-path" aria-label="從裝置到網際網路的每一段">';
	(r.segments || []).forEach(function (s) {
		h += '<li><button type="button" class="tw-path-btn" aria-expanded="' + (HM.open == s.id ? 'true' : 'false') + '" aria-controls="hm-detail" onclick="hm_toggle(\'' + s.id + '\')">' +
			'<span class="tw-path-top">' + U.icon(HM_SEG_ICON[s.id] || 'info', 16) + U.esc(s.label) + U.dot(s.state) + '</span>' +
			'<span class="tw-path-sum">' + U.esc(s.summary) + '</span></button></li>';
	});
	h += '</ol><div id="hm-detail" class="tw-path-detail" ' + (HM.open ? '' : 'hidden') + '>' + hm_detail() + '</div>';
	U.set('hm-health', h);

	var n = r.notices || [];
	U.set('hm-notices', n.length ? '<div class="tw-notices" aria-label="值得注意">' + n.slice(0, 3).map(function (x) {
		return '<a class="tw-notice" href="' + U.esc(x.href || '#') + '">' + U.dot(x.level) +
			'<span class="tw-notice-text"><span class="tw-notice-title">' + U.esc(x.title) + '</span><span class="tw-notice-ev">' + U.esc(x.evidence || '') + '</span></span>' +
			'<span class="tw-notice-go">' + U.esc(x.action || '查看') + U.icon('chevron', 16) + '</span></a>';
	}).join('') + '</div>' : '');
}
function hm_detail() {
	var U = TW, r = HM.health;
	if (!r || !HM.open) return '';
	var s = (r.segments || []).filter(function (x) { return x.id == HM.open; })[0];
	if (!s) return '';
	var h = '<div class="tw-inline">' + U.chip(s.state) + '<b>' + U.esc(s.label) + '：' + U.esc(s.summary) + '</b></div>';
	if (s.evidence) h += '<div class="tw-small tw-muted">' + U.esc(s.evidence) + '</div>';
	if (s.actions && s.actions.length) {
		h += '<div class="tw-actions">' + s.actions.map(function (a) {
			if (a.href == '#reconnect') return U.button(a.label, { small: true, onclick: 'TW.wanReconnect()' }) + (a.cost ? '<span class="tw-cost">' + U.esc(a.cost) + '</span>' : '');
			return U.button(a.label, { small: true, href: a.href }) + (a.cost ? '<span class="tw-cost">' + U.esc(a.cost) + '</span>' : '');
		}).join('') + '</div>';
	}
	return h;
}
function hm_toggle(id) {
	HM.open = (HM.open == id) ? null : id;
	var d = TW.$('hm-detail');
	if (d) { d.innerHTML = hm_detail(); d.hidden = !HM.open; }
	var btns = document.querySelectorAll('#hm-health .tw-path-btn');
	for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-expanded', btns[i].getAttribute('onclick').indexOf("'" + HM.open + "'") > 0 ? 'true' : 'false');
}

/* ---------- 網際網路 ---------- */
var HM_LAT = null;
function hm_latency(r) { HM_LAT = r; }
function hm_wan_now(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('hm-wan', g); return; }
	var down = U.fmtRate(r.rx_kbps), up = U.fmtRate(r.tx_kbps);
	var h = '';
	if (!r.connected) {
		h += '<div class="tw-note tw-s-bad"><b>網際網路沒有連線。</b>' + U.esc(r.last_error || '') + ' <a href="tw_internet.asp">檢查連線設定</a></div>';
	}
	var planRef = function (kbps, plan) {
		if (!plan || kbps == null) return '';
		var p = Math.round(kbps / plan * 100);
		return '方案的 ' + p + ' %（' + U.rateText(plan) + '）';
	};
	h += '<div class="tw-grid-metrics">';
	h += U.metric({ label: '下載（現在）', value: down.v, unit: down.u, state: 'down', ref: planRef(r.rx_kbps, r.plan_down_kbps) || (r.rx_kbps == null ? '計算中…' : '') });
	h += U.metric({ label: '上傳（現在）', value: up.v, unit: up.u, state: 'up', ref: planRef(r.tx_kbps, r.plan_up_kbps) });
	var L = HM_LAT;
	if (L && L.available !== false && !L.warming_up && L.current_ms != null) {
		var st = L.current_ms > L.baseline_ms * 3 + 20 ? 'bad' : (L.current_ms > L.baseline_ms * 1.8 + 10 ? 'warn' : '');
		h += U.metric({ label: '延遲', value: U.num(L.current_ms), unit: 'ms', state: st, ref: '平常 ' + U.num(L.baseline_ms) + ' ms' + (L.loss_pct ? '、掉包 ' + L.loss_pct + ' %' : '') });
	} else {
		h += U.metric({ label: '延遲', value: '--', ref: L && L.warming_up ? '資料收集中' : '需要更新韌體後才有' });
	}
	h += '</div>';
	if (r.series && r.series.down_kbps) {
		var s = r.series, mbps = function (a) { return a.map(function (x) { return x == null ? null : x / 1000; }); };
		h += U.chart({ series: [{ values: mbps(s.down_kbps), color: 'var(--down)', label: '下載', area: true }, { values: mbps(s.up_kbps || []), color: 'var(--up)', label: '上傳' }],
			step: s.step, start: s.start, height: 140, guide: r.plan_down_kbps ? { value: r.plan_down_kbps / 1000, label: '方案 ' + U.rateText(r.plan_down_kbps) } : null,
			fmt: function (v) { return U.num(v, v < 10 ? 1 : 0) + ' Mbps'; }, label: '24 小時網際網路流量' });
	} else {
		h += U.stateBox('warming', '24 小時流量紀錄收集中');
	}
	var meta = [];
	if (r.connected) meta.push((r.isp ? r.isp + ' ' : '') + (r.proto_label || '') + ' 已連線 ' + U.fmtDur(r.uptime_s));
	if (r.ip4) meta.push((U.isPrivateIp(r.ip4) || U.isCgnatIp(r.ip4) ? '業者給的位址 ' + r.ip4 + '（不是公網 IP）' : '公網 IP ' + r.ip4));
	if (meta.length) h += '<div class="tw-small tw-muted">' + U.esc(meta.join(' · ')) + '</div>';
	U.set('hm-wan', h);
}

/* ---------- 路由器 ---------- */
function hm_router(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('hm-router', g); return; }
	var cpuSt = r.cpu_pct > 90 ? 'bad' : (r.cpu_pct > 75 ? 'warn' : '');
	var memSt = r.mem_used_pct > 90 ? 'bad' : (r.mem_used_pct > 80 ? 'warn' : '');
	var ct = r.conntrack_count, cm = r.conntrack_max, ctp = ct && cm ? Math.round(ct / cm * 100) : null;
	var h = '<div class="tw-grid-metrics">';
	h += U.metric({ label: 'CPU', value: r.cpu_pct == null ? '--' : r.cpu_pct, unit: r.cpu_pct == null ? '' : '%', state: cpuSt, ref: r.load ? '負載 ' + r.load.join(' / ') : '', spark: r.cpu_series ? r.cpu_series.values : null });
	h += U.metric({ label: '記憶體', value: r.mem_used_pct == null ? '--' : r.mem_used_pct, unit: '%', state: memSt, ref: r.mem_total_kb ? '共 ' + U.fmtBytes(r.mem_total_kb * 1024) : '' });
	h += U.metric({ label: '連線追蹤表', value: ct == null ? '--' : U.num(ct), state: ctp > 90 ? 'bad' : (ctp > 75 ? 'warn' : ''), ref: cm ? '上限 ' + U.num(cm) + (ctp != null ? '（' + ctp + ' %）' : '') : '' });
	h += U.metric({ label: '已運作', value: U.fmtDur(r.uptime_s), ref: '' });
	if (r.temp_c != null) h += U.metric({ label: '溫度', value: U.num(r.temp_c), unit: '°C', state: r.temp_c > 85 ? 'bad' : (r.temp_c > 75 ? 'warn' : '') });
	h += '</div>';
	U.set('hm-router', h);
	var sub = TW.$('hm-sub');
	if (sub) sub.textContent = U.unent(NV.productid) + ' · 已運作 ' + U.fmtDur(r.uptime_s) + ' · 韌體 ' + U.unent(NV.firmver);
}

/* ---------- Wi-Fi ---------- */
function hm_wifi(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('hm-wifi', g); return; }
	var h = '';
	if (r.bands) {
		h += U.table({ cols: [{ key: 'band', label: '頻段', cls: 'tw-cell-main' }, { key: 'ch', label: '頻道' }, { key: 'n', label: '裝置' }, { key: 'busy', label: '忙碌程度' }],
			rows: r.bands.map(function (b) {
				var busy = b.busy_pct == null ? '<span class="tw-muted">--</span>' : U.chip(b.busy_pct > 70 ? 'bad' : (b.busy_pct > 50 ? 'warn' : 'ok'), b.busy_pct + ' %');
				return { band: '<b>' + (b.id == '5' ? '5 GHz' : '2.4 GHz') + '</b><span class="tw-dev-sub">' + U.esc(b.ssid) + '</span>',
					ch: b.enabled ? b.channel + (b.auto_channel ? '（自動）' : '') : '關閉', n: b.enabled ? b.clients : '--', busy: busy };
			}) });
		if (r.guest) h += '<div class="tw-small tw-muted">訪客網路：' + (r.guest.enabled ? '開啟（' + U.esc(r.guest.ssid) + '）' : '關閉') + '</div>';
	} else {
		var row = function (id, name) {
			var on = r.radio[id], ch = r.channel[id];
			return { band: '<b>' + name + '</b><span class="tw-dev-sub">' + U.esc(id == '5' ? NV.wl_ssid : NV.rt_ssid) + '</span>',
				ch: on ? (ch == '0' ? '自動' : ch) : '關閉', busy: '<span class="tw-muted">需要更新韌體</span>' };
		};
		h += U.table({ cols: [{ key: 'band', label: '頻段', cls: 'tw-cell-main' }, { key: 'ch', label: '頻道' }, { key: 'busy', label: '忙碌程度' }],
			rows: [row('2.4', '2.4 GHz'), row('5', '5 GHz')] });
		h += '<div class="tw-small tw-muted">Wi-Fi 裝置共 ' + r.clients_total + ' 台；訪客網路：' + (r.guest['2.4'] || r.guest['5'] ? '開啟' : '關閉') + '</div>';
	}
	h += '<div class="tw-actions">' + U.button('分享 Wi-Fi', { small: true, icon: 'qr', onclick: 'hm_share()' }) + U.button('頻道與干擾', { small: true, href: 'tw_wifi.asp#channel' }) + '</div>';
	U.set('hm-wifi', h);
}

/* ---------- 裝置 ---------- */
var HM_TYPE_ICON = { phone: 'phone', computer: 'computer', tv: 'tv', game: 'game', iot: 'iot', nas: 'nas', camera: 'camera', router: 'router', other: 'other' };
function hm_devices(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('hm-dev', g); return; }
	var on = (r.devices || []).filter(function (d) { return d.online; });
	var rank = function (d) { var s = U.signal(d.signal_dbm).state; return (s == 'bad' ? 0 : s == 'warn' ? 1 : 2) * 10 + (d.disconnects_today ? 0 : 1); };
	on.sort(function (a, b) { return rank(a) - rank(b); });
	var wifi = on.filter(function (d) { return d.conn == 'wifi' || d.conn == 'guest'; }).length;
	var h = '<div class="tw-grid-metrics">' +
		U.metric({ label: '線上', value: on.length, unit: '台' }) +
		U.metric({ label: 'Wi-Fi', value: wifi, unit: '台' }) +
		U.metric({ label: r.partial ? '有線或剛離開 Wi-Fi' : '有線', value: on.length - wifi, unit: '台' }) + '</div>';
	h += '<div>' + on.slice(0, 5).map(hm_dev_row).join('') + '</div>';
	U.set('hm-dev', h);
}
function hm_dev_row(d) {
	var U = TW, sg = U.signal(d.signal_dbm), sub = [];
	if (d.conn == 'wired') sub.push('有線');
	else if (d.conn == 'wired_guess') sub.push('有線或剛離開 Wi-Fi');
	else if (d.conn == 'guest') sub.push('訪客 Wi-Fi');
	else sub.push(d.band ? d.band + ' GHz' : 'Wi-Fi');
	if (d.signal_dbm != null) sub.push(d.signal_dbm + ' dBm');
	if (d.ip) sub.push(d.ip);
	var st = d.conn == 'wired' ? U.chip('ok', '有線') : (d.signal_dbm != null ? U.chip(sg.state, '訊號' + sg.label) : '');
	return '<a class="tw-notice" style="background:none;padding:8px 0;border-top:1px solid var(--line);border-radius:0" href="tw_devices.asp?mac=' + encodeURIComponent(d.mac) + '">' +
		'<span class="tw-dev-ico">' + U.icon(HM_TYPE_ICON[d.type] || 'other', 18) + '</span>' +
		'<span class="tw-notice-text"><span class="tw-notice-title">' + U.esc(d.name || d.hostname || U.maskMac(d.mac)) + '</span><span class="tw-notice-ev tw-num">' + U.esc(sub.join(' · ')) + '</span></span>' + st + '</a>';
}

/* ---------- DNS ---------- */
function hm_dns(r) {
	var U = TW, g = U.guard(r, { unavailable: '這個韌體沒有黑潮 DNS' });
	if (g) { U.set('hm-dns', g); return; }
	var st = !r.enabled ? 'off' : (r.healthy ? 'ok' : (r.running ? 'warn' : 'bad'));
	var title = !r.enabled ? '使用業者的 DNS' : (r.healthy ? '黑潮 DNS 運作中' : (r.running ? '黑潮 DNS 暫時改用業者 DNS' : '黑潮 DNS 沒有執行'));
	var h = '<div class="tw-inline">' + U.dot(st) + '<b>' + title + '</b></div>';
	if (r.queries != null) {
		h += '<div class="tw-grid-metrics">' +
			U.metric({ label: '今天查詢', value: U.num(r.queries), ref: r.avg_ms != null ? '平均 ' + r.avg_ms + ' ms' : '' }) +
			U.metric({ label: '擋下的廣告與追蹤', value: U.num(r.blocked), ref: r.queries ? '佔 ' + Math.round(r.blocked / r.queries * 100) + ' %' : '' }) +
			U.metric({ label: '換到台灣 CDN', value: U.num(r.cdn_rewrites), ref: '影音、更新下載更快' }) + '</div>';
	} else if (r.enabled) {
		h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>查詢、過濾與 CDN 統計需要更新韌體後才有</span></div>';
	}
	U.set('hm-dns', h);
}

/* ---------- 分享 Wi-Fi ---------- */
function hm_share() {
	var U = TW, ssid = NV.rt_ssid, psk = NV.rt_psk, auth = NV.rt_auth;
	if (NV.rt_radio != '1' && NV.wl_radio == '1') { ssid = NV.wl_ssid; psk = NV.wl_psk; auth = NV.wl_auth; }
	var body = '<div class="tw-share">' + U.qrSvg(U.wifiQrText(ssid, psk, auth)) +
		'<div class="tw-share-info"><div class="tw-small tw-muted">用手機相機掃描 QR 碼就能連線</div>' +
		U.copyField(ssid, '名稱') + (psk && auth != 'open' ? U.copyField(psk, '密碼', true) : '<div class="tw-small">這個網路沒有密碼</div>') +
		'<a class="tw-small" href="tw_wifi.asp#guest">給客人用？開訪客網路</a></div></div>';
	U.dialog({ title: '分享 Wi-Fi', body: body, ok: '完成', cancel: false });
}
