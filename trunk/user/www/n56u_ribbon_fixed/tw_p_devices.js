/* padavan-tw 裝置：誰在用網路？某台怎麼了？（docs/HANDOFF-UI.md 5.5） */
var DV = { list: null, src: null, filter: 'all', q: '', mac: '' };
var DV_TYPE = { phone: ['phone', '手機／平板'], computer: ['computer', '電腦'], tv: ['tv', '電視'], game: ['game', '遊戲機'], iot: ['iot', '智慧家電'],
	nas: ['nas', 'NAS'], camera: ['camera', '監視器'], router: ['router', '路由器／AP'], other: ['other', '其他'] };
var DV_FILTERS = [['all', '全部'], ['wifi', 'Wi-Fi'], ['wired', '有線'], ['guest', '訪客'], ['weak', '訊號弱'], ['offline', '離線／暫停']];

function page_init() {
	DV.mac = TW.macColon(TW.qs('mac'));
	DV.filter = TW.qs('filter') || 'all';
	if (DV.mac) dv_detail_init(); else dv_list_init();
}

/* 寫入用的現況：直接來自 nvram（頁面載入時） */
function dv_static_of(mac) {
	var k = TW.macKey(mac);
	for (var i = 0; i < MDHCP.length; i++) if (TW.macKey(MDHCP[i][0]) == k) return { index: i, ip: MDHCP[i][1], name: MDHCP[i][2] };
	return null;
}
function dv_pause_of(mac) {
	var k = TW.macKey(mac);
	if (NV.mf_mode != '2') return null;
	for (var i = 0; i < MFLIST.length; i++) if (TW.macKey(MFLIST[i][0]) == k) return { index: i };
	return null;
}
function dv_name(d) { return d.name || d.hostname || TW.maskMac(d.mac); }
function dv_conn_text(d) {
	if (!d.online) return d.paused ? '已暫停上網' : '離線' + (d.last_seen_ts ? '（' + TW.fmtAgo(d.last_seen_ts) + '）' : '');
	if (d.conn == 'wired') return '有線';
	if (d.conn == 'wired_guess') return '有線，或剛離開 Wi-Fi';
	var s = d.conn == 'guest' ? '訪客 Wi-Fi' : 'Wi-Fi';
	if (d.band) s += ' ' + d.band + ' GHz';
	if (d.ap) s += ' · ' + d.ap;
	return s;
}

