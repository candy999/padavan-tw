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
	h += dg_loop_card();
	U.mount(h);
	dg_bpdu_load();
	if (TW.qs('run') == '1') dg_run();
	U.poll(function () { return Promise.all([U.api('latency').then(function (r) { DG.lat = r; dg_lat(); }), U.api('events').then(dg_events)]); }, 30000);
	U.api('speedtest').then(dg_speed);
}

/* ---------- Wi-Fi 迴圈保護（tw_wifi_bpdu、tw_wifi_fast；rc 的 tw_wifibpdu.c） ----------
 * 只放開關；觸發時的原因與當下狀態由路由器寫進系統記錄（Wi-Fi BPDU）與 /etc/storage/tw-diag/，排錯時再看 */
function dg_loop_card() {
	var U = TW, stp = NV.lan_stp != '0', bpdu = NV.wifi_bpdu != '0', fast = NV.wifi_fast != '0';
	var b = '<label class="tw-switch"><input type="checkbox" id="dg-bpdu"' + (bpdu ? ' checked' : '') + '><span class="tw-track"></span>擋掉 Wi-Fi 上的 STP 封包（避免 Wi-Fi 被誤判成迴圈而中斷）</label>' +
		'<label class="tw-switch"><input type="checkbox" id="dg-fast"' + (fast ? ' checked' : '') + '><span class="tw-track"></span>急速連線（Wi-Fi 重新啟動後立刻恢復，不等 8 秒）</label>' +
		'<p class="tw-small tw-muted">' + (stp ? '平常不用調整。某個 Wi-Fi 頻段收到其他裝置的 STP 封包（家裡可能有橋接器或中繼器）時，那個頻段會自動改回標準保護並記錄在系統記錄，重開機後恢復。急速連線要在「擋掉 Wi-Fi 上的 STP 封包」開著時才有作用。'
			: '目前 STP 是關閉的（區網設定），這兩個設定不會作用。') + '</p>' +
		'<div class="tw-actions">' + U.button('套用', { small: true, onclick: 'dg_loop_apply()' }) + '</div>' +
		'<div id="dg-bpdu-log" class="tw-small tw-muted" style="margin-top:12px">讀取攔截紀錄…</div>';
	return U.card({ title: 'Wi-Fi 迴圈保護', body: b });
}
/* 攔截紀錄：路由器上的 tw-bpdu-status（只讀）——收到的 STP 封包數、自己擋下的數量、改回標準 STP 的頻段、最近 5 次觸發的原因 */
function dg_bpdu_load() {
	var U = TW, el = U.$('dg-bpdu-log');
	if (!el) return;
	if (typeof login_safe == 'function' && !login_safe()) { el.textContent = '攔截紀錄只能在區域網路登入時查看。'; return; }
	var body = 'action_mode=+SystemCmd+&current_page=console_response.asp&next_page=console_response.asp&SystemCmd=tw-bpdu-status';
	fetch('/apply.cgi', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
		.then(function () { return fetch('/console_response.asp', { cache: 'no-store', credentials: 'same-origin' }); })
		.then(function (x) { return x.text(); })
		.then(function (t) {
			t = t.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
			var kv = {}, ev = [], inEv = false;
			t.split(/\r?\n/).forEach(function (l) {
				if (/^EVENTS\s*$/.test(l)) { inEv = true; return; }
				if (inEv) { if (l.trim()) ev.push(l); return; }
				var m = /^([A-Z]+)=(.*)$/.exec(l.trim()); if (m) kv[m[1]] = m[2].trim();
			});
			if (kv.IN == null) { el.textContent = '讀不到攔截紀錄（韌體太舊或路由器沒有回應）。'; return; }
			var inN = +kv.IN || 0, outN = +kv.OUT || 0, logN = +kv.LOGN || 0, hw = +kv.HWNAT || 0;
			var h = '<div class="tw-inline">' + U.dot(inN || logN ? 'warn' : 'ok') + '<b>' + (inN ? '開機後 Wi-Fi 收到 ' + Number(inN).toLocaleString() + ' 個 STP 封包（已擋下）' : '開機後 Wi-Fi 沒有收到任何 STP 封包') + '</b></div>' +
				'<ul style="margin:6px 0 0;padding-left:18px">' +
				'<li>自己送往 Wi-Fi 的 STP 封包擋下 ' + Number(outN).toLocaleString() + ' 個（正常，每 2 秒一個）</li>' +
				(kv.SLOW ? '<li>改回標準 STP 的頻段：' + U.esc(kv.SLOW) + '（收過其他裝置的 STP 封包，重開機後恢復）</li>' : '') +
				(hw ? '<li>硬體 NAT 保險擋下 ' + Number(hw).toLocaleString() + ' 次（應該是 0，非 0 請回報）</li>' : '') +
				'<li>記錄過的觸發：' + (logN ? logN + ' 次（存在路由器的 /etc/storage/tw-diag/）' : '沒有') + '</li></ul>';
			if (ev.length) h += '<details style="margin-top:6px"><summary>最近幾次觸發的原因</summary><pre style="white-space:pre-wrap;background:var(--surface-2);color:var(--text);border:0;border-radius:8px;padding:10px;font-size:12px;max-height:240px;overflow:auto">' + U.esc(ev.join('\n')) + '</pre></details>';
			el.className = 'tw-small'; el.innerHTML = h;
		}, function () { el.textContent = '讀不到攔截紀錄（登入逾時？請重新整理）。'; });
}
function dg_loop_apply() {
	var U = TW, b = U.$('dg-bpdu').checked, f = U.$('dg-fast').checked;
	/* 開著且原本是 1（只擋收進來的，進階用）就保留 1；其他一律 2（收送都擋，出廠預設） */
	var vb = b ? (NV.wifi_bpdu == '1' ? '1' : '2') : '0', vf = f ? '1' : '0';
	if (vb == (NV.wifi_bpdu || '2') && vf == (NV.wifi_fast || '1')) { U.toast('沒有變更'); return; }
	U.apply({ sid: 'LANHostConfig;', fields: { tw_wifi_bpdu: vb, tw_wifi_fast: vf }, title: '套用 Wi-Fi 迴圈保護？',
		impacts: ['區網會重新啟動，有線與 Wi-Fi 約中斷 10～20 秒'] });
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
		return U.metric({ label: t.label + (t.host ? '（' + t.host + '）' : ''), value: t.host ? U.num(t.current_ms, 1) : '--', unit: t.host ? 'ms' : '', state: st,
			ref: t.host ? '平常 ' + U.num(t.baseline_ms, 1) + ' ms · 掉包 ' + U.num(t.loss_pct, 1) + ' %' : '找不到閘道（網際網路還沒連線？）' });
	}).join('') + '</div>';
	/* 路由器時鐘對時之前沒有 24 小時圖（series 是 null） */
	var withS = show.filter(function (t) { return t.series && t.series.values; });
	if (withS.length) {
		h += U.chart({ series: withS.map(function (t) { return { values: t.series.values, color: DG_COLORS[ts.indexOf(t) % 4], label: t.label }; }), step: withS[0].series.step, start: withS[0].series.start,
			height: 180, fmt: function (v) { return Math.round(v) + ' ms'; }, label: '24 小時延遲' });
	} else {
		h += U.stateBox('warming', '路由器時鐘對時後才開始記錄 24 小時延遲');
	}
	var loss = (withS[0] || {}).loss;
	if (loss && loss.values && loss.values.some(function (x) { return x; })) {
		h += '<div class="tw-small tw-muted">掉包（' + U.esc(withS[0].label) + '）</div>' + U.chart({ series: [{ values: loss.values, color: 'var(--bad)', label: '掉包 %', area: true }], step: loss.step, start: loss.start, height: 70, min: 0, fmt: function (v) { return Math.round(v) + ' %'; }, label: '掉包率' });
	}
	h += '<div class="tw-small tw-muted">怎麼看：只有業者閘道正常、後面都變慢 → 問題在業者往外的路；業者閘道就變慢 → 業者那段，或家裡有人在大量上傳／下載（Wi-Fi 滿載時延遲本來就會變高）。</div>';
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
