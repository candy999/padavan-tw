/* padavan-tw Wi-Fi：好不好？怎麼分享？（docs/HANDOFF-UI.md 5.5） */
var WF = { share: 'main', scan: {}, api: null };
var WF_CH = {
	'2.4': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
	'5': [0, 36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153, 157, 161, 165]
};

function wf_has5() { return typeof support_5g_radio != 'function' || support_5g_radio(); }
function wf_same_name() { return !wf_has5() || NV.rt_ssid == NV.wl_ssid || NV.wl_ssid == NV.rt_ssid + '_5G'; }

function page_init() {
	var U = TW;
	var h = U.pageHead({ title: 'Wi-Fi', sub: wf_sub(), actions: U.button('原始 Wi-Fi 設定', { href: 'Advanced_Wireless_Content.asp', icon: 'sliders' }) });
	h += '<div class="tw-grid-2">' + wf_name_card() + wf_share_card() + '</div>';
	h += wf_guest_card();
	h += U.card({ id: 'channel', title: '頻道與干擾', bodyId: 'wf-channel', body: U.stateBox('loading') });
	h += U.card({ id: 'roam', title: '多台 AP 與漫遊', bodyId: 'wf-roam', body: U.stateBox('loading') });
	U.mount(h);
	wf_share_render();
	if (location.hash) { var t = U.$(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView(); }, 50); }
	U.poll(function () {
		return Promise.all([U.api('wifi').then(function (r) { WF.api = r; wf_channel_render(); }), U.api('roam').then(wf_roam_render)]);
	}, 30000);
}
function wf_sub() {
	var on = [];
	if (NV.rt_radio == '1') on.push('2.4 GHz');
	if (wf_has5() && NV.wl_radio == '1') on.push('5 GHz');
	return on.length ? '開啟中：' + on.join('、') + (NV.rt_g_on == '1' || NV.wl_g_on == '1' ? ' · IoT 網路開啟' : '') : 'Wi-Fi 目前關閉';
}

/* ---------- 名稱與密碼 ---------- */
function wf_name_card() {
	var U = TW, same = wf_same_name() && NV.rt_ssid == NV.wl_ssid;
	var b = '<div class="tw-field"><label class="tw-switch"><input type="checkbox" id="wf-same"' + (same || !wf_has5() ? ' checked' : '') + (wf_has5() ? '' : ' disabled') + ' onchange="wf_same_toggle()"><span class="tw-track"></span>2.4 GHz 和 5 GHz 用同一個名稱</label>' +
		'<div class="tw-help">同一個名稱時，手機會自己挑比較好的頻段；舊裝置只支援 2.4 GHz 也能連。</div></div>';
	b += '<div class="tw-field"><label for="wf-ssid">Wi-Fi 名稱' + (wf_has5() ? '<span id="wf-ssid-band">（2.4 GHz）</span>' : '') + '</label><input type="text" id="wf-ssid" maxlength="32" value="' + U.esc(NV.rt_ssid) + '"></div>';
	if (wf_has5()) b += '<div class="tw-field" id="wf-ssid5-row"' + (same ? ' hidden' : '') + '><label for="wf-ssid5">Wi-Fi 名稱（5 GHz）</label><input type="text" id="wf-ssid5" maxlength="32" value="' + U.esc(NV.wl_ssid) + '"></div>';
	var open = NV.rt_auth == 'open';
	b += '<div class="tw-field"><label for="wf-psk">密碼</label><div class="tw-pwd"><input type="password" id="wf-psk" maxlength="63" autocomplete="new-password" value="' + U.esc(open ? '' : NV.rt_psk) + '">' +
		'<button type="button" class="tw-btn tw-btn-sm" onclick="wf_peek(\'wf-psk\', this)">顯示</button></div>' +
		'<div class="tw-help">' + (open ? '<b>目前沒有密碼</b>，任何人都能連。輸入密碼後會改成 WPA2 加密。' : '8～63 個字元。兩個頻段用同一組密碼。') +
		(['psk', 'open'].indexOf(NV.rt_auth) < 0 ? '<br>目前使用進階的加密方式（' + U.esc(NV.rt_auth) + '），請到原始設定頁修改。' : '') + '</div></div>';
	b += '<div id="wf-name-err" class="tw-small" style="color:var(--bad)"></div>';
	b += '<div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'wf_name_apply()', disabled: ['psk', 'open'].indexOf(NV.rt_auth) < 0 }) + '<span class="tw-cost">所有 Wi-Fi 裝置會斷線，要用新名稱或密碼重新連線</span></div>';
	return U.card({ title: '名稱與密碼', body: b });
}
function wf_peek(id, btn) {
	var i = TW.$(id);
	i.type = i.type == 'password' ? 'text' : 'password';
	btn.textContent = i.type == 'password' ? '顯示' : '隱藏';
}
function wf_same_toggle() {
	var on = TW.$('wf-same').checked, r = TW.$('wf-ssid5-row'), lb = TW.$('wf-ssid-band');
	if (r) r.hidden = on;
	if (lb) lb.textContent = on ? '' : '（2.4 GHz）';
}
function wf_bytes(s) { return unescape(encodeURIComponent(s)).length; }
function wf_name_apply() {
	var U = TW, err = U.$('wf-name-err');
	var ssid = U.$('wf-ssid').value, same = U.$('wf-same').checked;
	var ssid5 = same ? ssid : (U.$('wf-ssid5') ? U.$('wf-ssid5').value : ssid), psk = U.$('wf-psk').value;
	err.textContent = '';
	if (!ssid.trim() || !ssid5.trim()) { err.textContent = '名稱不能空白'; return; }
	if (wf_bytes(ssid) > 32 || wf_bytes(ssid5) > 32) { err.textContent = '名稱太長（中文一個字佔 3 個位元組，最多 32 個位元組）'; return; }
	if (psk && (psk.length < 8 || psk.length > 63)) { err.textContent = '密碼要 8～63 個字元'; return; }
	if (!psk && NV.rt_auth != 'open') { err.textContent = '請輸入密碼（要取消密碼請到原始設定頁）'; return; }
	if (/[^\x20-\x7e]/.test(psk)) { err.textContent = '密碼只能用英文字母、數字與一般符號'; return; }
	var f = { rt_ssid: ssid, rt_wpa_psk: psk };
	if (wf_has5()) { f.wl_ssid = ssid5; f.wl_wpa_psk = psk; }
	var imp = ['2.4 GHz' + (wf_has5() ? ' 與 5 GHz' : '') + ' 重新啟動，約 10 秒', '所有 Wi-Fi 裝置會斷線，要用新的名稱或密碼重新連線', '有線裝置不受影響'];
	if (NV.rt_auth == 'open' && psk) {
		f.rt_auth_mode = 'psk'; f.rt_wpa_mode = '2'; f.rt_crypto = 'aes';
		if (wf_has5()) { f.wl_auth_mode = 'psk'; f.wl_wpa_mode = '2'; f.wl_crypto = 'aes'; }
		imp.push('加密方式改成 WPA2-Personal（AES）');
	}
	U.apply({ sid: 'WLANConfig11b;' + (wf_has5() ? 'WLANConfig11a;' : ''), fields: f, title: '更改 Wi-Fi 名稱與密碼？', impacts: imp,
		confirmText: '我知道要用新的名稱或密碼重新連線' });
}

