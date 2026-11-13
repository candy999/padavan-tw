/* padavan-tw 網際網路：連線方式對不對？（docs/HANDOFF-UI.md 5.5） */
var IN = { isp: null };
var IN_ISP = [
	{ id: 'hinet', proto: 'pppoe', title: '中華電信光世代', desc: 'PPPoE 撥號，帳號像 87654321@hinet.net' },
	{ id: 'hinet_ip', proto: 'pppoe', title: '中華電信固定 IP', desc: 'PPPoE 撥號，帳號像 87654321@ip.hinet.net' },
	{ id: 'cable', proto: 'dhcp', title: '有線電視寬頻', desc: '凱擘、台灣大寬頻、中嘉、台固…自動取得 IP' },
	{ id: 'modem', proto: 'dhcp', title: '接在別人的路由器後面', desc: '數據機已經撥號、公司或社區網路' },
	{ id: 'static', proto: 'static', title: '固定 IP（業者給位址）', desc: '要填 IP、遮罩、閘道、DNS' },
	{ id: 'other', proto: 'dhcp', title: '其他業者（自動取得 IP）', desc: '遠傳、亞太、學術網路等' }
];

function page_init() {
	var U = TW;
	IN.isp = NV.wan_proto == 'pppoe' ? (/@ip\.hinet\.net$/i.test(NV.pppoe_user) ? 'hinet_ip' : 'hinet') : (NV.wan_proto == 'static' ? 'static' : (NV.wan_proto == 'dhcp' ? 'cable' : null));
	var h = U.pageHead({ title: '網際網路', sub: '<span id="in-sub">讀取中…</span>', actions: U.button('重新連線', { icon: 'restart', onclick: 'TW.wanReconnect()' }) + U.button('原始 WAN 設定', { href: 'Advanced_WAN_Content.asp', icon: 'sliders' }) });
	if (NV.sw_mode == '3') h += '<div class="tw-note tw-s-warn"><b>這台路由器目前是 AP 模式</b>，網際網路由前面的路由器負責，這頁的設定不會生效。</div>';
	h += '<section class="tw-card" id="in-status">' + U.stateBox('loading') + '</section>';
	h += U.card({ id: 'cgnat', title: '外面連得進來嗎？', bodyId: 'in-cgnat', body: U.stateBox('loading') });
	h += U.card({ id: 'isp', title: '連線方式', lead: '選你的業者，只會顯示需要填的欄位', body: in_isp_body() });
	h += '<div class="tw-grid-2">' + U.card({ id: 'dns', title: 'DNS', bodyId: 'in-dns', body: U.stateBox('loading') }) + in_more_card() + '</div>';
	U.mount(h);
	in_isp_pick(IN.isp || 'cable', true);
	U.api('cgnat').then(in_cgnat);
	U.poll(function () { return Promise.all([U.api('wan').then(in_status), U.api('dns').then(in_dns)]); }, 10000);
	if (location.hash) { var t = U.$(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView(); }, 50); }
}

/* ---------- 連線狀態（白話） ---------- */
function in_status(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('in-status', g); return; }
	var t, st, sub = [];
	if (r.connected) {
		st = r.internet == 'bad' ? 'warn' : 'ok';
		t = '已連線 ' + U.fmtDur(r.uptime_s) + (r.ip4 ? (U.isPrivateIp(r.ip4) || U.isCgnatIp(r.ip4) ? '，拿到的位址是 ' + r.ip4 : '，公網 IP ' + r.ip4) : '');
		if (r.internet == 'bad') t = '已連上業者，但連不到外面';
	} else {
		st = 'bad';
		t = '網際網路沒有連線';
	}
	if (r.proto_label) sub.push((r.isp ? r.isp + ' ' : '') + r.proto_label);
	if (r.ether) sub.push('網路線 ' + r.ether);
	if (r.gw4) sub.push('閘道 ' + r.gw4);
	if (r.dns && r.dns.length) sub.push('業者 DNS ' + r.dns.join('、'));
	var h = U.conclusion({ state: st, title: t, sub: U.esc(sub.join(' · ')) });
	if (!r.connected && r.last_error) h += '<div class="tw-note tw-s-bad"><b>原因：</b>' + U.esc(r.last_error) + '<br>檢查下面的帳號密碼；如果剛改過，按「重新連線」。</div>';
	else if (!r.connected) h += '<div class="tw-note tw-s-bad">先確認網路線接在路由器的 WAN 孔、數據機燈號正常；PPPoE 請檢查帳號密碼。</div>';
	if (r.ip6) h += '<div class="tw-small tw-muted">IPv6：' + U.esc(r.ip6) + '</div>';
	U.set('in-status', h);
	var s = U.$('in-sub'); if (s) s.textContent = r.connected ? (r.proto_label || '') + ' 已連線 ' + U.fmtDur(r.uptime_s) : '沒有連線';
}

