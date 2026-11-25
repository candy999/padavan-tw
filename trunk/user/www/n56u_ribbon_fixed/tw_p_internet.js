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
	h += U.card({ id: 'mod', title: 'MOD／IPTV 接法', lead: '中華電信 MOD 機上盒接在這台路由器後面時，指定它用哪個 LAN 孔', body: in_mod_body() });
	h += '<div class="tw-grid-2">' + U.card({ id: 'dns', title: 'DNS', bodyId: 'in-dns', body: U.stateBox('loading') }) + in_more_card() + '</div>';
	U.mount(h);
	in_isp_pick(IN.isp || 'cable', true);
	in_mod_pick(IN.mod, true);
	in_mod_link();
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
	if (r.man_conflict) h += '<div class="tw-note tw-s-warn"><b>數據機給的位址跟家裡區網同一段：</b>數據機發給這台 ' + U.esc(r.man_conflict.ip) + '，區網也是 ' + U.esc(r.man_conflict.lan) + '，所以這個位址沒有套用。' +
		'<br>撥號上網不受影響；受影響的是：從家裡連不到數據機的管理頁；數據機那一側的群播（IGMP 代理）也不會啟動（中華電信 MOD 不受影響，它不經過這裡）。' +
		'<br><b>要解決（擇一）：</b><br>1. <a href="Advanced_LAN_Content.asp">把區網改成別的網段</a>（例如 192.168.2.1，改完裝置要重新連線）<br>2. 用不到數據機時，在<a href="Advanced_WAN_Content.asp">原始 WAN 設定</a>把「PPPoE 與 MAN 存取」設為「否」</div>';
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
	if (r.method == 'wan_ip') h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>依路由器拿到的位址判斷（路由器不另外連到外面查詢對外位址）。</span></div>';
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
		/* J5：中華電信光世代的 IPv6 是 PPPoE＋DHCPv6 取得前綴（ip6_service=dhcp6，padavan-tw 出廠預設就是這樣） */
		h += '<div class="tw-field"><label class="tw-switch"><input type="checkbox" id="in-ip6"' + (NV.ipv6 ? ' checked' : '') + '><span class="tw-track"></span>IPv6</label>' +
			'<div class="tw-help">' + (/hinet/.test(id) ? '中華電信光世代有提供 IPv6（撥號後自動取得前綴），建議開著。' : '業者有提供 IPv6 才有作用。') +
			'業者沒有給可分配的前綴時，區網自動改用 NAT66。細項在 <a href="Advanced_IPv6_Content.asp">原始 IPv6 設定</a>。</div></div>';
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
		if (U.$('in-ip6')) {
			var ip6 = U.$('in-ip6').checked;
			/* 開：沒有設定過就用 dhcp6（光世代）；原本有別的設定（例如 6rd）就保留；關：空字串 */
			f.ip6_service = ip6 ? (NV.ipv6 || 'dhcp6') : '';
		}
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
	/* 沒有任何變更就不要嚇人說「會中斷」（httpd 也不會重啟 WAN） */
	var nvOf = { wan_proto: NV.wan_proto, wan_pppoe_username: NV.pppoe_user, wan_pppoe_mtu: NV.pppoe_mtu, wan_pppoe_mru: NV.pppoe_mru, wan_dnsenable_x: NV.dns_auto,
		wan_ipaddr: NV.wan_ip, wan_netmask: NV.wan_mask, wan_gateway: NV.wan_gw, wan_dns1_x: NV.dns1, wan_dns2_x: NV.dns2, ip6_service: NV.ipv6 };
	if (Object.keys(f).every(function (k) { return k != 'wan_pppoe_passwd' && String(f[k]) == String(nvOf[k] == null ? '' : nvOf[k]); })) { U.toast('沒有變更'); return; }
	if (NV.wan_proto != o.proto) imp.push('連線方式從 ' + ({ pppoe: 'PPPoE', dhcp: '自動取得 IP', static: '固定 IP' }[NV.wan_proto] || NV.wan_proto) + ' 改成 ' + ({ pppoe: 'PPPoE', dhcp: '自動取得 IP', static: '固定 IP' }[o.proto]));
	imp.push('設定錯了不會影響登入後台（區域網路不變），可以再改回來');
	if (f.ip6_service != null && f.ip6_service != NV.ipv6) imp.push(f.ip6_service ? '開啟 IPv6（撥號後自動取得前綴）' : '關閉 IPv6');
	U.apply({ sid: 'Layer3Forwarding;IPConnection;PPPConnection;' + (f.ip6_service != null ? 'IP6Connection;' : ''), fields: f, title: '套用連線方式？', impacts: imp });
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
			rows: r.upstreams.map(function (u) { return { n: U.esc(u.name) + '<span class="tw-dev-sub">' + U.esc(u.addr) + '</span>', s: u.paused ? U.chip('warn', '暫停中') : u.ok ? U.chip('ok', '正常') : U.chip('bad', '失敗'), ms: u.ms == null ? '--' : u.ms + ' ms' }; }) });
	}
	if (r.cert_expiry_ts) {
		var days = Math.round((r.cert_expiry_ts - Date.now() / 1000) / 86400);
		h += '<div class="tw-small ' + (days < 14 ? '' : 'tw-muted') + '"' + (days < 14 ? ' style="color:var(--warn)"' : '') + '>憑證 ' + days + ' 天後到期' + (days < 14 ? '（會自動更新；如果一直沒更新，檢查 Cloudflare Token）' : '') + '</div>';
	}
	if (r.partial && on) h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>' + (r.running ? '黑潮 DNS 的統計暫時讀不到（可能正在重新啟動），稍後重新整理。' : '黑潮 DNS 沒有執行，沒有上游狀態。') + '</span></div>';
	if (r.queries != null) h += '<div class="tw-small tw-muted">今天 ' + U.num(r.queries) + ' 筆查詢、擋下 ' + U.num(r.blocked) + ' 筆、換到台灣 CDN ' + U.num(r.cdn_rewrites) + ' 筆' + (r.chained ? '；跟主路由器的黑潮 DNS 串接中' : '') + '</div>';
	h += '<div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'in_dns_apply()' }) + U.button('黑潮 DNS 完整設定', { small: true, ghost: true, href: 'tw_kuroshio.asp' }) + '</div>';
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
	var V6 = { dhcp6: '原生（自動取得）', static: '原生（固定位址）', '6in4': '6in4 通道', '6to4': '6to4 通道', '6rd': '6rd 通道' };
	var nat66 = NV.nat66_auto != '0', auto = NV.ipv6 == 'dhcp6' && NV.ip6_lan_auto == '1';
	var b = '<dl class="tw-kv"><dt>IPv6</dt><dd>' + (NV.ipv6 ? '開啟（' + U.esc(V6[NV.ipv6] || NV.ipv6) + '）' : '關閉') + ' · <a href="Advanced_IPv6_Content.asp">設定</a></dd>';
	if (auto) {
		b += '<dt>區網 IPv6</dt><dd>' + (NV.nat66_state ? '上一層沒有給可分配的前綴，目前用 NAT66（' + U.esc(NV.nat66_state) + '）' : '使用上一層分配的前綴（或還在等待）') + '</dd></dl>' +
			'<label class="tw-switch"><input type="checkbox" id="in-nat66"' + (nat66 ? ' checked' : '') + '><span class="tw-track"></span>拿不到前綴時自動改用 NAT66</label>' +
			'<div class="tw-help">這台接在另一台路由器後面、上一層只有一段 /64 時，區網裝置拿不到 IPv6；開啟後約 1 分鐘內自動改用 NAT66（區網用 fd 開頭的位址）。' +
			'手機、電腦這時通常仍優先走 IPv4，NAT66 主要讓只有 IPv6 的服務也連得到。拿到真正的前綴後會自動停用。</div>' +
			'<div class="tw-actions">' + U.button('套用', { small: true, onclick: 'in_nat66_apply()' }) + '</div><dl class="tw-kv">';
	}
	b +=
		'<dt>MAC 位址</dt><dd>業者綁定網卡位址時，可以在 <a href="Advanced_WAN_Content.asp">原始 WAN 設定</a> 複製電腦的 MAC</dd></dl>';
	return U.card({ title: 'IPv6 與其他', body: b });
}

