/* padavan-tw 頻寬管理（硬體 QoS）：怎麼讓視訊、遊戲不卡？（docs/HANDOFF-UI.md 5.5、docs/LOCAL-NEXT.md 第二件）
 *
 * 設定寫入後端既有的 hw_qos_*（variables.c 的 IPConnection 群組，變更後重啟防火牆，rc 套用 hnat_qos／hnat_qos_wlan 並清空硬體 NAT 表）。
 * 目前後端狀態：模式不是關閉時，流量只會「經過」硬體排程；限速值與自動控制器（ROADMAP E4～E8）還沒做，所以不會真的限速。
 * 頁面要誠實寫出來。控制器做好後，/tw_api.asp?q=qos 會提供狀態與介入紀錄，這頁會自動顯示。
 */
var QS = { r: null, mode: null, lat: null };
var QS_MODE_NV = { off: '0', fixed: '1', auto: '2' };
var QS_MODES = [
	{ id: 'off', title: '關閉', desc: '不經過硬體排程，速度最快', gain: '下載、上傳都能跑滿方案', cost: '有人大量下載時，遊戲與視訊可能卡頓' },
	{ id: 'fixed', title: '固定限速', desc: '一直把速度壓在方案附近', gain: '延遲一直很穩', cost: '最高速度會少一點' },
	{ id: 'auto', title: '自動（建議）', desc: '平常全速；延遲升高時才介入', gain: '平常全速，塞車時才限速', cost: '介入前的幾秒仍可能卡一下' }
];
var QS_STEPS = [['idle', '平常'], ['probing', '確認中'], ['limiting', '控制中'], ['deciding', '判斷'], ['ending', '結束']];
var QS_PLANS = [[100, 40], [300, 100], [500, 250], [1000, 600], [2000, 1000]];
var QS_TECH = [['ftth', '光纖到府（光世代、FTTH）'], ['vdsl', 'VDSL（大樓、ADSL 升級）'], ['cable', '有線電視（Cable）'], ['mobile', '行動網路（4G／5G 分享器）'], ['other', '其他']];

function qs_nv_mode() { return { '1': 'fixed', '2': 'auto' }[NV.mode] || 'off'; }

function page_init() {
	var U = TW;
	QS.mode = qs_nv_mode();
	var h = U.pageHead({ title: '頻寬管理', sub: '讓視訊會議、線上遊戲在有人下載時也不卡' });
	h += '<section class="tw-card" id="qs-state">' + U.stateBox('loading') + '</section>';
	h += U.card({ title: '設定', bodyId: 'qs-form', body: '' });
	h += '<div class="tw-grid-2">' + U.card({ title: '最近介入紀錄', bodyId: 'qs-log', body: U.stateBox('loading') }) +
		U.card({ title: '延遲（24 小時）', lead: '介入時的延遲變化；紅線是介入時間', bodyId: 'qs-lat', body: U.stateBox('loading') }) + '</div>';
	U.mount(h);
	qs_form();
	U.api('latency').then(function (r) { QS.lat = r; qs_lat(); });
	U.poll(function () { return U.api('qos').then(qs_render); }, 5000);
}
/* 控制器（B 階段 E4～E8）做好之後才有 /tw_api.asp?q=qos */
function qs_has_controller() { return QS.r && QS.r.available !== false && !QS.r._error && !QS.r.warming_up; }