/* ---------- 分享 ---------- */
function wf_share_card() {
	var b = '<div class="tw-seg" role="group" aria-label="要分享哪個網路"><button type="button" id="wf-sh-main" aria-pressed="true" onclick="wf_share_pick(\'main\')">家用網路</button>' +
		'<button type="button" id="wf-sh-guest" aria-pressed="false" onclick="wf_share_pick(\'guest\')">IoT 網路</button></div><div id="wf-share"></div>';
	return TW.card({ title: '分享 Wi-Fi', lead: '手機相機掃描 QR 碼就能連線，不用唸密碼', body: b });
}
function wf_share_pick(w) {
	WF.share = w;
	TW.$('wf-sh-main').setAttribute('aria-pressed', w == 'main');
	TW.$('wf-sh-guest').setAttribute('aria-pressed', w == 'guest');
	wf_share_render();
}
function wf_share_render() {
	var U = TW, ssid, psk, auth;
	if (WF.share == 'guest') {
		if (NV.rt_g_on != '1' && NV.wl_g_on != '1') {
			U.set('wf-share', U.stateBox('empty', 'IoT 網路還沒開啟') + '<div class="tw-actions">' + U.button('設定 IoT 網路', { small: true, href: '#guest' }) + '</div>');
			return;
		}
		var useRt = NV.rt_g_on == '1';
		ssid = useRt ? NV.rt_g_ssid : NV.wl_g_ssid; psk = useRt ? NV.rt_g_psk : NV.wl_g_psk; auth = useRt ? NV.rt_g_auth : NV.wl_g_auth;
	} else {
		var rt = NV.rt_radio == '1' || !wf_has5();
		ssid = rt ? NV.rt_ssid : NV.wl_ssid; psk = rt ? NV.rt_psk : NV.wl_psk; auth = rt ? NV.rt_auth : NV.wl_auth;
	}
	U.set('wf-share', '<div class="tw-share">' + U.qrSvg(U.wifiQrText(ssid, psk, auth)) + '<div class="tw-share-info">' + U.copyField(ssid, '名稱') +
		(auth != 'open' && psk ? U.copyField(psk, '密碼', true) : '<div class="tw-small">這個網路沒有密碼</div>') + '<div class="tw-actions">' +
		U.button('列印', { small: true, icon: 'download', onclick: 'window.print()' }) + '</div></div></div>');
}

