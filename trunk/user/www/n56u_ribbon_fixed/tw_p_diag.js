/* padavan-tw 診斷：哪裡出問題？怎麼辦？（docs/HANDOFF-UI.md 5.5） */
var DG = { result: null, running: false, lat: null, target: 'all' };
var DG_COLORS = ['var(--accent)', 'var(--up)', 'var(--good)', 'var(--muted)'];

function page_init() {
	var U = TW;
	var h = U.pageHead({ title: '診斷', sub: '網路變慢、斷線時，逐段找出問題在哪裡',
		actions: U.button('開始檢查', { primary: true, icon: 'search', id: 'dg-run', onclick: 'dg_run()' }) + U.button('複製診斷報告', { icon: 'copy', onclick: 'dg_copy()' }) + U.button('下載報告', { icon: 'download', onclick: 'dg_download()' }) });
	h += '<section class="tw-card" id="dg-result"><p class="tw-small tw-muted">按「開始檢查」：依序檢查 Wi-Fi → 路由器 → 業者 → DNS → 網站，每一段都會說明結果與建議。</p></section>';
	h += U.card({ title: '延遲與掉包（24 小時）', bodyId: 'dg-lat', body: U.stateBox('loading'), extra: '<span id="dg-lat-pick"></span>' });
	h += '<div class="tw-grid-2">' + U.card({ title: '事件時間軸', bodyId: 'dg-events', body: U.stateBox('loading') }) + U.card({ title: '測速', bodyId: 'dg-speed', body: U.stateBox('loading') }) + '</div>';
	h += U.card({ title: '更多工具', body: '<div class="tw-actions">' + U.button('系統記錄', { small: true, href: 'Main_LogStatus_Content.asp' }) + U.button('連線狀態表', { small: true, href: 'Main_CTStatus_Content.asp' }) +
		U.button('路由表', { small: true, href: 'Main_RouteStatus_Content.asp' }) + U.button('即時流量', { small: true, href: 'Main_TrafficMonitor_realtime.asp' }) + U.button('網路地圖', { small: true, href: 'Main_NetMap.asp' }) + '</div>' });
	U.mount(h);
	if (TW.qs('run') == '1') dg_run();
	U.poll(function () { return Promise.all([U.api('latency').then(function (r) { DG.lat = r; dg_lat(); }), U.api('events').then(dg_events)]); }, 30000);
	U.api('speedtest').then(dg_speed);
}

/* ---------- 一鍵檢查 ---------- */
function dg_run() {
	var U = TW;
	if (DG.running) return;
	DG.running = true;
	var b = U.$('dg-run'); if (b) b.disabled = true;
	var t0 = Date.now();
	U.set('dg-result', U.stateBox('loading', '逐段檢查中，約需 30～40 秒…'));
	U.api('diag').then(function (r) {
		DG.running = false; if (b) b.disabled = false;
		var g = U.guard(r);
		if (g) { U.set('dg-result', g); return; }
		r.duration_s = r.duration_s || Math.round((Date.now() - t0) / 1000);
		DG.result = r;
		dg_render(r);
	});
}
function dg_render(r) {
	var U = TW;
	var h = U.conclusion({ state: r.level, title: r.headline, sub: '剛剛檢查完成' + (r._source == 'api' ? ' · 耗時 ' + r.duration_s + ' 秒' : '') + (r.partial ? ' · 依路由器目前能取得的資料判斷，延遲、掉包、干擾、網站回應等細項需要更新韌體後才有' : '') });
	h += '<ol class="tw-timeline" aria-label="逐段檢查結果">' + (r.segments || []).map(function (s, i) {
		var acts = (s.actions || []).map(function (a) {
			var btn = a.href == '#reconnect' ? U.button(a.label, { small: true, onclick: 'TW.wanReconnect()' }) : U.button(a.label, { small: true, href: a.href });
			return btn + (a.cost ? '<span class="tw-cost">代價：' + U.esc(a.cost) + '</span>' : '');
		}).join('');
		return '<li class="tw-s-' + s.state + '"><span class="tw-tl-ico tw-num" style="font-size:12px;font-weight:600">' + (i + 1) + '</span><div class="tw-tl-body" style="flex:1">' +
			'<div class="tw-inline">' + U.chip(s.state) + '<b>' + U.esc(s.label) + '</b><span>' + U.esc(s.summary) + '</span>' + (s.metric ? '<span class="tw-num tw-muted" style="margin-left:auto">' + U.esc(s.metric) + '</span>' : '') + '</div>' +
			(s.evidence ? '<div class="tw-tl-meta">' + U.esc(s.evidence) + '</div>' : '') + (acts ? '<div class="tw-actions" style="margin-top:8px">' + acts + '</div>' : '') + '</div></li>';
	}).join('') + '</ol>';
	U.set('dg-result', h);
}