/* ---------- 清單 ---------- */
function dv_list_init() {
	var U = TW;
	var h = U.pageHead({ title: '裝置', sub: '<span id="dv-sub">讀取中…</span>',
		actions: U.button('網路地圖', { href: 'Main_NetMap.asp', icon: 'link' }) + U.button('固定 IP 清單', { href: 'Advanced_DHCP_Content.asp' }) });
	h += '<section class="tw-card"><div class="tw-toolbar"><div class="tw-seg" role="group" aria-label="篩選">' +
		DV_FILTERS.map(function (f) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (DV.filter == f[0]) + '" onclick="dv_set_filter(\'' + f[0] + '\')">' + f[1] + '</button>'; }).join('') +
		'</div><input type="search" class="tw-search" placeholder="搜尋名稱、IP、MAC" aria-label="搜尋裝置" oninput="DV.q=this.value;dv_render()"></div>' +
		'<div id="dv-list">' + U.stateBox('loading') + '</div><div id="dv-note"></div></section>';
	U.mount(h);
	U.poll(function () {
		return U.api('devices').then(function (r) { DV.src = r; DV.list = r.devices || null; dv_render(); });
	}, 10000);
}
function dv_set_filter(f) {
	DV.filter = f;
	var b = document.querySelectorAll('.tw-seg button');
	for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', b[i].getAttribute('data-f') == f ? 'true' : 'false');
	dv_render();
}
function dv_match(d) {
	var f = DV.filter, sg = TW.signal(d.signal_dbm).state;
	if (f == 'wifi' && !(d.online && d.conn == 'wifi')) return false;
	if (f == 'wired' && !(d.online && (d.conn == 'wired' || d.conn == 'wired_guess'))) return false;
	if (f == 'guest' && !(d.online && d.conn == 'guest')) return false;
	if (f == 'weak' && !(d.online && sg == 'bad')) return false;
	if (f == 'offline' && d.online && !d.paused) return false;
	if (DV.q) {
		var q = DV.q.toLowerCase(), hay = [d.name, d.hostname, d.ip, d.mac, TW.macKey(d.mac)].join(' ').toLowerCase();
		if (hay.indexOf(q) < 0) return false;
	}
	return true;
}
function dv_render() {
	var U = TW, r = DV.src, g = U.guard(r);
	if (g) { U.set('dv-list', g); return; }
	var all = DV.list || [];
	var online = all.filter(function (d) { return d.online; }).length;
	var sub = U.$('dv-sub');
	if (sub) sub.textContent = online + ' 台在線' + (all.length > online ? '、' + (all.length - online) + ' 台離線或暫停' : '');
	var list = all.filter(dv_match);
	/* 預設依「最近活動」：在線的在前、上線時間短的在前（剛連上的） */
	list.sort(function (a, b) {
		if (a.online != b.online) return a.online ? -1 : 1;
		var sa = a.since_s == null ? 1e12 : a.since_s, sb = b.since_s == null ? 1e12 : b.since_s;
		if (sa != sb) return sa - sb;
		return dv_name(a).localeCompare(dv_name(b), 'zh-Hant');
	});
	var rows = list.map(function (d) {
		var t = DV_TYPE[d.type] || DV_TYPE.other, sg = U.signal(d.signal_dbm);
		var signal = d.signal_dbm != null ? '<span class="tw-inline">' + U.chip(sg.state, sg.label) + '<span class="tw-num tw-muted">' + d.signal_dbm + ' dBm</span></span>' : (d.conn == 'wired' && d.online ? U.chip('ok', '有線') : '<span class="tw-muted">--</span>');
		var acts = U.button('詳情', { small: true, href: 'tw_devices.asp?mac=' + encodeURIComponent(d.mac) });
		acts += d.paused ? U.button('恢復上網', { small: true, onclick: "dv_resume('" + d.mac + "')" }) : U.button('暫停', { small: true, onclick: "dv_pause('" + d.mac + "')" });
		return {
			_attr: '',
			dev: '<div class="tw-dev"><span class="tw-dev-ico" title="' + U.esc(t[1]) + '">' + U.icon(t[0], 18) + '</span><span class="tw-dev-text">' +
				'<a class="tw-dev-name" href="tw_devices.asp?mac=' + encodeURIComponent(d.mac) + '">' + U.esc(dv_name(d)) + '</a>' +
				'<span class="tw-dev-sub">' + U.esc(U.maskMac(d.mac)) + (d.disconnects_today ? ' · 今天斷線 ' + d.disconnects_today + ' 次' : '') + '</span></span></div>',
			conn: U.esc(dv_conn_text(d)),
			signal: signal,
			ip: d.ip ? '<span class="tw-inline"><span class="tw-num">' + U.esc(d.ip) + '</span>' + (d.static_ip ? U.chip('info', '固定') : '') + '</span>' : '<span class="tw-muted">--</span>',
			since: d.online && d.since_s != null ? U.fmtDur(d.since_s) : '<span class="tw-muted">--</span>',
			act: '<div class="tw-row-actions">' + acts + '</div>'
		};
	});
	U.set('dv-list', U.table({ cols: [{ key: 'dev', label: '裝置', cls: 'tw-cell-main' }, { key: 'conn', label: '連線方式' }, { key: 'signal', label: '訊號' },
		{ key: 'ip', label: 'IP 位址' }, { key: 'since', label: '這次上線' }, { key: 'act', label: '動作', cls: 'tw-right' }], rows: rows,
		empty: DV.q ? '找不到符合的裝置' : '這個分類沒有裝置' }));
	U.set('dv-note', r.partial ? '<div class="tw-partial">' + U.icon('info', 14) + '<span>頻段、連到哪台 AP、上線時間與斷線紀錄需要更新韌體後才有。目前的資料分不出「有線」和「剛離開 Wi-Fi」，所以沒有 Wi-Fi 訊號的裝置都標成「有線，或剛離開 Wi-Fi」。</span></div>' : '');
}