/* ---------- MOD／IPTV 接法 ----------
 * 中華電信光世代：上網（PPPoE）和 MOD 走同一條線、不加 VLAN；MOD 機上盒要直接向中華電信取得位址，
 * 所以把一個 LAN 孔在交換器上直接橋接到 WAN（wan_stb_x），並跟區網隔離（wan_stb_iso=1）。華碩的「HiNet MOD」設定檔也是這樣做。
 * 線路要求 VLAN 時（少數 ONU 設定），上網用 vlan_vid_cpu、MOD 孔用 vlan_vid_lanN（送到機上盒不加標籤）。
 * IGMP 代理（mr_enable_x）與 udpxy 是給「群播經過路由器」的其他業者 IPTV；中華電信 MOD 橋接時用不到，但照預設不動。 */
var IN_MOD = [
	{ id: 'none', title: '沒有接 MOD', desc: '機上盒直接接數據機／ONU，或沒有 MOD' },
	{ id: 'hinet', title: '中華電信 MOD（建議）', desc: '機上盒接這台的 LAN 孔，直接向中華電信取得位址' },
	{ id: 'hinet_vlan', title: '中華電信 MOD＋VLAN', desc: '只有客服或 ONU 設定要求 VLAN 時才用' }
];
function in_mod_ports() {
	var n = typeof support_num_ephy == 'function' ? support_num_ephy() - 1 : 4;
	n = Math.max(1, Math.min(4, n || 4));
	var a = []; for (var i = 1; i <= n; i++) a.push(i);
	return a;
}
function in_mod_cur() {
	var stb = parseInt(NV.stb, 10) || 0;
	if (stb >= 5) return 'custom';		/* 原始頁面設了兩個以上的孔 */
	if (!stb) return NV.vlan_on == '1' ? 'vlan_only' : 'none';
	return NV.vlan_on == '1' ? 'hinet_vlan' : 'hinet';
}
function in_mod_body() {
	var U = TW, cur = in_mod_cur();
	IN.mod = cur == 'hinet_vlan' || cur == 'hinet' ? cur : 'none';
	IN.modPort = (parseInt(NV.stb, 10) >= 1 && parseInt(NV.stb, 10) <= 4) ? parseInt(NV.stb, 10) : in_mod_ports().slice(-1)[0];
	var h = '<div id="in-mod-state"></div>';
	if (cur == 'custom') h += '<div class="tw-note tw-s-warn">目前在原始 WAN 設定裡把兩個以上的 LAN 孔橋接給機上盒，這裡無法完整顯示；在這裡套用會改成只用一個孔。</div>';
	if (cur == 'vlan_only') h += '<div class="tw-note tw-s-info">上網目前有設定 VLAN（原始 WAN 設定的「VLAN 過濾」）。選「沒有接 MOD」不會動到它。</div>';
	h += '<label class="tw-switch"><input type="checkbox" id="in-mod-auto"' + (NV.mod_auto != '0' ? ' checked' : '') + ' onchange="in_mod_auto_apply()"><span class="tw-track"></span>自動偵測 MOD 機上盒（建議）</label>' +
		'<div class="tw-help">機上盒插在任何一個 LAN 孔、開機要位址時，路由器會認出它（中華電信機上盒的識別碼）並記住，自動把那個孔設成 MOD 專用，約 1 分鐘內完成，不用知道孔的編號。之後路由器重開、機上盒換孔都會自動跟著；MOD 孔改接其他裝置、機上盒 10 分鐘沒出現在那個孔，會自動取消。</div>' +
		(NV.mod_mac ? '<div class="tw-small tw-muted">記得的機上盒：' + U.esc(NV.mod_mac.split(' ').map(function (m) { return m.replace(/(..)(?!$)/g, '$1:').toUpperCase(); }).join('、')) + '</div>' : '') +
		(NV.mod_auto_last ? '<div class="tw-small tw-muted">上次自動設定：' + U.esc(NV.mod_auto_last) + '</div>' : '');
	h += '<div class="tw-options" role="group" aria-label="MOD 接法">' + IN_MOD.map(function (o) {
		return '<button type="button" class="tw-option" id="in-mod-' + o.id + '" aria-pressed="false" onclick="in_mod_pick(\'' + o.id + '\')">' +
			'<span class="tw-option-title">' + U.esc(o.title) + (o.id == IN.mod && cur != 'custom' ? ' ' + U.chip('info', '目前') : '') + '</span><span class="tw-option-desc">' + U.esc(o.desc) + '</span></button>';
	}).join('') + '</div><div id="in-mod-form"></div>';
	/* 群播：其他業者的 IPTV（中華電信 MOD 用不到） */
	h += '<details style="margin-top:12px"><summary class="tw-small">群播設定（其他業者的 IPTV、在電腦或手機上看群播頻道）</summary>' +
		'<label class="tw-switch" style="margin-top:8px"><input type="checkbox" id="in-mr"' + (NV.mr_on == '1' ? ' checked' : '') + '><span class="tw-track"></span>IGMP 代理（把業者的群播送到區網）</label>' +
		'<div class="tw-field"><label for="in-udpxy">udpxy 連接埠（群播轉成 HTTP，給手機或電腦播放器用；0 = 關閉）</label><input type="number" id="in-udpxy" min="0" max="65535" style="width:120px" value="' + U.esc(NV.udpxy || '0') + '"></div>' +
		'<div class="tw-help">中華電信 MOD 用上面的「接 LAN 孔」就好，不需要這兩項。</div>' +
		'<div class="tw-actions">' + U.button('套用群播設定', { small: true, onclick: 'in_mr_apply()' }) + U.button('原始 IPTV 設定', { small: true, ghost: true, href: 'Advanced_IPTV_Content.asp' }) + '</div></details>';
	return h;
}
function in_mod_pick(id, init) {
	var U = TW;
	IN.modPick = id;
	IN_MOD.forEach(function (x) { var b = U.$('in-mod-' + x.id); if (b) b.setAttribute('aria-pressed', x.id == id ? 'true' : 'false'); });
	var h = '';
	if (id != 'none') {
		h += '<div class="tw-field"><label>機上盒接哪個 LAN 孔</label><div class="tw-seg" role="group" aria-label="LAN 孔">' + in_mod_ports().map(function (p) {
			return '<button type="button" id="in-mod-p' + p + '" aria-pressed="' + (p == IN.modPort) + '" onclick="in_mod_port(' + p + ')">LAN' + p + '</button>';
		}).join('') + '</div><div class="tw-help">這個孔會變成 MOD 專用：插在這裡的裝置直接向中華電信要位址，<b>不能再接電腦或交換器</b>（拿不到這台路由器的網路）。其他 LAN 孔與 Wi-Fi 照常。</div></div>';
	}
	if (id == 'hinet_vlan') {
		var vp = NV['vlan_lan' + IN.modPort] || '';
		h += '<div class="tw-fields"><div class="tw-field"><label for="in-vmod">MOD 的 VLAN ID</label><input type="number" id="in-vmod" min="2" max="4094" style="width:120px" value="' + U.esc(vp) + '"><div class="tw-help">送到機上盒時會拿掉標籤。</div></div>' +
			'<div class="tw-field"><label for="in-vnet">上網的 VLAN ID（選填）</label><input type="number" id="in-vnet" min="2" max="4094" style="width:120px" value="' + U.esc(NV.vlan_on == '1' ? NV.vlan_cpu : '') + '"><div class="tw-help">空白 = 上網不加 VLAN 標籤。</div></div></div>' +
			'<div class="tw-note tw-s-warn">一般光世代<b>不需要</b> VLAN。數值要向中華電信客服確認，填錯 MOD 和上網都可能不通（可以再改回「中華電信 MOD（建議）」）。</div>';
	}
	h += '<div id="in-mod-err" class="tw-small" style="color:var(--bad)"></div><div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'in_mod_apply()' }) +
		'<span class="tw-cost">' + (id == 'hinet_vlan' || in_mod_cur() == 'hinet_vlan' ? '有線網路中斷約 5～10 秒，網際網路重新連線約 15～30 秒' : '有線網路中斷約 5～10 秒') + '</span></div>';
	U.set('in-mod-form', h);
}
function in_mod_port(p) {
	var U = TW;
	IN.modPort = p;
	in_mod_ports().forEach(function (x) { var b = U.$('in-mod-p' + x); if (b) b.setAttribute('aria-pressed', x == p ? 'true' : 'false'); });
	var v = U.$('in-vmod'); if (v && !v.value) v.value = NV['vlan_lan' + p] || '';
}
/* MOD 孔的連線狀態：用現有的 status_lanlink.asp（ether_link_status(idx)，idx 0 = WAN、1～ = LAN） */
function in_mod_link() {
	var U = TW, stb = parseInt(NV.stb, 10) || 0, el = U.$('in-mod-state');
	if (!el) return;
	var cur = in_mod_cur();
	if (cur == 'none' || cur == 'vlan_only') { el.innerHTML = U.conclusion({ state: 'off', title: '沒有指定 MOD 孔', sub: '所有 LAN 孔都是一般的區網' }); return; }
	if (stb >= 5) { el.innerHTML = U.conclusion({ state: 'info', title: '原始設定：多個 LAN 孔橋接給機上盒', sub: '' }); return; }
	fetch('/status_lanlink.asp', { cache: 'no-store', credentials: 'same-origin' }).then(function (x) { return x.text(); }).then(function (t) {
		var m = new RegExp('if\\(idx==' + stb + '\\) return \'([^\']*)\'').exec(t), s = m ? m[1] : '';
		var up = s && !/no link/i.test(s);
		el.innerHTML = U.conclusion({ state: up ? 'ok' : 'warn', title: 'LAN' + stb + ' 是 MOD 專用孔' + (cur == 'hinet_vlan' ? '（VLAN ' + U.esc(NV['vlan_lan' + stb] || '-') + '）' : ''),
			sub: up ? '機上盒有接上（' + U.esc(s) + '）' : '這個孔現在沒有接東西：機上盒的網路線要插在 LAN' + stb });
	}, function () { el.innerHTML = U.conclusion({ state: 'info', title: 'LAN' + stb + ' 是 MOD 專用孔', sub: '讀不到連接埠狀態' }); });
}
function in_mod_apply() {
	var U = TW, id = IN.modPick, p = IN.modPort, err = U.$('in-mod-err'), f = {}, imp = [];
	err.textContent = '';
	if (id == 'none') {
		f.wan_stb_x = '0';
		if (in_mod_cur() == 'hinet_vlan') f.vlan_filter = '0';	/* 只關掉這裡設的；上網自己的 VLAN（vlan_only）不動 */
		f.tw_mod_mac = '';	/* 忘記記得的機上盒：不然自動偵測看到它又會把孔設回來 */
		imp.push('所有 LAN 孔恢復成一般區網，有線網路中斷約 5～10 秒');
		if (NV.mod_mac) imp.push('路由器會忘記記得的機上盒，不會再自動設回 MOD 孔（機上盒重開要位址時才會再認出它）');
	} else {
		f.wan_stb_x = String(p); f.wan_stb_iso = '1';
		f['vlan_tag_lan' + p] = '0'; f['vlan_pri_lan' + p] = '0';
		if (id == 'hinet_vlan') {
			var vm = parseInt(U.$('in-vmod').value, 10), vnRaw = U.$('in-vnet').value.trim(), vn = parseInt(vnRaw, 10);
			if (!(vm >= 2 && vm <= 4094)) { err.textContent = 'MOD 的 VLAN ID 要在 2～4094 之間'; U.$('in-vmod').focus(); return; }
			if (vnRaw && !(vn >= 2 && vn <= 4094)) { err.textContent = '上網的 VLAN ID 要在 2～4094 之間，或留空'; U.$('in-vnet').focus(); return; }
			if (vnRaw && vn == vm) { err.textContent = '上網和 MOD 的 VLAN ID 不能一樣'; return; }
			f.vlan_filter = '1'; f.vlan_vid_cpu = vnRaw ? String(vn) : ''; f.vlan_pri_cpu = '0'; f['vlan_vid_lan' + p] = String(vm);
			imp.push('上網' + (vnRaw ? '改用 VLAN ' + vn : '不加 VLAN') + '、LAN' + p + ' 的 MOD 走 VLAN ' + vm + '，網際網路重新連線約 15～30 秒');
		} else {
			if (in_mod_cur() == 'hinet_vlan') f.vlan_filter = '0';
			f['vlan_vid_lan' + p] = '';
		}
		imp.push('LAN' + p + ' 變成 MOD 專用，接在那裡的電腦會斷線（改插其他孔或用 Wi-Fi）');
		imp.push('有線網路中斷約 5～10 秒，Wi-Fi 不受影響');
	}
	var same = Object.keys(f).every(function (k) {
		var nv = { wan_stb_x: NV.stb, wan_stb_iso: NV.stb_iso, vlan_filter: NV.vlan_on, vlan_vid_cpu: NV.vlan_cpu }[k];
		if (/^vlan_vid_lan/.test(k)) nv = NV[k.replace('vlan_vid_', 'vlan_')];
		if (/^vlan_(tag|pri)_lan/.test(k)) return true;
		return String(nv == null ? '' : nv) == String(f[k]);
	});
	if (same) { U.toast('沒有變更'); return; }
	U.apply({ sid: 'Layer3Forwarding;', fields: f, title: id == 'none' ? '取消 MOD 專用孔？' : '把 LAN' + p + ' 設成 MOD 專用？', impacts: imp });
}
function in_mod_auto_apply() {
	var U = TW, on = U.$('in-mod-auto').checked ? '1' : '0';
	U.apply({ sid: 'Layer3Forwarding;', fields: { tw_mod_auto: on }, title: on == '1' ? '開啟 MOD 自動偵測？' : '關閉 MOD 自動偵測？',
		impacts: on == '1' ? ['不會中斷網路；之後偵測到中華電信機上盒時，它接的孔會自動變成 MOD 專用（有線網路中斷約 5～10 秒）'] : ['不會中斷網路；已經設好的 MOD 專用孔不變'] })
		.then(function (ok) { if (!ok) U.$('in-mod-auto').checked = !U.$('in-mod-auto').checked; });
}
function in_mr_apply() {
	var U = TW, mr = U.$('in-mr').checked ? '1' : '0', ux = parseInt(U.$('in-udpxy').value, 10) || 0;
	if (ux && (ux < 1024 || ux > 65535)) { TW.toast('udpxy 連接埠要在 1024～65535 之間，或填 0 關閉', 'bad'); return; }
	if (mr == NV.mr_on && String(ux) == String(parseInt(NV.udpxy, 10) || 0)) { U.toast('沒有變更'); return; }
	U.apply({ sid: 'RouterConfig;LANHostConfig;', fields: { mr_enable_x: mr, udpxy_enable_x: String(ux) }, title: '套用群播設定？',
		impacts: ['群播服務重新啟動約 3 秒，正在看的群播頻道會停頓一下', mr == '1' ? 'IGMP 代理把業者的群播轉到區網' : 'IGMP 代理關閉：區網的裝置收不到業者的群播（中華電信 MOD 用專用孔，不受影響）'] });
}
function in_nat66_apply() {
	var U = TW, v = U.$('in-nat66').checked ? '1' : '0';
	if (v == (NV.nat66_auto == '0' ? '0' : '1')) { U.toast('沒有變更'); return; }
	U.apply({ sid: 'IP6Connection;', fields: { ip6_nat66_auto: v }, title: v == '1' ? '開啟自動 NAT66？' : '關閉自動 NAT66？',
		impacts: v == '1' ? ['拿不到前綴時，約 1 分鐘內區網裝置會拿到 fd 開頭的 IPv6 位址', '不影響 IPv4'] : ['如果目前正在用 NAT66，區網裝置的 IPv6 會在約 10 秒內停止', '不影響 IPv4'] });
}