/* ---------- CGNAT ---------- */
function in_cgnat(r) {
	var U = TW, g = U.guard(r);
	if (g) { U.set('in-cgnat', g); return; }
	var h;
	if (r.cgnat === null) h = U.conclusion({ state: 'unknown', title: '還無法判斷', sub: U.esc(r.reason || '') });
	else if (!r.cgnat) h = U.conclusion({ state: 'ok', title: '可以：你有公網 IP', sub: U.esc(r.reason) + '。連接埠轉送與 WireGuard 都能用。' });
	else if (r.kind == 'double_nat') {
		h = U.conclusion({ state: 'warn', title: '可能不行：前面還有一台路由器', sub: U.esc(r.reason) });
		h += '<div class="tw-note tw-s-warn"><b>怎麼辦（擇一）：</b><br>1. 把業者的數據機改成「橋接模式」，由這台撥號（中華電信可打 0800-080-123 請客服改）<br>' +
			'2. 在前面那台路由器設定 DMZ 指到這台（' + U.esc(r.wan_ip) + '）<br>3. 如果是業者共用 IP（CGNAT），要向業者申請公網 IP</div>';
	} else {
		h = U.conclusion({ state: 'bad', title: '不行：業者沒有給你公網 IP（CGNAT）', sub: U.esc(r.reason) });
		h += '<div class="tw-note tw-s-bad">外面的人連不到你家：<b>連接埠轉送、WireGuard 從外面連回家都不會通</b>。要向業者申請「公網 IP」（中華電信動態 IP 本來就是公網；有線電視業者常需要另外申請）。</div>';
	}
	if (r.public_ip && r.public_ip != r.wan_ip) h += '<div class="tw-small tw-muted">對外看到的位址：' + U.esc(r.public_ip) + '</div>';
	if (r.method == 'wan_ip') h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>依路由器拿到的位址判斷；更準確的檢查（比對對外位址）需要更新韌體後才有。</span></div>';
	U.set('in-cgnat', h);
}