/* ---------- 詳情 ---------- */
function dv_detail_init() {
	var U = TW;
	U.mount(U.pageHead({ title: '裝置', crumbs: [{ label: '裝置', href: 'tw_devices.asp' }, { label: '讀取中…' }] }) + U.stateBox('loading'));
	U.api('devices').then(function (r) {
		var d = null;
		(r.devices || []).forEach(function (x) { if (U.macKey(x.mac) == U.macKey(DV.mac)) d = x; });
		if (!d) {
			var st = dv_static_of(DV.mac);
			d = { mac: DV.mac, name: st ? st.name : '', online: false, ip: st ? st.ip : '', static_ip: !!st, paused: !!dv_pause_of(DV.mac), type: U.guessType(st && st.name) };
		}
		DV.dev = d;
		dv_detail_render(d, r);
		U.poll(function () { return U.api('device', { mac: d.mac }).then(dv_history); }, 60000);
	});
}
function dv_detail_render(d, r) {
	var U = TW, sg = U.signal(d.signal_dbm), t = DV_TYPE[d.type] || DV_TYPE.other;
	var chip = !d.online ? U.chip(d.paused ? 'warn' : 'unknown', d.paused ? '已暫停上網' : '離線') : (d.signal_dbm != null ? U.chip(sg.state, '訊號' + sg.label) : U.chip('ok', '在線'));
	var sub = [dv_conn_text(d)];
	if (d.ip) sub.push(d.ip + (d.static_ip ? '（固定）' : '（DHCP）'));
	sub.push(U.maskMac(d.mac));
	if (d.online && d.since_s != null) sub.push('這次已連線 ' + U.fmtDur(d.since_s));
	var acts = U.button(d.static_ip ? '修改名稱／IP' : '取名並固定 IP', { icon: 'edit', onclick: 'dv_rename()' }) +
		(d.paused ? U.button('恢復上網', { icon: 'play', onclick: "dv_resume('" + d.mac + "')" }) : U.button('暫停上網', { icon: 'pause', onclick: "dv_pause('" + d.mac + "')" })) +
		U.button('喚醒（WOL）', { icon: 'power', onclick: 'dv_wake()', title: '對有線電腦送出網路喚醒封包' });
	var h = U.pageHead({ title: dv_name(d), chip: chip, crumbs: [{ label: '裝置', href: 'tw_devices.asp' }, { label: dv_name(d) }],
		sub: '<span class="tw-num">' + U.esc(sub.join(' · ')) + '</span>', actions: acts });
	h += '<div class="tw-grid-metrics">';
	h += U.metric({ label: '訊號強度', value: d.signal_dbm != null ? d.signal_dbm : '--', unit: d.signal_dbm != null ? 'dBm' : '', state: d.signal_dbm != null ? sg.state : '',
		ref: d.signal_dbm != null ? '建議 -65 dBm 以上' : (d.conn == 'wired' ? '有線連線' : '') });
	h += U.metric({ label: '連線速率（下行／上行）', value: d.tx_rate_mbps != null ? d.tx_rate_mbps + ' / ' + (d.rx_rate_mbps == null ? '--' : d.rx_rate_mbps) : '--', unit: d.tx_rate_mbps != null ? 'Mbps' : '',
		ref: d.tx_rate_mbps == null ? '需要更新韌體後才有' : 'Wi-Fi 協商速率，不是實際流量' });
	h += U.metric({ label: '今天斷線', value: d.disconnects_today != null ? d.disconnects_today : '--', unit: d.disconnects_today != null ? '次' : '', state: d.disconnects_today > 2 ? 'bad' : (d.disconnects_today ? 'warn' : ''),
		ref: d.disconnects_today == null ? '需要更新韌體後才有' : '' });
	h += U.metric({ label: '今天用量', value: d.usage_today_bytes != null ? U.fmtBytes(d.usage_today_bytes) : '--',
		ref: d.usage_today_bytes == null ? '硬體 NAT 會繞過計數，只有 Wi-Fi 驅動統計得到' : 'Wi-Fi 驅動統計' });
	h += '</div>';
	h += U.card({ title: '訊號強度與斷線（24 小時）', bodyId: 'dv-signal', body: U.stateBox('loading') });
	h += '<div class="tw-grid-2">' + U.card({ title: '怎麼改善', bodyId: 'dv-advice', body: U.stateBox('loading') }) +
		U.card({ title: '斷線與漫遊紀錄', bodyId: 'dv-events', body: U.stateBox('loading') }) + '</div>';
	h += U.card({ title: '裝置資料', body: '<dl class="tw-kv"><dt>類型</dt><dd>' + U.esc(t[1]) + '</dd><dt>MAC</dt><dd>' + U.esc(d.mac) + '</dd>' +
		'<dt>主機名稱</dt><dd>' + U.esc(d.hostname || '--') + '</dd><dt>IP 位址</dt><dd>' + U.esc(d.ip || '--') + (d.static_ip ? '（固定 IP）' : '') + '</dd></dl>' });
	U.mount(h);
}
function dv_history(r) {
	var U = TW, g = U.guard(r, { unavailable: '訊號歷史、斷線與漫遊紀錄需要更新韌體後才有' });
	if (g) { ['dv-signal', 'dv-advice', 'dv-events'].forEach(function (id) { U.set(id, g); }); return; }
	var d = DV.dev;
	if (r.signal && r.signal.values) {
		U.set('dv-signal', U.chart({ series: [{ values: r.signal.values, color: 'var(--text)', label: '訊號（dBm）' }], step: r.signal.step, start: r.signal.start,
			height: 180, min: -95, max: -40, bands: [{ from: -65, to: -40, color: 'var(--good-soft)' }, { from: -75, to: -65, color: 'var(--warn-soft)' }, { from: -95, to: -75, color: 'var(--bad-soft)' }],
			marks: (r.disconnects || []).map(function (x) { return x.ts; }), fmt: function (v) { return Math.round(v) + ' dBm'; },
			label: '24 小時訊號強度，紅線是斷線時間' }) +
			'<div class="tw-legend"><span><i style="background:var(--good-soft);height:10px"></i>強（-65 dBm 以上）</span><span><i style="background:var(--warn-soft);height:10px"></i>普通</span>' +
			'<span><i style="background:var(--bad-soft);height:10px"></i>弱（-75 dBm 以下）</span><span><i style="background:var(--bad);width:2px;height:12px"></i>斷線</span></div>');
	} else if (d && d.conn == 'wired') {
		U.set('dv-signal', U.stateBox('empty', '有線裝置沒有訊號強度'));
	} else {
		U.set('dv-signal', U.stateBox('warming', '訊號紀錄收集中'));
	}
	var adv = r.advice || [];
	U.set('dv-advice', adv.length ? adv.map(function (a, i) {
		return '<div class="tw-notice" style="cursor:default"><span class="tw-dev-ico tw-num" style="border-radius:50%">' + (i + 1) + '</span><span class="tw-notice-text"><span class="tw-notice-title">' +
			U.esc(a.title) + '</span><span class="tw-notice-ev">' + U.esc(a.detail) + '</span></span>' + (a.href ? U.button(a.action || '前往', { small: true, href: a.href }) : '') + '</div>';
	}).join('') : U.stateBox('empty', '這台裝置目前沒有需要改善的地方'));
	var ev = [];
	(r.disconnects || []).forEach(function (x) { ev.push({ ts: x.ts, type: 'device', level: 'warn', text: '斷線：' + x.reason }); });
	(r.roams || []).forEach(function (x) { ev.push({ ts: x.ts, type: 'roam', level: 'ok', text: '從 ' + x.from + ' 換到 ' + x.to + '（' + x.rssi_from + ' → ' + x.rssi_to + ' dBm）' }); });
	ev.sort(function (a, b) { return b.ts - a.ts; });
	U.set('dv-events', U.timeline(ev, '最近 24 小時沒有斷線或漫遊'));
}

