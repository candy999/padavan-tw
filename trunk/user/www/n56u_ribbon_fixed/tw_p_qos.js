/* padavan-tw 頻寬管理（硬體 QoS）：怎麼讓視訊、遊戲不卡？（docs/HANDOFF-UI.md 5.5） */
var QS = { r: null, mode: null, lat: null };
var QS_MODES = [
	{ id: 'off', title: '關閉', desc: '不做任何限速，速度最快', gain: '下載、上傳都能跑滿方案', cost: '有人大量下載時，遊戲與視訊可能卡頓' },
	{ id: 'fixed', title: '固定限速', desc: '一直把速度壓在方案的 90 %', gain: '延遲一直很穩', cost: '最高速度永遠少 10 %' },
	{ id: 'auto', title: '自動（建議）', desc: '平常全速；延遲升高時才介入', gain: '平常全速，塞車時才限速', cost: '介入前的幾秒仍可能卡一下' }
];
var QS_STEPS = [['idle', '平常'], ['probing', '確認中'], ['limiting', '控制中'], ['deciding', '判斷'], ['ending', '結束']];
var QS_PLANS = [[100, 40], [300, 100], [500, 250], [1000, 600], [2000, 1000]];

function page_init() {
	var U = TW;
	var h = U.pageHead({ title: '頻寬管理', sub: '讓視訊會議、線上遊戲在有人下載時也不卡' });
	h += '<section class="tw-card" id="qs-state">' + U.stateBox('loading') + '</section>';
	h += U.card({ title: '模式', bodyId: 'qs-mode', body: '' });
	h += '<div class="tw-grid-2">' + U.card({ title: '最近介入紀錄', bodyId: 'qs-log', body: U.stateBox('loading') }) +
		U.card({ title: '延遲（24 小時）', lead: '介入時的延遲變化；紅線是介入時間', bodyId: 'qs-lat', body: U.stateBox('loading') }) + '</div>';
	U.mount(h);
	U.api('latency').then(function (r) { QS.lat = r; qs_lat(); });
	U.poll(function () { return U.api('qos').then(qs_render); }, 5000);
}
function qs_available() { return QS.r && QS.r.available !== false && !QS.r._error; }
function qs_render(r) {
	var U = TW;
	QS.r = r;
	if (QS.mode == null) QS.mode = r && r.mode ? r.mode : ({ '0': 'off', '1': 'fixed', '2': 'auto' }[NV.qos_mode] || 'off');
	/* 狀態 */
	var h;
	if (!qs_available()) {
		h = U.conclusion({ state: 'unknown', title: '硬體 QoS 需要更新韌體後才能使用', sub: '這是 padavan-tw 下一版的功能：用硬體 NAT 的限速，速度不受 CPU 限制。' });
		if (typeof found_app_sqm == 'function' && found_app_sqm()) {
			h += '<div class="tw-note">現在可以先用 <b>SQM</b>（軟體 QoS）：延遲壓得很低，但要關閉硬體 NAT，最高速度約 150～300 Mbps。' +
				'目前' + (NV.sqm_on == '1' ? '<b>已開啟</b>' : '關閉') + '。<a href="Advanced_SQM.asp">SQM 設定</a></div>';
		}
	} else if (r.warming_up) {
		h = U.stateBox('warming');
	} else {
		var on = r.mode != 'off', lim = r.state == 'limiting' || r.state == 'deciding';
		h = U.conclusion({ state: lim ? 'warn' : on ? 'ok' : 'off',
			title: !on ? '頻寬管理關閉' : lim ? '正在控制：' + (r.limit_down_kbps ? '下行限速 ' + U.rateText(r.limit_down_kbps) : '') + (r.limit_up_kbps ? ' 上行限速 ' + U.rateText(r.limit_up_kbps) : '') : '平常：全速，沒有限速',
			sub: '方案 ' + U.rateText(r.plan_down_kbps) + ' / ' + U.rateText(r.plan_up_kbps) + '（模式：' + (QS_MODES.filter(function (m) { return m.id == r.mode; })[0] || {}).title + '）' });
		if (r.mode == 'auto') h += '<ol class="tw-steps" aria-label="自動模式目前在哪一步">' + QS_STEPS.map(function (s) { return '<li class="' + (s[0] == r.state ? 'on' : '') + '"' + (s[0] == r.state ? ' aria-current="step"' : '') + '>' + s[1] + '</li>'; }).join('') + '</ol>';
	}
	U.set('qs-state', h);
	/* 模式與方案（只在第一次或資料可用狀態改變時重畫，避免打斷輸入） */
	var key = qs_available() ? 'on' : 'off';
	if (QS.drawn != key) { QS.drawn = key; qs_mode_form(); }
	/* 介入紀錄 */
	if (!qs_available()) U.set('qs-log', U.stateBox('unavailable'));
	else if (r.warming_up) U.set('qs-log', U.stateBox('warming'));
	else U.set('qs-log', U.table({ cols: [{ key: 't', label: '時間', cls: 'tw-cell-main' }, { key: 'w', label: '原因' }, { key: 'a', label: '做了什麼' }, { key: 'l', label: '延遲（前 → 後）' }],
		rows: (r.interventions || []).map(function (x) {
			return { t: '<b class="tw-num">' + U.fmtTime(x.ts) + '</b><span class="tw-dev-sub">持續 ' + U.fmtDur(x.duration_s) + '</span>', w: U.esc(x.reason), a: U.esc(x.action),
				l: '<span class="tw-num">' + x.latency_before_ms + ' → <b style="color:var(--good)">' + x.latency_after_ms + '</b> ms</span>' };
		}), empty: '最近沒有介入：網路很順' }));
	qs_lat();
}
function qs_mode_form() {
	var U = TW, ok = qs_available(), r = QS.r || {};
	var down = r.plan_down_kbps ? r.plan_down_kbps / 1000 : (parseInt(NV.qos_down, 10) || 500), up = r.plan_up_kbps ? r.plan_up_kbps / 1000 : (parseInt(NV.qos_up, 10) || 250);
	var h = '<div class="tw-options" role="group" aria-label="模式">' + QS_MODES.map(function (m) {
		return '<button type="button" class="tw-option" id="qs-m-' + m.id + '" aria-pressed="' + (QS.mode == m.id) + '"' + (ok ? '' : ' disabled') + ' onclick="qs_pick(\'' + m.id + '\')">' +
			'<span class="tw-option-title">' + U.esc(m.title) + '</span><span class="tw-option-desc">' + U.esc(m.desc) + '</span>' +
			'<span class="tw-option-cost"><span style="color:var(--good)">好處</span> ' + U.esc(m.gain) + '<br><b>代價</b> ' + U.esc(m.cost) + '</span></button>';
	}).join('') + '</div>';
	h += '<div class="tw-field"><span class="tw-field-label">申裝方案（下載／上傳）</span><div class="tw-inline">' +
		'<select id="qs-plan" onchange="qs_plan()"' + (ok ? '' : ' disabled') + ' style="width:auto">' + QS_PLANS.map(function (p) {
			return '<option value="' + p[0] + '/' + p[1] + '"' + (p[0] == down && p[1] == up ? ' selected' : '') + '>' + (p[0] >= 1000 ? p[0] / 1000 + 'G' : p[0] + 'M') + ' / ' + (p[1] >= 1000 ? p[1] / 1000 + 'G' : p[1] + 'M') + '</option>';
		}).join('') + '<option value="custom"' + (QS_PLANS.some(function (p) { return p[0] == down && p[1] == up; }) ? '' : ' selected') + '>自訂</option></select>' +
		'<input type="number" id="qs-down" min="1" max="10000" value="' + down + '" style="width:100px"' + (ok ? '' : ' disabled') + ' aria-label="下載 Mbps"> / ' +
		'<input type="number" id="qs-up" min="1" max="10000" value="' + up + '" style="width:100px"' + (ok ? '' : ' disabled') + ' aria-label="上傳 Mbps"> Mbps</div>' +
		'<div class="tw-help">照業者帳單上的方案填；中華電信光世代 500M/250M 就選 500M / 250M。</div></div>';
	h += '<div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'qs_apply()', disabled: !ok }) + '<span class="tw-cost">套用時網路不會中斷</span></div>';
	U.set('qs-mode', h);
}
function qs_pick(id) { QS.mode = id; QS_MODES.forEach(function (m) { TW.$('qs-m-' + m.id).setAttribute('aria-pressed', m.id == id ? 'true' : 'false'); }); }
function qs_plan() { var v = TW.$('qs-plan').value; if (v == 'custom') return; var p = v.split('/'); TW.$('qs-down').value = p[0]; TW.$('qs-up').value = p[1]; }
function qs_apply() {
	var U = TW, d = parseInt(U.$('qs-down').value, 10), u = parseInt(U.$('qs-up').value, 10);
	if (!(d > 0 && u > 0)) { U.toast('請填方案的下載與上傳速度', 'bad'); return; }
	var m = QS_MODES.filter(function (x) { return x.id == QS.mode; })[0];
	U.apply({ sid: 'General;', fields: { tw_qos_mode: { off: '0', fixed: '1', auto: '2' }[QS.mode], tw_qos_down: d, tw_qos_up: u }, title: '套用頻寬管理？',
		impacts: ['模式：' + m.title + '（代價：' + m.cost + '）', '方案：' + d + ' / ' + u + ' Mbps', '網路不會中斷'] });
}
function qs_lat() {
	var U = TW, r = QS.lat;
	var g = U.guard(r, { unavailable: '延遲紀錄需要更新韌體後才有' });
	if (g) { U.set('qs-lat', g); return; }
	var t = (r.targets || []).filter(function (x) { return x.id == 'hinet'; })[0] || (r.targets || [])[0];
	if (!t) { U.set('qs-lat', U.stateBox('empty')); return; }
	var marks = QS.r && QS.r.interventions ? QS.r.interventions.map(function (x) { return x.ts; }) : [];
	U.set('qs-lat', U.chart({ series: [{ values: t.series.values, color: 'var(--accent)', label: t.label + ' 延遲' }], step: t.series.step, start: t.series.start, height: 150,
		marks: marks, guide: { value: r.baseline_ms, label: '平常 ' + r.baseline_ms + ' ms' }, fmt: function (v) { return Math.round(v) + ' ms'; }, label: '24 小時延遲' }));
}