/* ---------- IoT 網路（用原本的訪客網路那一格） ---------- */
/* 給智慧家電、印表機、出單機等舊裝置：這個 SSID 固定不宣告 802.11k／v／r（rc 的 ralink.c 寫 dat 時處理） */
function wf_iot_default_name(main) {
	return (main || '').replace(/_IoT$/, '') + '_IoT';
}
function wf_guest_card() {
	var U = TW, on2 = NV.rt_g_on == '1', on5 = NV.wl_g_on == '1', has5 = wf_has5(), any = on2 || on5;
	/* 還沒開過（或是原本訪客網路的名稱）就預設「家用名稱＋_IoT」 */
	var name2 = on2 && NV.rt_g_ssid ? NV.rt_g_ssid : wf_iot_default_name(NV.rt_ssid);
	var name5 = on5 && NV.wl_g_ssid ? NV.wl_g_ssid : name2;
	var same = !has5 || name5 == name2;
	var psk = (NV.rt_g_auth != 'open' && NV.rt_g_psk) ? NV.rt_g_psk : (NV.rt_auth != 'open' ? NV.rt_psk : '');
	var lan = any ? NV.rt_g_iso != '1' : true, peer = any ? NV.rt_g_apiso != '1' : true;
	var sw = function (id, checked, text, extra) {
		return '<label class="tw-switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (extra || '') + '><span class="tw-track"></span>' + text + '</label>';
	};
	var b = sw('wf-g-on2', on2, '2.4G 開啟 IoT 網路', ' onchange="wf_iot_sync()"');
	if (has5) b += sw('wf-g-on5', on5, '5G 也開啟（大多數 IoT 只有 2.4G）', ' onchange="wf_iot_sync()"');
	b += '<div id="wf-g-form"' + (any ? '' : ' hidden') + ' style="display:flex;flex-direction:column;gap:14px">';
	b += '<div class="tw-fields"><div class="tw-field"><label for="wf-g-ssid">名稱</label><input type="text" id="wf-g-ssid" maxlength="32" value="' + U.esc(name2) + '"></div>' +
		'<div class="tw-field"><label for="wf-g-psk">密碼</label><div class="tw-pwd"><input type="password" id="wf-g-psk" maxlength="63" autocomplete="new-password" value="' + U.esc(psk) + '">' +
		'<button type="button" class="tw-btn tw-btn-sm" onclick="wf_peek(\'wf-g-psk\', this)">顯示</button></div><div class="tw-help">預設跟家用網路相同，舊裝置改連新名稱時密碼照舊。留空就是不用密碼（不建議）。</div></div></div>';
	if (has5) {
		b += sw('wf-g-same', same, '2.4G 和 5G 用同一個名稱', ' onchange="wf_iot_sync()"').replace('<label class="tw-switch">', '<label class="tw-switch"' + (on2 && on5 ? '' : ' hidden') + '>');
		b += '<div class="tw-field" id="wf-g-f5"' + (same || !on5 ? ' hidden' : '') + '><label for="wf-g-ssid5">5G 的名稱</label><input type="text" id="wf-g-ssid5" maxlength="32" value="' + U.esc(same ? name2 + '_5G' : name5) + '"></div>';
	}
	b += sw('wf-g-lan', lan, '可以連到家裡的裝置（手機 App 控制、印表機、出單機）');
	b += '<div class="tw-help" style="margin-top:-8px">關閉時，IoT 裝置只能上網，看不到家裡的電腦、NAS 和攝影機；手機 App 要在家裡直接控制的裝置要打開。</div>';
	b += sw('wf-g-peer', peer, 'IoT 裝置之間可以互相連線');
	b += '<div class="tw-help" style="margin-top:-8px">例如出單機和收銀平板都連 IoT 網路時要打開。</div>';
	b += '<div class="tw-note">這個網路固定不宣告 802.11k／v／r（快速漫遊），看不懂這些新功能的舊裝置也連得上。手機、電腦請連家用網路，才有漫遊加速。</div>';
	b += '</div><div id="wf-g-err" class="tw-small" style="color:var(--bad)"></div><div class="tw-actions">' + U.button('套用', { primary: true, onclick: 'wf_guest_apply()' }) +
		U.button('每天開放時段、更多設定', { small: true, ghost: true, href: 'Advanced_WGuest2g_Content.asp' }) + '</div>';
	return U.card({ id: 'guest', title: 'IoT 網路', lead: '給智慧家電、印表機、出單機等舊裝置用的 Wi-Fi：名稱加上 _IoT，不宣告快速漫遊功能', body: b });
}
function wf_iot_sync() {
	var U = TW, on5 = U.$('wf-g-on5'), same = U.$('wf-g-same');
	U.$('wf-g-form').hidden = !(U.$('wf-g-on2').checked || (on5 && on5.checked));
	if (same) {
		same.parentNode.hidden = !(on5 && on5.checked && U.$('wf-g-on2').checked);
		U.$('wf-g-f5').hidden = same.checked || !(on5 && on5.checked);
	}
}
function wf_guest_apply() {
	var U = TW, err = U.$('wf-g-err'), has5 = wf_has5();
	var on2 = U.$('wf-g-on2').checked, on5 = has5 && U.$('wf-g-on5').checked;
	var ssid = U.$('wf-g-ssid').value, psk = U.$('wf-g-psk').value;
	var same = !has5 || !on2 || U.$('wf-g-same').checked, ssid5 = same ? ssid : U.$('wf-g-ssid5').value;
	var iso = U.$('wf-g-lan').checked ? '0' : '1', apiso = U.$('wf-g-peer').checked ? '0' : '1';
	err.textContent = '';
	var names = [];
	if (on2 || (on5 && same)) names.push(ssid);
	if (on5 && !same) names.push(ssid5);
	for (var k = 0; k < names.length; k++) {
		if (!names[k].trim()) { err.textContent = '名稱不能空白'; return; }
		if (wf_bytes(names[k]) > 32) { err.textContent = '名稱太長'; return; }
		if (names[k] == NV.rt_ssid || names[k] == NV.wl_ssid) { err.textContent = '名稱不能跟家用網路一樣'; return; }
	}
	if ((on2 || on5) && psk && (psk.length < 8 || psk.length > 63)) { err.textContent = '密碼要 8～63 個字元'; return; }
	var f = {}, sid = 'WLANConfig11b;';
	var fill = function (p, on, name) {
		f[p + '_guest_enable'] = on ? '1' : '0';
		if (!on) return;
		f[p + '_guest_ssid'] = name; f[p + '_guest_lan_isolate'] = iso; f[p + '_guest_ap_isolate'] = apiso;
		if (psk) { f[p + '_guest_auth_mode'] = 'psk'; f[p + '_guest_wpa_mode'] = '2'; f[p + '_guest_crypto'] = 'aes'; f[p + '_guest_wpa_psk'] = psk; }
		else f[p + '_guest_auth_mode'] = 'open';
	};
	fill('rt', on2, ssid);
	if (has5) { sid += 'WLANConfig11a;'; fill('wl', on5, ssid5); }
	var any = on2 || on5;
	U.apply({ sid: sid, fields: f, title: any ? '套用 IoT 網路？' : '關閉 IoT 網路？',
		impacts: ['Wi-Fi 重新啟動約 10 秒，所有 Wi-Fi 裝置會短暫斷線'].concat(any ? (psk ? [] : ['沒有設密碼：附近任何人都能連上 IoT 網路（建議設定密碼）']).concat(['原本連家用網路的舊裝置要改連「' + names.join('」「') + '」']) : ['正在用 IoT 網路的裝置會斷線']) });
}