/* ---------- 動作（都走 /start_apply.htm 的清單機制） ---------- */
function dv_find(mac) {
	var d = null;
	(DV.list || [DV.dev]).forEach(function (x) { if (x && TW.macKey(x.mac) == TW.macKey(mac)) d = x; });
	return d || DV.dev || { mac: mac };
}
function dv_ip_ok(ip) {
	var a = String(ip).split('.'), l = String(NV.lan_ip).split('.'), m = String(NV.lan_mask).split('.');
	if (a.length != 4) return false;
	for (var i = 0; i < 4; i++) {
		var x = parseInt(a[i], 10);
		if (isNaN(x) || x < 0 || x > 255 || String(x) != a[i]) return false;
		if ((x & m[i]) != (l[i] & m[i])) return false;
	}
	return ip != NV.lan_ip && a[3] != '0' && a[3] != '255';
}
function dv_rename() {
	var U = TW, d = DV.dev, st = dv_static_of(d.mac);
	if (st) {
		U.dialog({ title: '修改名稱或固定 IP', body: '<p>這台裝置已經有固定 IP（' + U.esc(st.ip) + '）。修改要先刪除舊的設定再新增，請到「進階設定 › 區域網路 › DHCP 伺服器」的固定 IP 清單操作。</p>',
			ok: '前往固定 IP 清單', cancel: '取消' }).then(function (y) { if (y) location.href = 'Advanced_DHCP_Content.asp'; });
		return;
	}
	if (MDHCP.length >= 64) { U.toast('固定 IP 清單已滿（64 筆）', 'bad'); return; }
	var body = '<div class="tw-field"><label for="dv-n">名稱</label><input type="text" id="dv-n" maxlength="24" value="' + U.esc(d.name || d.hostname || '') + '" placeholder="例如：客廳電視"></div>' +
		'<div class="tw-field"><label for="dv-ip">固定 IP 位址</label><input type="text" id="dv-ip" maxlength="15" value="' + U.esc(d.ip || '') + '">' +
		'<div class="tw-help">要在 ' + U.esc(NV.lan_ip) + ' 同一個網段。之後這台裝置每次都拿到這個位址（連接埠轉送、NAS 需要）。</div></div>' +
		'<div id="dv-err" class="tw-small" style="color:var(--bad)"></div>';
	var extra = { dhcp_staticnum_x_0: MDHCP.length };
	if (NV.dhcp_static != '1') extra.dhcp_static_x = '1';
	U.listAdd({ sid: 'LANHostConfig;', group: 'ManualDHCPList', title: '取名並固定 IP', body: body, ok: '套用',
		impacts: ['DHCP 服務重新啟動（幾秒鐘，已連線的裝置不受影響）', '這台裝置下次重新連線時才會換到新位址'].concat(NV.dhcp_static != '1' ? ['同時開啟「固定 IP 清單」功能'] : []),
		fields: function () { return DV.pending; }, extra: extra,
		onOk: function (box) {
			var n = U.$('dv-n').value.trim(), ip = U.$('dv-ip').value.trim(), err = U.$('dv-err');
			if (!n) { err.textContent = '請輸入名稱'; return false; }
			if (/[<>"'\\,;]/.test(n)) { err.textContent = '名稱不能有 < > " \' \\ , ; 這些符號'; return false; }
			if (!dv_ip_ok(ip)) { err.textContent = 'IP 位址要在 ' + NV.lan_ip + '/' + NV.lan_mask + ' 網段內，而且不能是路由器自己'; return false; }
			for (var i = 0; i < MDHCP.length; i++) if (MDHCP[i][1] == ip) { err.textContent = '這個位址已經給 ' + MDHCP[i][2] + ' 用了'; return false; }
			DV.pending = { dhcp_staticmac_x_0: U.macKey(d.mac), dhcp_staticip_x_0: ip, dhcp_staticname_x_0: n };
			return true;
		}
	});
}
function dv_pause(mac) {
	var U = TW, d = dv_find(mac);
	if (NV.mf_mode == '1') {
		U.dialog({ title: '無法暫停', body: '<p>MAC 過濾目前是「只允許清單內的裝置」（白名單）模式，暫停上網要用「封鎖清單」模式。請到進階設定調整。</p>', ok: '前往 MAC 過濾' })
			.then(function (y) { if (y) location.href = 'Advanced_MACFilter_Content.asp'; });
		return;
	}
	if (MFLIST.length >= 64) { U.toast('封鎖清單已滿（64 筆）', 'bad'); return; }
	var body = '<p><b>' + U.esc(dv_name(d)) + '</b> 會立刻不能上網，也連不到家裡其他裝置；隨時可以恢復。</p>' +
		'<div class="tw-field"><span class="tw-field-label">暫停多久</span><div class="tw-seg"><button type="button" aria-pressed="true">直到我恢復</button>' +
		'<button type="button" disabled title="需要更新韌體">1 小時</button><button type="button" disabled title="需要更新韌體">到今晚 10 點</button></div>' +
		'<div class="tw-help">定時自動恢復需要更新韌體後才能使用。</div></div>';
	var extra = { macfilter_num_x_0: MFLIST.length };
	if (NV.mf_mode != '2') extra.macfilter_enable_x = '2';
	U.listAdd({ sid: 'FirewallConfig;', group: 'MFList', title: '暫停上網？', body: body, ok: '暫停上網', danger: true,
		impacts: ['防火牆重新載入（約 2 秒，其他裝置不受影響）'].concat(NV.mf_mode != '2' ? ['同時開啟 MAC 過濾的「封鎖清單」模式'] : []),
		fields: { macfilter_list_x_0: U.macKey(d.mac), macfilter_time_x_0: '00002359', macfilter_date_x_0: '1111111' }, extra: extra });
}
function dv_resume(mac) {
	var U = TW, d = dv_find(mac), p = dv_pause_of(mac);
	if (!p) { U.toast('在封鎖清單裡找不到這台裝置，請重新整理', 'bad'); return; }
	U.listDel({ sid: 'FirewallConfig;', group: 'MFList', title: '恢復上網？', body: '<p><b>' + U.esc(dv_name(d)) + '</b> 會恢復上網。</p>', ok: '恢復上網',
		impacts: ['防火牆重新載入（約 2 秒）'], fields: { MFList_s: p.index }, extra: { macfilter_num_x_0: MFLIST.length } });
}
function dv_wake() {
	var U = TW, d = DV.dev;
	U.dialog({ title: '喚醒這台裝置？', body: '<p>對 <b>' + U.esc(dv_name(d)) + '</b> 送出網路喚醒（Wake-on-LAN）封包。裝置要用網路線連接，並在 BIOS／網卡設定開啟網路喚醒。</p>', ok: '送出' }).then(function (y) {
		if (!y) return;
		fetch('/wol_action.asp', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'dstmac=' + encodeURIComponent(d.mac) })
			.then(function (r) { return r.text(); })
			.then(function (t) { U.toast(/null/.test(t) ? '送出失敗' : '已送出喚醒封包', /null/.test(t) ? 'bad' : 'ok'); }, function () { U.toast('送出失敗', 'bad'); });
	});
}