/* ---------- 業者精靈 ---------- */
function in_isp_body() {
	var U = TW;
	return '<div class="tw-options" role="group" aria-label="業者">' + IN_ISP.map(function (o) {
		return '<button type="button" class="tw-option" id="in-isp-' + o.id + '" aria-pressed="false" onclick="in_isp_pick(\'' + o.id + '\')">' +
			'<span class="tw-option-title">' + U.esc(o.title) + (o.id == IN.isp ? ' ' + U.chip('info', '目前') : '') + '</span><span class="tw-option-desc">' + U.esc(o.desc) + '</span></button>';
	}).join('') + '</div><div id="in-isp-form"></div>';
}
function in_isp_pick(id, init) {
	var U = TW, o = IN_ISP.filter(function (x) { return x.id == id; })[0];
	IN.pick = o;
	IN_ISP.forEach(function (x) { var b = U.$('in-isp-' + x.id); if (b) b.setAttribute('aria-pressed', x.id == id ? 'true' : 'false'); });
	var same = NV.wan_proto == o.proto, h = '';
	if (o.proto == 'pppoe') {
		h += '<div class="tw-fields"><div class="tw-field"><label for="in-user">PPPoE 帳號</label><input type="text" id="in-user" maxlength="64" autocomplete="off" value="' + U.esc(same ? NV.pppoe_user : '') + '" placeholder="' + (id == 'hinet_ip' ? '87654321@ip.hinet.net' : '87654321@hinet.net') + '">' +
			'<div class="tw-help">在業者給的「用戶帳號密碼單」上；中華電信要加 @hinet.net' + (id == 'hinet_ip' ? '（固定 IP 是 @ip.hinet.net）' : '') + '。</div></div>' +
			'<div class="tw-field"><label for="in-pass">PPPoE 密碼</label><div class="tw-pwd"><input type="password" id="in-pass" maxlength="64" autocomplete="new-password" placeholder="' + (same ? '（不變）' : '') + '">' +
			'<button type="button" class="tw-btn tw-btn-sm" onclick="wf_peek_in(\'in-pass\', this)">顯示</button></div>' + (same ? '<div class="tw-help">留空就是沿用目前的密碼。</div>' : '') + '</div></div>';
		h += '<div class="tw-field"><label for="in-mtu">MTU（每個封包的最大大小）</label><div class="tw-inline"><input type="number" id="in-mtu" min="1280" max="1492" style="width:120px" value="' + U.esc(NV.pppoe_mtu || '1480') + '">' +
			'<button type="button" class="tw-btn tw-btn-sm" id="in-mtu-btn" onclick="in_mtu_detect()">自動偵測</button></div>' +
			'<div class="tw-help" id="in-mtu-res">中華電信光世代建議 1480（PPPoE 理論上限 1492）；部分網站打不開、IPv6 時好時壞時，按「自動偵測」找出最適合的值（約 20 秒，要已經連線）。</div></div>';
	} else if (o.proto == 'static') {
		h += '<div class="tw-fields">' + [['in-ip', 'IP 位址', 'wan_ip'], ['in-mask', '子網路遮罩', 'wan_mask'], ['in-gw', '預設閘道', 'wan_gw'], ['in-dns1', 'DNS 伺服器 1', 'dns1'], ['in-dns2', 'DNS 伺服器 2（選填）', 'dns2']].map(function (f) {
			return '<div class="tw-field"><label for="' + f[0] + '">' + f[1] + '</label><input type="text" id="' + f[0] + '" maxlength="15" value="' + U.esc(same ? NV[f[2]] : '') + '"></div>';
		}).join('') + '</div><div class="tw-help">照業者給的資料填寫。</div>';
	} else {
		h += '<div class="tw-small">不用填任何東西：路由器會自動向' + (id == 'modem' ? '前面的路由器' : '業者') + '取得位址。</div>';
		if (id == 'modem') h += '<div class="tw-note tw-s-warn">接在別人的路由器後面是「雙層 NAT」：上網沒問題，但從外面連回家（WireGuard、連接埠轉送）要另外在前面那台設定。可以的話，請把前面的數據機改成橋接模式。</div>';
	}
	var cur = same && (o.proto != 'pppoe' || (id == 'hinet_ip') == /@ip\.hinet\.net$/i.test(NV.pppoe_user));
	h += '<div id="in-isp-err" class="tw-small" style="color:var(--bad)"></div><div class="tw-actions">' + U.button(cur ? '套用變更' : '改用這個連線方式', { primary: true, onclick: 'in_isp_apply()' }) +
		'<span class="tw-cost">網際網路會中斷約 15～30 秒</span></div>';
	U.set('in-isp-form', h);
}
function wf_peek_in(id, btn) { var i = TW.$(id); i.type = i.type == 'password' ? 'text' : 'password'; btn.textContent = i.type == 'password' ? '顯示' : '隱藏'; }
function in_ipok(s) { return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s); }
function in_isp_apply() {
	var U = TW, o = IN.pick, err = U.$('in-isp-err'), f = { wan_proto: o.proto }, imp = ['網際網路中斷約 15～30 秒，所有裝置都會斷一下'];
	err.textContent = '';
	if (o.proto == 'pppoe') {
		var user = U.$('in-user').value.trim(), pass = U.$('in-pass').value, mtu = parseInt(U.$('in-mtu').value, 10);
		if (!user) { err.textContent = '請輸入 PPPoE 帳號'; return; }
		if (/hinet/.test(o.id) && user.indexOf('@') < 0) { err.textContent = '中華電信的帳號要加 @hinet.net（例如 87654321@hinet.net）'; return; }
		if (!pass && NV.wan_proto != 'pppoe') { err.textContent = '請輸入 PPPoE 密碼'; return; }
		if (!(mtu >= 1280 && mtu <= 1492)) { err.textContent = 'MTU 要在 1280～1492 之間'; return; }
		f.wan_pppoe_username = user;
		if (pass) f.wan_pppoe_passwd = pass;
		f.wan_pppoe_mtu = mtu; f.wan_pppoe_mru = mtu;
		f.wan_dnsenable_x = '1';
	} else if (o.proto == 'static') {
		var v = {}, bad = null;
		[['in-ip', 'wan_ipaddr', 1], ['in-mask', 'wan_netmask', 1], ['in-gw', 'wan_gateway', 1], ['in-dns1', 'wan_dns1_x', 1], ['in-dns2', 'wan_dns2_x', 0]].forEach(function (x) {
			var s = U.$(x[0]).value.trim();
			if ((x[2] || s) && !in_ipok(s)) bad = bad || x[0];
			v[x[1]] = s;
		});
		if (bad) { err.textContent = '請檢查位址格式（例如 1.2.3.4）'; U.$(bad).focus(); return; }
		Object.keys(v).forEach(function (k) { f[k] = v[k]; });
		f.wan_dnsenable_x = '0';
	} else {
		f.wan_dnsenable_x = '1';
	}
	if (NV.wan_proto != o.proto) imp.push('連線方式從 ' + ({ pppoe: 'PPPoE', dhcp: '自動取得 IP', static: '固定 IP' }[NV.wan_proto] || NV.wan_proto) + ' 改成 ' + ({ pppoe: 'PPPoE', dhcp: '自動取得 IP', static: '固定 IP' }[o.proto]));
	imp.push('設定錯了不會影響登入後台（區域網路不變），可以再改回來');
	U.apply({ sid: 'Layer3Forwarding;IPConnection;PPPConnection;', fields: f, title: '套用連線方式？', impacts: imp });
}
function in_mtu_detect() {
	var U = TW, b = U.$('in-mtu-btn'), r = U.$('in-mtu-res');
	if (typeof login_safe == 'function' && !login_safe()) { U.toast('只能在區域網路登入時使用', 'bad'); return; }
	U.dialog({ title: '自動偵測 MTU？', ok: '開始偵測', impacts: ['約 10～20 秒，期間網路可能短暫不穩', 'PPPoE 要已經連線'] }).then(function (yes) {
		if (!yes) return;
		b.disabled = true; r.textContent = '偵測中，請稍候…';
		var body = 'action_mode=+SystemCmd+&current_page=console_response.asp&next_page=console_response.asp&SystemCmd=tw-mtu-probe';
		fetch('/apply.cgi', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
			.then(function () { return fetch('/console_response.asp', { cache: 'no-store', credentials: 'same-origin' }); })
			.then(function (x) { return x.text(); })
			.then(function (t) {
				var m = /MTU=(\d+)/.exec(t), v = m ? parseInt(m[1], 10) : 0;
				b.disabled = false;
				if (v >= 1280 && v <= 1492) { U.$('in-mtu').value = v; r.innerHTML = '<b>測得 ' + v + '</b>，已填入，按「套用」才會生效。'; }
				else r.textContent = '測不出結果，維持原本的設定。';
			}, function () { b.disabled = false; r.textContent = '偵測失敗（登入逾時？），請重新整理再試。'; });
	});
}

/* ---------- DNS（黑潮 DNS 的白話設定） ---------- */
function in_dns(r) {
	var U = TW;
	if (r && r.available === false) { U.set('in-dns', U.stateBox('unavailable', '這個韌體沒有黑潮 DNS，使用業者的 DNS')); return; }
	var g = U.guard(r);
	if (g) { U.set('in-dns', g); return; }
	var on = NV.kuro_on == '1';
	var st = !on ? 'off' : (r.healthy ? 'ok' : (r.running ? 'warn' : 'bad'));
	var h = '<div class="tw-inline">' + U.dot(st) + '<b>' + (!on ? '使用業者的 DNS' : r.healthy ? '黑潮 DNS 運作中' : r.running ? '黑潮 DNS 暫時改用業者 DNS' : '黑潮 DNS 沒有執行') + '</b></div>';
	h += '<label class="tw-switch"><input type="checkbox" id="in-kuro"' + (on ? ' checked' : '') + '><span class="tw-track"></span>使用黑潮 DNS</label>';
	h += '<ul class="tw-small" style="margin:-6px 0 0;padding-left:18px">' +
		'<li>擋廣告與追蹤：' + (r.filter_ads == null ? (on ? '內建' : '--') : r.filter_ads ? '開啟' : '關閉') + '</li>' +
		'<li>影音、更新換到台灣 CDN 節點：' + (r.cdn_tw == null ? (on ? '內建' : '--') : r.cdn_tw ? '開啟' : '關閉') + '</li>' +
		'<li>加密 DNS（DoT／DoH）給手機用：' + (NV.kuro_dot == '1' || NV.kuro_doh == '1' ? '開啟' + (NV.kuro_domain ? '（' + U.esc(NV.kuro_domain) + '）' : '') : '關閉（要先設定網域）') + '</li></ul>';
	if (r.upstreams) {
		h += U.table({ cols: [{ key: 'n', label: '上游', cls: 'tw-cell-main' }, { key: 's', label: '狀態' }, { key: 'ms', label: '回應' }],
			rows: r.upstreams.map(function (u) { return { n: U.esc(u.name) + '<span class="tw-dev-sub">' + U.esc(u.addr) + '</span>', s: u.ok ? U.chip('ok', '正常') : U.chip('bad', '逾時'), ms: u.ms == null ? '--' : u.ms + ' ms' }; }) });
	}
	if (r.cert_expiry_ts) {
		var days = Math.round((r.cert_expiry_ts - Date.now() / 1000) / 86400);
		h += '<div class="tw-small ' + (days < 14 ? '' : 'tw-muted') + '"' + (days < 14 ? ' style="color:var(--warn)"' : '') + '>憑證 ' + days + ' 天後到期' + (days < 14 ? '（會自動更新；如果一直沒更新，檢查 Cloudflare Token）' : '') + '</div>';
	}
	if (r.partial) h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>查詢數、擋下數、上游狀態需要更新韌體後才有。</span></div>';
	h += '<div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'in_dns_apply()' }) + U.button('完整設定（網域、DDNS、加密 DNS）', { small: true, ghost: true, href: 'Advanced_kuroshio.asp' }) + '</div>';
	U.set('in-dns', h);
}
function in_dns_apply() {
	var U = TW, on = U.$('in-kuro').checked ? '1' : '0';
	if (on == NV.kuro_on) { U.toast('沒有變更'); return; }
	U.apply({ sid: 'KuroshioConf;', fields: { kuroshio_enable: on }, title: on == '1' ? '改用黑潮 DNS？' : '改回業者的 DNS？',
		impacts: ['DNS 服務重新啟動約 3 秒，期間網頁可能打不開', '裝置會在下次查詢時自動改用'] });
}

/* ---------- IPv6、MOD ---------- */
function in_more_card() {
	var U = TW;
	var b = '<dl class="tw-kv"><dt>IPv6</dt><dd>' + (NV.ipv6 ? '開啟（' + U.esc(NV.ipv6) + '）' : '關閉') + ' · <a href="Advanced_IPv6_Content.asp">設定</a></dd>' +
		'<dt>MOD</dt><dd>中華電信 MOD 機上盒接在指定的 LAN 孔，並設定 IPTV 連接埠 · <a href="Advanced_IPTV_Content.asp">MOD／IPTV 設定</a></dd>' +
		'<dt>MAC 位址</dt><dd>業者綁定網卡位址時，可以在 <a href="Advanced_WAN_Content.asp">原始 WAN 設定</a> 複製電腦的 MAC</dd></dl>';
	return U.card({ title: 'IPv6 與 MOD', body: b });
}