function qs_render(r) {
	var U = TW, h;
	QS.r = r;
	var m = qs_nv_mode(), mt = QS_MODES.filter(function (x) { return x.id == m; })[0];
	var plan = (parseInt(NV.down, 10) > 0 && parseInt(NV.up, 10) > 0) ? NV.down + ' / ' + NV.up + ' Mbps' : '尚未設定';
	if (qs_has_controller()) {
		var lim = r.state == 'limiting' || r.state == 'deciding';
		h = U.conclusion({ state: lim ? 'warn' : m != 'off' ? 'ok' : 'off',
			title: m == 'off' ? '頻寬管理關閉' : lim ? '正在控制：' + (r.limit_down_kbps ? '下行限速 ' + U.rateText(r.limit_down_kbps) : '') + (r.limit_up_kbps ? ' 上行限速 ' + U.rateText(r.limit_up_kbps) : '') : '平常：全速，沒有限速',
			sub: '方案 ' + plan + '（模式：' + mt.title + '）' });
		if (r.mode == 'auto') h += '<ol class="tw-steps" aria-label="自動模式目前在哪一步">' + QS_STEPS.map(function (s) { return '<li class="' + (s[0] == r.state ? 'on' : '') + '"' + (s[0] == r.state ? ' aria-current="step"' : '') + '>' + s[1] + '</li>'; }).join('') + '</ol>';
	} else if (m == 'off') {
		h = U.conclusion({ state: 'off', title: '頻寬管理關閉', sub: '流量不經過硬體排程。方案 ' + U.esc(plan) });
	} else {
		/* 誠實：後端目前只會讓流量經過硬體排程，還不會限速 */
		h = U.conclusion({ state: 'warn', title: '已開啟（' + mt.title.replace('（建議）', '') + '），但限速功能尚未提供',
			sub: '目前流量只會經過路由器的硬體排程，<b>不會限速</b>；限速與自動控制會在之後的韌體加入。方案 ' + U.esc(plan) + (NV.wlan == '1' ? '，Wi-Fi 裝置也經過排程' : '，只有有線裝置經過排程') });
	}
	if (!qs_has_controller() && NV.sqm_on == '1') h += '<div class="tw-note tw-s-warn"><b>SQM（軟體 QoS）目前開著</b>，它會關閉硬體 NAT，和這裡的硬體頻寬管理不要同時使用。<a href="Advanced_SQM.asp">SQM 設定</a></div>';
	U.set('qs-state', h);
	if (!qs_has_controller()) U.set('qs-log', U.stateBox('unavailable', '介入紀錄要等限速控制器加入後才有'));
	else U.set('qs-log', U.table({ cols: [{ key: 't', label: '時間', cls: 'tw-cell-main' }, { key: 'w', label: '原因' }, { key: 'a', label: '做了什麼' }, { key: 'l', label: '延遲（前 → 後）' }],
		rows: (r.interventions || []).map(function (x) {
			return { t: '<b class="tw-num">' + U.fmtTime(x.ts) + '</b><span class="tw-dev-sub">持續 ' + U.fmtDur(x.duration_s) + '</span>', w: U.esc(x.reason), a: U.esc(x.action),
				l: '<span class="tw-num">' + x.latency_before_ms + ' → <b style="color:var(--good)">' + x.latency_after_ms + '</b> ms</span>' };
		}), empty: '最近沒有介入：網路很順' }));
	qs_lat();
}

