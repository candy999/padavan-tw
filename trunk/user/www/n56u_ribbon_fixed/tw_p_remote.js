/* padavan-tw 遠端與分享：外出怎麼連回家？外面怎麼連進來？（docs/HANDOFF-UI.md 5.5） */
var RM = { cgnat: null, devices: [], purpose: null };
var RM_PURPOSE = [
	{ id: 'ps', title: 'PlayStation', ports: '3478:3480', proto: 'BOTH', desc: 'PS5／PS4 線上對戰（NAT 類型 2）' },
	{ id: 'xbox', title: 'Xbox', ports: '3074', proto: 'BOTH', desc: 'Xbox Live 開放式 NAT' },
	{ id: 'switch', title: 'Nintendo Switch', ports: '45000:65535', proto: 'UDP', desc: '任天堂建議的 UDP 範圍' },
	{ id: 'nas', title: 'NAS 遠端存取', ports: '5001', proto: 'TCP', desc: 'Synology DSM HTTPS（QNAP 常用 8081）' },
	{ id: 'cam', title: '監視器／NVR', ports: '8000', proto: 'TCP', desc: '依機型而定，常見 8000、37777、554' },
	{ id: 'custom', title: '自訂', ports: '', proto: 'TCP', desc: '自己填連接埠' }
];

function page_init() {
	var U = TW;
	var h = U.pageHead({ title: '遠端與分享', sub: '外出連回家（VPN）、讓外面連到家裡的裝置（連接埠轉送）' });
	h += '<div id="rm-cgnat"></div>';
	h += U.card({ id: 'vpn', title: '外出連回家（WireGuard）', bodyId: 'rm-vpn', body: U.stateBox('loading'), extra: '<a href="Advanced_wireguard.asp">完整設定</a>' });
	h += U.card({ id: 'portfwd', title: '讓外面連到家裡的裝置', bodyId: 'rm-pf', body: U.stateBox('loading'), extra: '<a href="Advanced_VirtualServer_Content.asp">完整清單</a>' });
	h += '<div class="tw-grid-2">' + U.card({ id: 'upnp', title: 'UPnP（自動開連接埠）', body: rm_upnp() }) +
		U.card({ id: 'domain', title: '網域與憑證', bodyId: 'rm-domain', body: U.stateBox('loading') }) + '</div>';
	U.mount(h);
	Promise.all([U.api('cgnat'), U.api('devices')]).then(function (a) {
		RM.cgnat = a[0]; RM.devices = (a[1].devices || []).filter(function (d) { return d.ip && d.conn != 'guest'; });
		rm_cgnat_note(); rm_pf_render();
	});
	U.api('dns').then(rm_domain);
	U.poll(function () { return U.api('vpn').then(rm_vpn); }, 10000);
}
function rm_cgnat_note() {
	var U = TW, c = RM.cgnat;
	if (!c || !c.cgnat) { U.set('rm-cgnat', ''); return; }
	U.set('rm-cgnat', '<div class="tw-note tw-s-' + (c.kind == 'double_nat' ? 'warn' : 'bad') + '"><b>' + (c.kind == 'double_nat' ? '前面還有一台路由器（雙層 NAT）' : '業者沒有給公網 IP（CGNAT）') +
		'：</b>從外面連回家（WireGuard、連接埠轉送）' + (c.kind == 'double_nat' ? '要先在前面那台設定 DMZ 或改成橋接模式' : '不會通，要向業者申請公網 IP') + '。<a href="tw_internet.asp#cgnat">看說明</a></div>');
}
function rm_endpoint() {
	if (NV.wgs_host) return NV.wgs_host;
	if (NV.kuro_on == '1' && NV.kuro_ddns == '1' && NV.kuro_domain) return NV.kuro_domain;
	if (NV.ddns_on == '1' && NV.ddns_host) return NV.ddns_host;
	return NV.wan_ip && NV.wan_ip != '0.0.0.0' ? NV.wan_ip : '';
}