/* ---------- 頻道與干擾 ---------- */
function wf_hint(band, c) {
	c = parseInt(c, 10);
	if (band == '5') {
		if (c == 0) return '自動選頻只會選台灣免雷達偵測的頻道（36–48、149–165）。';
		if ((c >= 52 && c <= 64) || (c >= 100 && c <= 140)) return 'DFS 頻段：台灣規定要有雷達偵測並限制功率，本韌體沒有啟用雷達偵測，不符合 NCC 規定，請自行評估。';
		if (c >= 169) return '不在台灣開放的頻段內。';
		return '台灣可用頻道，免雷達偵測。';
	}
	if (c == 0) return '自動選頻只會選 1–11。';
	if (c >= 12) return '台灣可用，但部分美規裝置掃不到 12、13。';
	return c == 1 || c == 6 || c == 11 ? '台灣可用頻道；1、6、11 互不重疊，最推薦。' : '台灣可用頻道；建議用 1、6、11（互不重疊）。';
}
function wf_channel_render() {
	var U = TW, r = WF.api, h = '';
	var bands = [['2.4', '2.4 GHz', NV.rt_channel, NV.rt_radio]];
	if (wf_has5()) bands.push(['5', '5 GHz', NV.wl_channel, NV.wl_radio]);
	var apiBands = {};
	if (r && r.bands) r.bands.forEach(function (b) { apiBands[b.id] = b; });
	h += '<div class="tw-grid-2">';
	bands.forEach(function (bd) {
		var id = bd[0], ab = apiBands[id], cur = bd[2];
		var x = '<div class="tw-field"><div class="tw-inline"><b>' + bd[1] + '</b>' + (bd[3] == '1' ? U.chip('ok', '開啟') : U.chip('off', '關閉')) +
			(ab && ab.busy_pct != null ? U.chip(ab.busy_pct > 70 ? 'bad' : ab.busy_pct > 50 ? 'warn' : 'ok', '空中忙碌 ' + ab.busy_pct + ' %') : '') + '</div>';
		x += '<label for="wf-ch-' + id.replace('.', '') + '" class="tw-small tw-muted">頻道' + (ab ? '（目前 ' + ab.channel + '）' : '') + '</label>' +
			'<select id="wf-ch-' + id.replace('.', '') + '" onchange="TW.$(\'wf-hint-' + id.replace('.', '') + '\').textContent=wf_hint(\'' + id + '\', this.value)">' +
			WF_CH[id].map(function (c) { return '<option value="' + c + '"' + (String(c) == String(cur) ? ' selected' : '') + '>' + (c ? c : '自動') + '</option>'; }).join('') + '</select>' +
			'<div class="tw-help" id="wf-hint-' + id.replace('.', '') + '">' + wf_hint(id, cur) + '</div>';
		if (ab && ab.acs_last) x += '<div class="tw-small tw-muted">上次自動選頻（' + U.fmtTime(ab.acs_last.ts) + '）：' + U.esc(ab.acs_last.reason) + '</div>';
		x += '<div id="wf-nb-' + id.replace('.', '') + '">' + wf_neighbors(id, ab) + '</div></div>';
		h += x;
	});
	h += '</div>';
	h += '<label class="tw-switch"><input type="checkbox" id="wf-acs"' + (NV.acs_daily == '1' ? ' checked' : '') + '><span class="tw-track"></span>每天 ' +
		'<select id="wf-acs-h" aria-label="幾點" style="width:auto;min-height:32px">' + Array.apply(null, Array(24)).map(function (_, i) { return '<option value="' + i + '"' + (String(i) == String(NV.acs_hour || '4') ? ' selected' : '') + '>' + i + ' 點</option>'; }).join('') +
		'</select> 自動挑最空的頻道</label><div class="tw-help" style="margin-top:-8px">只在頻道設成「自動」時有效；換頻道時 Wi-Fi 會中斷約 10 秒，所以挑半夜。</div>';
	h += '<div class="tw-actions">' + U.button('套用頻道設定', { primary: true, onclick: 'wf_channel_apply()' }) + '<span class="tw-cost">換頻道的頻段，裝置會重新連線約 10 秒</span></div>';
	U.set('wf-channel', h);
}
function wf_neighbors(id, ab) {
	var U = TW, s = WF.scan[id];
	if (ab && ab.neighbors) return wf_nb_chart(id, ab.neighbors.by_channel, ab.neighbors.strongest, ab.channel, '鄰近 AP（每 30 秒更新）');
	if (s && s.loading) return U.stateBox('loading', '掃描中，約 5 秒…');
	if (s && s.broken) return U.stateBox('unavailable', '掃描結果的格式讀不懂（驅動回報的格式跟預期不同），請重新掃描一次');
	if (s && s.list) {
		var by = {};
		s.list.forEach(function (a) { by[a.ch] = (by[a.ch] || 0) + 1; });
		var strongest = s.list.slice().sort(function (a, b) { return b.sig - a.sig; }).slice(0, 3).map(function (a) { return { ssid: a.ssid, channel: a.ch, signal_pct: a.sig }; });
		return wf_nb_chart(id, by, strongest, id == '5' ? NV.wl_channel : NV.rt_channel, '剛剛掃描的結果（' + s.list.length + ' 個 AP）');
	}
	return '<div class="tw-actions">' + U.button('掃描附近的 Wi-Fi', { small: true, icon: 'search', onclick: "wf_scan('" + id + "')" }) + '<span class="tw-cost">約 5 秒，掃描時這個頻段可能短暫變慢</span></div>';
}
function wf_nb_chart(id, by, strongest, cur, title) {
	var U = TW, chs = id == '5' ? [36, 40, 44, 48, 149, 153, 157, 161, 165] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
	Object.keys(by || {}).forEach(function (c) { c = parseInt(c, 10); if (chs.indexOf(c) < 0) chs.push(c); });
	chs.sort(function (a, b) { return a - b; });
	var max = 1;
	chs.forEach(function (c) { max = Math.max(max, by[c] || 0); });
	var bars = chs.map(function (c) {
		var n = by[c] || 0, isCur = String(c) == String(cur);
		var hgt = Math.max(3, n / max * 80);
		return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;min-width:0"><span class="tw-num" style="font-size:11px;color:var(--muted)">' + n + '</span>' +
			'<div style="width:100%;height:' + hgt + 'px;border-radius:3px 3px 0 0;background:' + (isCur ? 'var(--accent)' : 'var(--line-strong)') + '"></div>' +
			'<span class="tw-num" style="font-size:11px;' + (isCur ? 'color:var(--accent);font-weight:600' : 'color:var(--muted)') + '">' + c + '</span></div>';
	}).join('');
	var desc = chs.map(function (c) { return '頻道 ' + c + ' 有 ' + (by[c] || 0) + ' 個'; }).join('，');
	var h = '<div class="tw-small tw-muted">' + U.esc(title) + '；藍色是目前頻道</div><div role="img" aria-label="' + U.esc(desc) + '" style="display:grid;grid-template-columns:repeat(' + chs.length + ',minmax(0,1fr));gap:4px;align-items:end;height:112px">' + bars + '</div>';
	if (strongest && strongest.length) h += '<div class="tw-small tw-muted">最強的鄰居：' + strongest.map(function (a) {
		return U.esc(a.ssid || '（隱藏）') + '（頻道 ' + a.channel + (a.rssi_dbm != null ? '，' + a.rssi_dbm + ' dBm' : a.signal_pct != null ? '，訊號 ' + a.signal_pct + ' %' : '') + '）';
	}).join('、') + '</div>';
	return h;
}
function wf_scan(id) {
	WF.scan[id] = { loading: true };
	TW.set('wf-nb-' + id.replace('.', ''), wf_neighbors(id));
	fetch(id == '5' ? '/wds_aplist.asp' : '/wds_aplist_2g.asp', { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) {
		var list;
		try { list = (new Function(t + ';return typeof wds_aplist != "undefined" ? wds_aplist : [];'))(); }
		catch (e) { list = null; }
		/* 實機 D3：ralink.c 用固定欄位寬度解析驅動的掃描表，格式不合時會輸出壞掉的資料（字串裡有換行、欄位錯位） */
		var ok = list && list.every(function (a) { return /^\d{1,3}$/.test(String(a[2]).trim()) && /^[0-9A-F:]{17}$/i.test(String(a[1]).trim()); });
		if (!ok) { WF.scan[id] = { broken: true }; return; }
		WF.scan[id] = { list: list.map(function (a) {
			var s = a[0]; try { s = decodeURIComponent(a[0]); } catch (e) {}
			return { ssid: s, ch: parseInt(a[2], 10), sig: parseInt(a[3], 10) };
		}).filter(function (a) { return a.ch > 0; }) };
	}, function () { WF.scan[id] = null; TW.toast('掃描失敗', 'bad'); }).then(function () {
		TW.set('wf-nb-' + id.replace('.', ''), wf_neighbors(id));
	});
}
function wf_channel_apply() {
	var U = TW, f = {}, sid = '', imp = [];
	var c2 = U.$('wf-ch-24').value, c5 = U.$('wf-ch-5') ? U.$('wf-ch-5').value : null;
	var acs = U.$('wf-acs').checked ? '1' : '0', hr = U.$('wf-acs-h').value;
	if (c2 != NV.rt_channel || acs != NV.acs_daily || hr != NV.acs_hour) { sid += 'WLANConfig11b;'; f.rt_channel = c2; f.tw_acs_daily = acs; f.tw_acs_hour = hr; }
	if (c2 != NV.rt_channel) imp.push('2.4 GHz 換到' + (c2 == '0' ? '自動選頻' : '頻道 ' + c2) + '，2.4 GHz 裝置會重新連線約 10 秒');
	if (c5 != null && c5 != NV.wl_channel) { sid += 'WLANConfig11a;'; f.wl_channel = c5; f.tw_acs_daily = acs; f.tw_acs_hour = hr; imp.push('5 GHz 換到' + (c5 == '0' ? '自動選頻' : '頻道 ' + c5) + '，5 GHz 裝置會重新連線約 10 秒'); }
	if (acs != NV.acs_daily || hr != NV.acs_hour) imp.push(acs == '1' ? '每天 ' + hr + ' 點自動重選頻道' : '關閉每日自動選頻');
	if (!sid) { U.toast('沒有變更'); return; }
	U.apply({ sid: sid, fields: f, title: '套用頻道設定？', impacts: imp });
}