function qs_form() {
	var U = TW, down = parseInt(NV.down, 10) || 0, up = parseInt(NV.up, 10) || 0;
	var h = '<div class="tw-options" role="group" aria-label="模式">' + QS_MODES.map(function (m) {
		return '<button type="button" class="tw-option" id="qs-m-' + m.id + '" aria-pressed="' + (QS.mode == m.id) + '" onclick="qs_pick(\'' + m.id + '\')">' +
			'<span class="tw-option-title">' + U.esc(m.title) + '</span><span class="tw-option-desc">' + U.esc(m.desc) + '</span>' +
			'<span class="tw-option-cost"><span style="color:var(--good)">好處</span> ' + U.esc(m.gain) + '<br><b>代價</b> ' + U.esc(m.cost) + '</span></button>';
	}).join('') + '</div>';
	h += '<div class="tw-note tw-s-warn" id="qs-notyet"' + (QS.mode == 'off' ? ' hidden' : '') + '><b>限速功能尚未提供。</b>選「固定」或「自動」後，流量會開始經過硬體排程，但目前<b>不會限速</b>；先設好方案頻寬，之後的韌體加入限速時就會直接用。</div>';
	h += '<div class="tw-field"><span class="tw-field-label">申裝方案（下載／上傳）</span><div class="tw-inline">' +
		'<select id="qs-plan" onchange="qs_plan()" style="width:auto">' + QS_PLANS.map(function (p) {
			return '<option value="' + p[0] + '/' + p[1] + '"' + (p[0] == down && p[1] == up ? ' selected' : '') + '>' + (p[0] >= 1000 ? p[0] / 1000 + 'G' : p[0] + 'M') + ' / ' + (p[1] >= 1000 ? p[1] / 1000 + 'G' : p[1] + 'M') + '</option>';
		}).join('') + '<option value="custom"' + (QS_PLANS.some(function (p) { return p[0] == down && p[1] == up; }) ? '' : ' selected') + '>自訂</option></select>' +
		'<input type="number" id="qs-down" min="0" max="10000" value="' + (down || '') + '" placeholder="下載" style="width:100px" aria-label="下載 Mbps"> / ' +
		'<input type="number" id="qs-up" min="0" max="10000" value="' + (up || '') + '" placeholder="上傳" style="width:100px" aria-label="上傳 Mbps"> Mbps</div>' +
		'<div class="tw-help">照業者帳單上的方案填；中華電信光世代 500M/250M 就選 500M / 250M。</div></div>';
	/* 進階（折疊） */
	h += '<details class="tw-adv-box"' + (NV.wlan == '0' || NV.method == '1' || NV.tech != 'ftth' || NV.over != '15' || NV.under != '15' ? ' open' : '') + '><summary>進階</summary><div class="tw-adv-body">';
	h += '<div class="tw-field"><label class="tw-switch"><input type="checkbox" id="qs-wlan"' + (NV.wlan != '0' ? ' checked' : '') + '><span class="tw-track"></span>Wi-Fi 裝置也套用頻寬管理</label>' +
		'<div class="tw-help">開啟時，網際網路和 Wi-Fi 裝置之間的流量也會經過硬體排程。<b>如果開了以後 Wi-Fi 變慢或不穩，可以關掉，只管有線裝置</b>（Wi-Fi 裝置之間互傳不受影響）。' +
		'<span id="qs-wlan-off"' + (QS.mode == 'off' ? '' : ' hidden') + '>頻寬管理開啟後才會生效。</span></div></div>';
	h += '<div class="tw-fields"><div class="tw-field"><label for="qs-tech">連線類型（最後一里）</label><select id="qs-tech">' + QS_TECH.map(function (t) {
		return '<option value="' + t[0] + '"' + (t[0] == (NV.tech || 'ftth') ? ' selected' : '') + '>' + t[1] + '</option>';
	}).join('') + '</select><div class="tw-help">自動模式會依連線類型決定怎麼判斷塞車。</div></div>' +
		'<div class="tw-field"><label for="qs-over">自動模式的範圍（方案的 ±%）</label><div class="tw-inline">上限 +<input type="number" id="qs-over" min="0" max="50" value="' + U.esc(NV.over || '15') + '" style="width:70px" aria-label="上限百分比"> %　下限 −' +
		'<input type="number" id="qs-under" min="0" max="80" value="' + U.esc(NV.under || '15') + '" style="width:70px" aria-label="下限百分比"> %</div><div class="tw-help">限速不會超出這個範圍。預設 ±15%。</div></div></div>';
	h += '<div class="tw-field"><label for="qs-method">排程方式</label><select id="qs-method" style="width:auto">' +
		'<option value="0"' + (NV.method != '1' ? ' selected' : '') + '>排程一直開著、只調速率（建議，切換不掉封包）</option>' +
		'<option value="1"' + (NV.method == '1' ? ' selected' : '') + '>需要時才開排程（切換時會清空硬體表，連線會斷一下）</option></select></div>';
	h += '</div></details>';
	h += '<div id="qs-err" class="tw-small" style="color:var(--bad)"></div><div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'qs_apply()' }) + '<span class="tw-cost">套用時防火牆會重新載入、清空硬體轉送表，連線會斷一下（約 2 秒）</span></div>';
	U.set('qs-form', h);
}
function qs_pick(id) {
	QS.mode = id;
	QS_MODES.forEach(function (m) { TW.$('qs-m-' + m.id).setAttribute('aria-pressed', m.id == id ? 'true' : 'false'); });
	TW.$('qs-notyet').hidden = id == 'off';
	TW.$('qs-wlan-off').hidden = id != 'off';
}
function qs_plan() { var v = TW.$('qs-plan').value; if (v == 'custom') return; var p = v.split('/'); TW.$('qs-down').value = p[0]; TW.$('qs-up').value = p[1]; }
function qs_apply() {
	var U = TW, err = U.$('qs-err');
	var d = parseInt(U.$('qs-down').value, 10) || 0, u = parseInt(U.$('qs-up').value, 10) || 0;
	var over = parseInt(U.$('qs-over').value, 10), under = parseInt(U.$('qs-under').value, 10);
	var wlan = U.$('qs-wlan').checked ? '1' : '0', tech = U.$('qs-tech').value, method = U.$('qs-method').value;
	err.textContent = '';
	if (QS.mode != 'off' && !(d > 0 && u > 0)) { err.textContent = '開啟頻寬管理前，請填方案的下載與上傳速度'; return; }
	if (!(over >= 0 && over <= 50) || !(under >= 0 && under <= 80)) { err.textContent = '範圍：上限 0～50%、下限 0～80%'; return; }
	var f = { hw_qos_mode: QS_MODE_NV[QS.mode], hw_qos_down: d, hw_qos_up: u, hw_qos_wlan: wlan, hw_qos_tech: tech, hw_qos_over: over, hw_qos_under: under, hw_qos_method: method };
	var cur = { hw_qos_mode: NV.mode, hw_qos_down: NV.down, hw_qos_up: NV.up, hw_qos_wlan: NV.wlan, hw_qos_tech: NV.tech, hw_qos_over: NV.over, hw_qos_under: NV.under, hw_qos_method: NV.method };
	if (Object.keys(f).every(function (k) { return String(f[k]) == String(cur[k]); })) { U.toast('沒有變更'); return; }
	var m = QS_MODES.filter(function (x) { return x.id == QS.mode; })[0];
	var imp = ['模式：' + m.title + (QS.mode == 'off' ? '' : '（目前只會經過硬體排程，不會限速）'), '方案：' + (d && u ? d + ' / ' + u + ' Mbps' : '未設定'),
		'防火牆重新載入、清空硬體轉送表，所有連線會斷一下（約 2 秒）'];
	if (wlan != NV.wlan) imp.push(wlan == '1' ? 'Wi-Fi 裝置也經過硬體排程' : 'Wi-Fi 裝置不經過硬體排程，只管有線裝置');
	U.apply({ sid: 'IPConnection;', fields: f, title: '套用頻寬管理？', impacts: imp });
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