/* ---------- WireGuard ---------- */
function rm_vpn(r) {
	var U = TW, on = NV.wgs_on == '1', h = '';
	if (typeof found_app_wireguard == 'function' && !found_app_wireguard()) { U.set('rm-vpn', U.stateBox('unavailable', '這個韌體沒有 WireGuard')); return; }
	h += '<div class="tw-inline">' + U.dot(on ? 'ok' : 'off') + '<b>' + (on ? 'VPN 伺服器開啟中' : 'VPN 伺服器關閉') + '</b>' +
		(on ? '<span class="tw-small tw-muted">連線位址 ' + U.esc(rm_endpoint() || '（未設定）') + ':' + U.esc(NV.wgs_port || '51820') + '</span>' : '') + '</div>';
	if (!on) {
		h += '<p class="tw-small">開啟後，手機、筆電在外面也能連回家裡的 NAS、攝影機，或透過家裡的網路上網。</p>';
		h += '<div class="tw-actions">' + U.button('開啟 VPN 伺服器', { primary: true, onclick: 'rm_vpn_enable()' }) + '<span class="tw-cost">防火牆重新載入約 2 秒</span></div>';
		U.set('rm-vpn', h);
		return;
	}
	var ep = rm_endpoint();
	if (ep && !NV.wgs_host && ep == NV.wan_ip) h += '<div class="tw-note tw-s-warn">用的是目前的 IP（' + U.esc(ep) + '），浮動 IP 會變。建議在 <a href="Advanced_kuroshio.asp">黑潮 DNS</a> 設定網域並開啟 DDNS。</div>';
	var live = {};
	if (r && r.available !== false && r.peers) r.peers.forEach(function (p) { live[p.name] = p; });
	var rows = WGPEERS.map(function (p) {
		var L = live[p[0]], online = L && L.last_handshake_ts && (Date.now() / 1000 - L.last_handshake_ts) < 180;
		return {
			n: '<b>' + U.esc(p[0]) + '</b><span class="tw-dev-sub tw-num">' + U.esc(rm_vpn_net() + '.' + p[3]) + '</span>',
			s: L ? (online ? U.chip('ok', '連線中') : '<span class="tw-muted">' + (L.last_handshake_ts ? '上次 ' + U.fmtAgo(L.last_handshake_ts) : '從未連線') + '</span>') : '<span class="tw-muted">--</span>',
			t: L && L.rx_bytes != null ? '↓ ' + U.fmtBytes(L.tx_bytes) + ' ↑ ' + U.fmtBytes(L.rx_bytes) : '<span class="tw-muted">--</span>'
		};
	});
	h += U.table({ cols: [{ key: 'n', label: '裝置', cls: 'tw-cell-main' }, { key: 's', label: '最後連線' }, { key: 't', label: '流量' }], rows: rows, empty: '還沒有裝置。按「新增裝置」產生設定，用手機掃 QR 碼。' });
	if (!r || r.available === false) h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>誰正在連線、最後連線時間與流量需要更新韌體後才有。</span></div>';
	h += '<div class="tw-actions">' + U.button('新增裝置', { primary: true, icon: 'plus', onclick: 'rm_vpn_add()' }) + U.button('刪除裝置', { small: true, ghost: true, href: 'Advanced_wireguard.asp' }) + '</div>';
	U.set('rm-vpn', h);
}
function rm_vpn_net() { var a = (NV.wgs_addr || '10.66.0.1').split('.'); return a[0] + '.' + a[1] + '.' + a[2]; }
function rm_vpn_enable() {
	TW.apply({ sid: 'WIREGUARD;', fields: { wgs_enable: '1' }, title: '開啟 VPN 伺服器？',
		impacts: ['開放 UDP ' + (NV.wgs_port || '51820') + ' 連接埠給外面連線', '路由器產生伺服器金鑰，防火牆重新載入約 2 秒'] });
}
function rm_vpn_add() {
	var U = TW;
	if (!tw_wg.supported()) { U.toast('這個瀏覽器不支援產生金鑰，請改用較新的瀏覽器', 'bad'); return; }
	if (!NV.wgs_pub) { U.toast('還沒有伺服器金鑰：請先套用一次 VPN 設定', 'bad'); return; }
	if (!rm_endpoint()) { U.toast('請先在完整設定填「裝置連線位址」', 'bad'); return; }
	var body = '<div class="tw-field"><label for="rm-wg-n">裝置名稱</label><input type="text" id="rm-wg-n" maxlength="32" placeholder="例如：我的手機"></div>' +
		'<div class="tw-field"><span class="tw-field-label">這台裝置的網路</span><div class="tw-seg" role="group"><button type="button" id="rm-wg-lan" aria-pressed="true" onclick="rm_wg_mode(0)">只連家裡（建議）</button>' +
		'<button type="button" id="rm-wg-full" aria-pressed="false" onclick="rm_wg_mode(1)">全部經過家裡</button></div>' +
		'<div class="tw-help">「全部經過家裡」在外面用公共 Wi-Fi 比較安全，但速度受家裡上傳頻寬限制。</div></div><div id="rm-wg-err" class="tw-small" style="color:var(--bad)"></div>';
	RM.wgFull = 0;
	U.dialog({ title: '新增 VPN 裝置', body: body, ok: '產生設定', onOk: function () {
		var n = U.$('rm-wg-n').value.trim(), err = U.$('rm-wg-err');
		if (!n) { err.textContent = '請輸入名稱'; return false; }
		if (/[<>"'\\,;]/.test(n)) { err.textContent = '名稱不能有 < > " \' \\ , ; 這些符號'; return false; }
		for (var i = 0; i < WGPEERS.length; i++) if (WGPEERS[i][0] == n) { err.textContent = '已經有叫「' + n + '」的裝置了'; return false; }
		if (WGPEERS.length >= 32) { err.textContent = '最多 32 台裝置'; return false; }
		RM.wgName = n;
		return true;
	} }).then(function (yes) { if (yes) setTimeout(rm_vpn_show, 0); });
}
function rm_wg_mode(f) { RM.wgFull = f; TW.$('rm-wg-lan').setAttribute('aria-pressed', !f); TW.$('rm-wg-full').setAttribute('aria-pressed', !!f); }
function rm_vpn_show() {
	var U = TW, used = {}, host = 0;
	WGPEERS.forEach(function (p) { used[p[3]] = 1; });
	for (var i = 2; i < 255; i++) if (!used[i] && String(i) != (NV.wgs_addr || '').split('.')[3]) { host = i; break; }
	if (!host) { U.toast('VPN 網段的位址用完了', 'bad'); return; }
	var k = tw_wg.keypair();
	var conf = tw_wg.client_conf({ priv: k.priv, psk: k.psk, addr: rm_vpn_net() + '.' + host, dns: NV.lan_ip, serverPub: NV.wgs_pub,
		endpoint: rm_endpoint() + ':' + (NV.wgs_port || '51820'), full: !!RM.wgFull, lanCidr: tw_wg.lan_cidr(NV.lan_ip, NV.lan_mask), vpnNet: rm_vpn_net() + '.0/24' });
	var fname = (RM.wgName.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'padavan-tw') + '-wg.conf';
	var body = '<div class="tw-note tw-s-warn"><b>這份設定只會出現這一次。</b>私鑰只在這個瀏覽器產生，路由器不會保存。</div>' +
		'<div class="tw-share">' + U.qrSvg(conf, 4) + '<div class="tw-share-info"><div class="tw-small">手機：安裝 WireGuard App → 新增 → 掃描 QR 碼</div>' +
		'<div class="tw-small">電腦：下載設定檔後匯入 WireGuard</div><a class="tw-btn tw-btn-sm" download="' + U.esc(fname) + '" href="data:text/plain;charset=utf-8,' + encodeURIComponent(conf) + '">' + U.icon('download', 16) + '<span>下載設定檔</span></a></div></div>';
	U.listAdd({ sid: 'WIREGUARD;', group: 'WGSPeerList', title: '把「' + RM.wgName + '」加進 VPN', body: body, ok: '已經掃好，儲存這台裝置',
		impacts: ['WireGuard 重新載入約 2 秒，已連線的裝置會重新握手'],
		fields: { wgs_name_x_0: RM.wgName, wgs_pub_x_0: k.pub, wgs_psk_x_0: k.psk, wgs_ip_x_0: host }, extra: { wgs_num_x_0: WGPEERS.length } });
}

/* ---------- 連接埠轉送（依用途） ---------- */
function rm_pf_render() {
	var U = TW, h = '';
	if (NV.vts_on != '1' && VSLIST.length) h += '<div class="tw-note tw-s-warn">連接埠轉送目前<b>關閉</b>，下面的規則不會生效。<a href="Advanced_VirtualServer_Content.asp">開啟</a></div>';
	var byIp = {};
	RM.devices.forEach(function (d) { byIp[d.ip] = d; });
	h += U.table({ cols: [{ key: 'd', label: '用途', cls: 'tw-cell-main' }, { key: 't', label: '轉到' }, { key: 'p', label: '連接埠' }, { key: 's', label: '狀態' }],
		rows: VSLIST.map(function (v) {
			var dev = byIp[v[1]];
			return { d: '<b>' + U.esc(v[6] || '（未命名）') + '</b>', t: (dev ? U.esc(dev.name || dev.hostname || '') + ' ' : '') + '<span class="tw-num tw-muted">' + U.esc(v[1]) + '</span>',
				p: '<span class="tw-num">' + U.esc(v[0]) + (v[2] ? ' → ' + U.esc(v[2]) : '') + '</span> ' + U.esc(v[3] == 'BOTH' ? 'TCP＋UDP' : v[3]),
				s: dev ? U.chip('ok', '裝置在線') : U.chip('warn', '裝置不在線') };
		}), empty: '還沒有規則。' });
	h += '<div class="tw-actions">' + U.button('新增：我要讓外面連到…', { primary: true, icon: 'plus', onclick: 'rm_pf_add()' }) + '<span class="tw-cost">刪除或修改請到完整清單</span></div>';
	h += '<div class="tw-small tw-muted">「狀態」只看裝置是否在線；外面是否真的連得到，要從外面測試（例如用手機行動網路）。</div>';
	U.set('rm-pf', h);
}
function rm_pf_add() {
	var U = TW;
	if (!RM.devices.length) { U.toast('找不到可以轉送的裝置', 'bad'); return; }
	var body = '<div class="tw-field"><label for="rm-pf-dev">要連到哪台裝置</label><select id="rm-pf-dev">' + RM.devices.map(function (d) {
		return '<option value="' + U.esc(d.ip) + '">' + U.esc((d.name || d.hostname || d.mac) + '（' + d.ip + '）') + '</option>';
	}).join('') + '</select><div class="tw-help">這台裝置最好先 <a href="tw_devices.asp">固定 IP</a>，不然 IP 變了轉送就失效。</div></div>';
	body += '<div class="tw-field"><span class="tw-field-label">用途</span><div class="tw-options">' + RM_PURPOSE.map(function (p) {
		return '<button type="button" class="tw-option" id="rm-pp-' + p.id + '" aria-pressed="false" onclick="rm_pf_purpose(\'' + p.id + '\')"><span class="tw-option-title">' + U.esc(p.title) + '</span><span class="tw-option-desc">' + U.esc(p.desc) + '</span></button>';
	}).join('') + '</div></div>';
	body += '<div class="tw-fields"><div class="tw-field"><label for="rm-pf-port">外面的連接埠</label><input type="text" id="rm-pf-port" maxlength="12" placeholder="例如 8080 或 3478:3480"></div>' +
		'<div class="tw-field"><label for="rm-pf-proto">協定</label><select id="rm-pf-proto"><option value="TCP">TCP</option><option value="UDP">UDP</option><option value="BOTH">TCP＋UDP</option></select></div>' +
		'<div class="tw-field"><label for="rm-pf-name">名稱</label><input type="text" id="rm-pf-name" maxlength="20"></div></div><div id="rm-pf-err" class="tw-small" style="color:var(--bad)"></div>';
	var f = { vts_num_x_0: VSLIST.length };
	U.listAdd({ sid: 'IPConnection;', group: 'VSList', title: '讓外面連到家裡的裝置', body: body, ok: '新增並套用',
		impacts: ['防火牆重新載入約 2 秒', '外面的人可以連到這台裝置的這些連接埠：請確認裝置有設密碼'].concat(NV.vts_on != '1' ? ['同時開啟連接埠轉送功能'] : []),
		extra: NV.vts_on != '1' ? { vts_num_x_0: VSLIST.length, vts_enable_x: '1' } : f,
		onOk: function () {
			var port = U.$('rm-pf-port').value.trim(), err = U.$('rm-pf-err');
			if (!/^\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?)*$/.test(port)) { err.textContent = '連接埠格式：8080、3478:3480 或 80,443'; return false; }
			if (port.split(/[:,]/).some(function (x) { return +x < 1 || +x > 65535; })) { err.textContent = '連接埠要在 1～65535'; return false; }
			RM.pf = { vts_port_x_0: port, vts_ipaddr_x_0: U.$('rm-pf-dev').value, vts_lport_x_0: '', vts_proto_x_0: U.$('rm-pf-proto').value, vts_protono_x_0: '', vts_srcip_x_0: '', vts_desc_x_0: U.$('rm-pf-name').value.trim() || 'padavan-tw' };
			return true;
		},
		fields: function () { return RM.pf; } });
	rm_pf_purpose('ps');
}
function rm_pf_purpose(id) {
	var p = RM_PURPOSE.filter(function (x) { return x.id == id; })[0];
	RM_PURPOSE.forEach(function (x) { var b = TW.$('rm-pp-' + x.id); if (b) b.setAttribute('aria-pressed', x.id == id ? 'true' : 'false'); });
	TW.$('rm-pf-port').value = p.ports; TW.$('rm-pf-proto').value = p.proto; TW.$('rm-pf-name').value = p.id == 'custom' ? '' : p.title;
	if (p.id == 'custom') TW.$('rm-pf-port').focus();
	var name = { ps: /ps[45]|playstation/i, xbox: /xbox/i, switch: /switch|nintendo/i, nas: /nas|synology|diskstation|qnap/i, cam: /cam|nvr|ipc/i }[id];
	if (name) RM.devices.some(function (d) { if (name.test((d.name || '') + ' ' + (d.hostname || '')) || (d.type == { ps: 'game', xbox: 'game', switch: 'game', nas: 'nas', cam: 'camera' }[id])) { TW.$('rm-pf-dev').value = d.ip; return true; } return false; });
}