/* ---------- 多台 AP 與漫遊 ---------- */
function wf_ft_apply(el) {
	var on = el.checked, f = { rt_HT_80211R: on ? '1' : '0' }, sid = 'WLANConfig11b;';
	if (wf_has5()) { f.wl_HT_80211R = on ? '1' : '0'; sid += 'WLANConfig11a;'; }
	TW.apply({ sid: sid, fields: f, title: on ? '開啟快速漫遊（802.11r）？' : '關閉快速漫遊（802.11r）？',
		impacts: ['Wi-Fi 重新啟動約 10 秒，所有 Wi-Fi 裝置會短暫斷線'].concat(on ? ['舊裝置連不上時，請改連 IoT 網路（Wi-Fi 頁「IoT 網路」）'] : []) })
		.then(function (ok) { if (!ok) el.checked = !on; });
}
function wf_roam_mode(v) {
	if (v == (NV.roam_on || '0')) return;
	var f = { tw_roam_enable: v };
	TW.apply({ sid: wf_has5() ? 'WLANConfig11a;' : 'WLANConfig11b;', fields: f,
		title: { '0': '關閉漫遊中控？', '1': '改成觀察模式？', '2': '改成建議模式？' }[v],
		impacts: v == '2' ? ['不會重新啟動 Wi-Fi；約 30 秒內生效', '支援 11k／11v 的手機會收到「換到比較好的 AP／頻段」的建議，手機可以不理會', '建議與結果都記在「查看漫遊紀錄」'] :
			['不會重新啟動 Wi-Fi；約 30 秒內生效'] });
}
function wf_roam_render(r) {
	var U = TW, h = '';
	if (r && r.available !== false && !r.warming_up && r.aps) {
		h += U.table({ cols: [{ key: 'ap', label: 'AP', cls: 'tw-cell-main' }, { key: 'ip', label: 'IP' }, { key: 'st', label: '狀態' }, { key: 'n', label: '裝置（2.4G／5G）' }],
			rows: r.aps.map(function (a) {
				return { ap: '<b>' + U.esc(a.name) + '</b>' + (a.self ? ' ' + U.chip('info', '這台') : '') + '<span class="tw-dev-sub">' + U.esc(a.model || '') + '</span>',
					ip: '<span class="tw-num">' + U.esc(a.ip) + '</span>', st: '<span class="tw-inline">' + (a.online ? U.chip('ok', '在線') : U.chip('bad', '離線')) + (a.steer_capable ? U.chip('info', '11v') : '') + (a.ft ? U.chip('info', '11r') : '') + '</span>',
					n: a.clients_24 + ' / ' + a.clients_5 };
			}) });
		if (r.stats) {
			var st = r.stats;
			h += '<div class="tw-help">' + (r.mode == 'steer' ? '建議模式' : '觀察模式') + '｜開機以來：問 ' + st.ask + ' 次、收到回報 ' + st.report + ' 筆、建議 ' + st.suggest + ' 次、換過去 ' + st.moved +
				' 次（回 5G ' + st.back5 + ' 次）、不理會 ' + st.ignored + ' 次；這一小時 ' + st.hour + '／' + st.hour_max + ' 次' + (r.driver && r.driver.name ? '｜驅動 ' + U.esc(r.driver.name) : '') + '</div>';
		}
		if (r.clients && r.clients.length) {
			var cap = function (x) { return x > 0 ? '✓' : x == 0 ? '✗' : '?'; };
			var stx = { pending: U.chip('info', '等建議結果'), backoff: U.chip('warn', '退避中'), stopped: U.chip('unknown', '不再建議') };
			h += '<details><summary class="tw-small">連在這台的裝置（' + r.clients.length + ' 台）</summary>' + U.table({ cols: [{ key: 'd', label: '裝置', cls: 'tw-cell-main' }, { key: 'b', label: '頻段' }, { key: 's', label: '訊號' }, { key: 'kv', label: '11k／11v' }, { key: 'st', label: '狀態' }],
				rows: r.clients.map(function (c) {
					return { d: U.esc(c.name), b: '<span class="tw-inline">' + (c.band == 5 ? '5G' : '2.4G') + (c.band == 2 && c.seen5 ? '<span class="tw-dev-sub">24 小時內連過 5G</span>' : '') + '</span>',
						s: '<span class="tw-inline"><span class="tw-num">' + c.rssi + ' dBm</span>' + (c.psm ? '<span class="tw-dev-sub">省電中</span>' : '') + '</span>',
						kv: cap(c.k) + '／' + cap(c.v), st: (stx[c.state] || '') + (c.suggested ? ' <span class="tw-dev-sub">建議 ' + c.suggested + ' 次、換過去 ' + c.moved + ' 次</span>' : '') };
				}) }) + '</details>';
		}
		(r.advice || []).forEach(function (a) { h += '<div class="tw-note tw-s-' + (a.level || 'warn') + '"><b>' + U.esc(a.title) + '</b><br>' + U.esc(a.detail) + '</div>'; });
		h += '<h3 class="tw-small tw-muted" style="margin-top:4px">最近的漫遊</h3>' + U.timeline((r.events || []).map(function (e) {
			return { ts: e.ts, type: 'roam', level: e.type == 'sticky' ? 'warn' : 'ok', device: e.name,
				text: e.type == 'sticky' ? e.name + ' 停在比較遠的 ' + e.to + '（' + e.rssi_to + ' dBm）' :
					e.type == 'band' ? e.name + ' 換頻段 ' + e.from + ' → ' + e.to + '（' + e.rssi_from + ' → ' + e.rssi_to + ' dBm）' :
					e.name + ' 從 ' + e.from + ' 換到 ' + e.to + '（' + e.rssi_from + ' → ' + e.rssi_to + ' dBm）' };
		}), '最近沒有漫遊');
		h += '<div class="tw-actions"><button type="button" class="tw-btn tw-btn-sm" onclick="tw_roam_show(this)">查看完整紀錄</button></div>' +
			'<pre id="tw_roam_out" style="display:none;white-space:pre-wrap;background:var(--surface-2);color:var(--text);border:0;border-radius:8px;padding:12px;font-size:12.5px"></pre>';
	} else {
		var why = r && r.warming_up ? '資料收集中（漫遊中控剛啟動）' : r && r.reason == 'disabled' ? '漫遊中控已關閉' : '這台的韌體還沒有漫遊資料';
		h += '<div class="tw-inline">' + U.dot(NV.roam_on == '2' ? 'ok' : NV.roam_on == '1' ? 'info' : 'off') + '<b>漫遊中控：' +
			(NV.roam_on == '2' ? '建議模式（11k 問裝置、11v 建議換，不踢人）' : NV.roam_on == '1' ? '觀察模式（只記錄，不引導）' : '關閉') + '</b></div>';
		h += '<div class="tw-partial">' + U.icon('info', 14) + '<span>' + why + '。現在可以先看文字紀錄：</span></div>';
		h += '<div class="tw-actions"><button type="button" class="tw-btn tw-btn-sm" onclick="tw_roam_show(this)">查看漫遊紀錄</button></div>' +
			'<pre id="tw_roam_out" style="display:none;white-space:pre-wrap;background:var(--surface-2);color:var(--text);border:0;border-radius:8px;padding:12px;font-size:12.5px"></pre>';
	}
	var m = NV.roam_on == '2' ? '2' : NV.roam_on == '1' ? '1' : '0';
	h += '<hr class="tw-sep"><div class="tw-field"><span class="tw-field-label">引導裝置換到比較好的 AP 或頻段</span><div class="tw-seg" role="group" aria-label="漫遊模式">' +
		['0', '1', '2'].map(function (v) {
			return '<button type="button" aria-pressed="' + (m == v) + '" onclick="wf_roam_mode(\'' + v + '\')">' + { '0': '關閉', '1': '觀察', '2': '建議（11k＋11v）' }[v] + '</button>';
		}).join('') + '</div>' +
		'<div class="tw-help">「建議」會用 11k 請手機量附近的 AP，明顯比較好時用 11v 建議它換過去（也包括暫時掉到 2.4G、回來後建議回 5G）。' +
		'<b>永遠不踢人</b>：手機不理會就退避，不支援 11k／11v 的裝置完全不碰；每台裝置每天最多 6 次，每台 AP 每小時超過 12 次會自動退回觀察。' +
		'2.4G 與 5G 要同名同密碼才有效。IoT 網路不參與。弱訊號門檻在 <a href="Advanced_Wireless_Content.asp">原始 5 GHz 設定頁</a>。</div></div>';
	var ft = NV.rt_ft == '1' || (wf_has5() && NV.wl_ft == '1');
	h += '<div class="tw-field"><label class="tw-switch"><input type="checkbox" id="wf-ft"' + (ft ? ' checked' : '') + ' onchange="wf_ft_apply(this)"><span class="tw-track"></span>快速漫遊（802.11r）</label>' +
		'<div class="tw-help">換 AP 或換頻段時省掉重新驗證，通話、視訊比較不會卡一下。家裡每台 padavan-tw 同名同密碼時自動在同一個漫遊群組。' +
		'少數舊裝置（智慧家電、印表機、出單機）看到 802.11r 會連不上：請讓它們改連 <b>IoT 網路</b>（不宣告 802.11k/v/r）。切換會重新啟動 Wi-Fi。</div></div>';
	U.set('wf-roam', h);
}