/* ---------- 報告（自動隱藏密碼與 Token） ---------- */
function dg_report() {
	var U = TW, r = DG.result;
	var lines = ['padavan-tw 診斷報告', '產生時間：' + new Date().toLocaleString('zh-TW'), '路由器：' + U.unent(NV.productid) + '，韌體 ' + U.unent(NV.firmver) + '，運作模式 ' + (NV.sw_mode == '3' ? 'AP' : '路由器'), ''];
	if (r) {
		lines.push('結論：' + r.headline, '');
		(r.segments || []).forEach(function (s) { lines.push('[' + (U.STATE_LABEL[s.state] || s.state) + '] ' + s.label + '：' + s.summary + (s.evidence ? '（' + s.evidence + '）' : '') + (s.metric ? ' ' + s.metric : '')); });
	} else lines.push('（還沒有執行一鍵檢查）');
	var L = DG.lat;
	if (L && L.available !== false && L.targets) {
		lines.push('', '延遲：目前 ' + L.current_ms + ' ms，平常 ' + L.baseline_ms + ' ms，掉包 ' + L.loss_pct + ' %');
		L.targets.forEach(function (t) { lines.push('  ' + t.label + '（' + t.host + '）：' + t.current_ms + ' ms，平常 ' + t.baseline_ms + ' ms，掉包 ' + t.loss_pct + ' %'); });
	}
	if (DG.events && DG.events.length) {
		lines.push('', '最近事件：');
		DG.events.slice(0, 15).forEach(function (e) { lines.push('  ' + U.fmtTime(e.ts, true) + ' ' + e.text); });
	}
	lines.push('', '（這份報告不含密碼、PPPoE 帳號、Token 與裝置 MAC 的完整內容）');
	return dg_redact(lines.join('\n'));
}
function dg_redact(t) {
	return t.replace(/(password|passwd|psk|token|secret|密碼)\s*[:=：]\s*\S+/gi, '$1: ******')
		.replace(/[\w.+-]+@(ip\.)?hinet\.net/gi, '******@hinet.net')
		.replace(/\b([0-9A-F]{2}:){3}([0-9A-F]{2}:){2}([0-9A-F]{2})\b/gi, function (m) { return m.slice(0, 8) + ':··:··:' + m.slice(-2); });
}
function dg_copy() {
	var U = TW, t = dg_report();
	var id = 'dg-copy-src', el = U.$(id);
	if (!el) { el = document.createElement('code'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); }
	el.textContent = t;
	var btn = document.createElement('button'); btn.innerHTML = '<span></span>';
	U.copy(id, btn);
	U.toast(DG.result ? '已複製診斷報告' : '已複製（建議先按「開始檢查」）');
}
function dg_download() {
	var a = document.createElement('a');
	a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(dg_report());
	a.download = 'padavan-tw-diag-' + new Date().toISOString().slice(0, 10) + '.txt';
	document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ---------- 延遲與掉包 ---------- */
function dg_lat_pick(id) { DG.target = id; dg_lat(); }
function dg_lat() {
	var U = TW, r = DG.lat, g = U.guard(r, { unavailable: '延遲與掉包紀錄需要更新韌體後才有（路由器每 10 秒量一次業者閘道、HiNet DNS、TWNIC、Cloudflare）' });
	if (g) { U.set('dg-lat', g); return; }
	var ts = r.targets || [];
	U.set('dg-lat-pick', '<div class="tw-seg" role="group" aria-label="目標"><button type="button" aria-pressed="' + (DG.target == 'all') + '" onclick="dg_lat_pick(\'all\')">全部</button>' +
		ts.map(function (t) { return '<button type="button" aria-pressed="' + (DG.target == t.id) + '" onclick="dg_lat_pick(\'' + t.id + '\')">' + U.esc(t.label) + '</button>'; }).join('') + '</div>');
	var show = DG.target == 'all' ? ts : ts.filter(function (t) { return t.id == DG.target; });
	if (!show.length) { U.set('dg-lat', U.stateBox('empty')); return; }
	var h = '<div class="tw-grid-metrics">' + show.map(function (t) {
		var st = t.loss_pct > 2 || t.current_ms > t.baseline_ms * 3 + 20 ? 'bad' : (t.current_ms > t.baseline_ms * 1.8 + 10 ? 'warn' : '');
		return U.metric({ label: t.label + '（' + t.host + '）', value: U.num(t.current_ms, 1), unit: 'ms', state: st, ref: '平常 ' + U.num(t.baseline_ms, 1) + ' ms · 掉包 ' + t.loss_pct + ' %' });
	}).join('') + '</div>';
	h += U.chart({ series: show.map(function (t, i) { return { values: t.series.values, color: DG_COLORS[i % 4], label: t.label }; }), step: show[0].series.step, start: show[0].series.start,
		height: 180, fmt: function (v) { return Math.round(v) + ' ms'; }, label: '24 小時延遲' });
	var loss = show[0].loss;
	if (loss && loss.values && loss.values.some(function (x) { return x; })) {
		h += '<div class="tw-small tw-muted">掉包（' + U.esc(show[0].label) + '）</div>' + U.chart({ series: [{ values: loss.values, color: 'var(--bad)', label: '掉包 %', area: true }], step: loss.step, start: loss.start, height: 70, min: 0, fmt: function (v) { return Math.round(v) + ' %'; }, label: '掉包率' });
	}
	h += '<div class="tw-small tw-muted">怎麼看：只有業者閘道正常、後面都變慢 → 問題在業者往外的路；業者閘道就變慢 → 業者那段或家裡有人在大量下載（看「頻寬管理」）。</div>';
	U.set('dg-lat', h);
}

/* ---------- 事件、測速 ---------- */
function dg_events(r) {
	var U = TW, g = U.guard(r, { unavailable: '事件紀錄需要更新韌體後才有；現在可以先看系統記錄' });
	if (g) { U.set('dg-events', g + '<div class="tw-actions">' + U.button('系統記錄', { small: true, href: 'Main_LogStatus_Content.asp' }) + '</div>'); return; }
	DG.events = r.events || [];
	U.set('dg-events', U.timeline(DG.events.slice(0, 20), '最近沒有事件'));
}
function dg_speed(r) {
	var U = TW;
	if (!r || r.available === false) {
		U.set('dg-speed', U.stateBox('unavailable', '路由器端測速需要更新韌體後才能使用') +
			'<p class="tw-small">現在可以在電腦用 <b>Speedtest.net</b> 或中華電信的測速網站，用網路線接路由器測，結果最準。</p>');
		return;
	}
	var h = '';
	if (r.running) h += U.stateBox('loading', '測速中，約 20 秒…');
	else if (r.last) {
		h += '<div class="tw-grid-metrics">' + U.metric({ label: '下載', value: U.fmtRate(r.last.down_kbps).v, unit: U.fmtRate(r.last.down_kbps).u, state: 'down', ref: r.plan_down_kbps ? '方案的 ' + Math.round(r.last.down_kbps / r.plan_down_kbps * 100) + ' %' : '' }) +
			U.metric({ label: '上傳', value: U.fmtRate(r.last.up_kbps).v, unit: U.fmtRate(r.last.up_kbps).u, state: 'up' }) +
			U.metric({ label: '延遲', value: r.last.latency_ms, unit: 'ms' }) + '</div><div class="tw-small tw-muted">' + U.fmtTime(r.last.ts, true) + ' · ' + U.esc(r.last.server || '') + '</div>';
	} else h += U.stateBox('empty', '還沒有測過');
	h += '<div class="tw-actions">' + U.button('開始測速', { onclick: 'dg_speed_run()', disabled: !!r.running }) + '<span class="tw-cost">約 20 秒，期間網路會被佔滿</span></div>';
	U.set('dg-speed', h);
}
function dg_speed_run() {
	TW.dialog({ title: '開始測速？', ok: '開始', impacts: ['約 20 秒，期間網路頻寬會被佔滿', '家人正在視訊或玩遊戲時會卡'] }).then(function (y) {
		if (!y) return;
		TW.api('speedtest', { run: 1 }).then(dg_speed);
	});
}