/* ---------- UPnP、網域 ---------- */
function rm_upnp() {
	var U = TW, on = NV.upnp == '1';
	return '<div class="tw-inline">' + U.dot(on ? 'ok' : 'off') + '<b>' + (on ? '開啟' : '關閉') + '</b></div>' +
		'<p class="tw-small">遊戲機、BT、視訊軟體會自己請路由器開連接埠，不用手動設定。方便但比較不安全：家裡的任何程式都能開。</p>' +
		'<label class="tw-switch"><input type="checkbox" id="rm-upnp"' + (on ? ' checked' : '') + '><span class="tw-track"></span>允許裝置自動開連接埠</label>' +
		'<div class="tw-actions">' + U.button('套用', { onclick: 'rm_upnp_apply()' }) + '</div>' +
		'<div class="tw-small tw-muted">目前由 UPnP 開啟的連接埠可以在 <a href="Main_IPTStatus_Content.asp">轉送狀態</a> 查看。</div>';
}
function rm_upnp_apply() {
	var v = TW.$('rm-upnp').checked ? '1' : '0';
	if (v == NV.upnp) { TW.toast('沒有變更'); return; }
	TW.apply({ sid: 'IPConnection;', fields: { upnp_enable_x: v }, title: v == '1' ? '開啟 UPnP？' : '關閉 UPnP？', impacts: ['UPnP 服務重新啟動', v == '1' ? '家裡的程式可以自己開連接埠' : '靠 UPnP 開的連接埠會關閉，遊戲 NAT 類型可能變嚴格'] });
}
function rm_domain(r) {
	var U = TW, h = '<dl class="tw-kv">';
	var dom = NV.kuro_on == '1' && NV.kuro_domain ? NV.kuro_domain : (NV.ddns_on == '1' ? NV.ddns_host : '');
	h += '<dt>網域</dt><dd>' + (dom ? U.esc(dom) : '沒有設定') + '</dd>';
	h += '<dt>自動更新 IP</dt><dd>' + (NV.kuro_on == '1' && NV.kuro_ddns == '1' ? '黑潮 DNS DDNS 開啟' : NV.ddns_on == '1' ? 'DDNS 開啟' : '關閉') + '</dd>';
	if (r && r.cert_expiry_ts) h += '<dt>憑證</dt><dd>' + Math.round((r.cert_expiry_ts - Date.now() / 1000) / 86400) + ' 天後到期（自動更新）</dd>';
	else h += '<dt>憑證</dt><dd class="tw-muted">' + (r && r.available === false ? '--' : '到期日需要更新韌體後才看得到') + '</dd>';
	h += '</dl><p class="tw-small">有了網域，WireGuard 和連接埠轉送就不怕浮動 IP 改變。</p><div class="tw-actions">' + U.button('設定網域與 DDNS', { small: true, href: 'Advanced_kuroshio.asp' }) + '</div>';
	U.set('rm-domain', h);
}
