/* padavan-tw 系統：路由器本身（docs/HANDOFF-UI.md 5.5） */
var SY = { repo: 'candy999/padavan-tw' };
var SY_DAYS = ['日', '一', '二', '三', '四', '五', '六'];

function page_init() {
	var U = TW;
	var h = U.pageHead({ title: '系統', sub: U.esc(U.unent(NV.productid)) + ' · 韌體 ' + U.esc(U.unent(NV.firmver)),
		actions: U.button('重開機', { icon: 'restart', onclick: 'TW.rebootRouter()' }) + U.button('登出', { icon: 'power', onclick: 'logout()' }) });
	h += '<div class="tw-grid-2">' + sy_fw_card() + sy_backup_card() + '</div>';
	h += '<div class="tw-grid-2">' + sy_pwd_card() + sy_reboot_card() + '</div>';
	h += '<div class="tw-grid-2">' + sy_time_card() + sy_misc_card() + '</div>';
	U.mount(h);
	sy_fw_show(null);
	U.api('router').then(function (r) {
		var e = U.$('sy-uptime');
		if (e && r && r.uptime_s != null) e.textContent = U.fmtDur(r.uptime_s);
	});
}

/* ---------- 韌體更新 ---------- */
function sy_fw_card() {
	var U = TW;
	return U.card({ id: 'firmware', title: '韌體更新', body: '<dl class="tw-kv"><dt>目前版本</dt><dd>' + U.esc(U.unent(NV.firmver)) + '</dd><dt>已運作</dt><dd id="sy-uptime">--</dd></dl>' +
		'<div id="sy-fw"></div><div class="tw-actions">' + U.button('檢查更新', { icon: 'search', id: 'sy-fw-btn', onclick: 'sy_fw_check()' }) +
		U.button('上傳韌體', { icon: 'upload', href: 'Advanced_FirmwareUpgrade_Content.asp' }) + '</div>' +
		'<div class="tw-small tw-muted">「檢查更新」由這個瀏覽器向 GitHub 查詢，路由器本身不需要連外。更新前請先備份設定。</div>' });
}
function sy_fw_show(r) {
	var U = TW, h = '';
	if (!r) h = '';
	else if (r.loading) h = U.stateBox('loading', '正在向 GitHub 查詢…');
	else if (r.error) h = U.stateBox('error', '無法連到 GitHub（' + r.error + '）。這台電腦要能上網才查得到。');
	else if (r.none) h = U.stateBox('empty', '還沒有發布正式版本。測試版可以在 GitHub Actions 下載。') + '<div class="tw-actions">' + U.button('開啟 GitHub', { small: true, href: 'https://github.com/' + SY.repo + '/actions' }) + '</div>';
	else {
		var cur = U.unent(NV.firmver), tag = r.tag_name || '', same = tag && cur.indexOf(tag.replace(/^v/, '')) >= 0;
		h = U.conclusion({ state: same ? 'ok' : 'warn', title: same ? '已經是最新版本' : '有新版本：' + tag, sub: U.esc((r.name || '') + (r.published_at ? ' · ' + r.published_at.slice(0, 10) : '')) });
		if (!same && r.body) h += '<details><summary class="tw-small">更新說明</summary><pre style="white-space:pre-wrap;background:var(--surface-2);color:var(--text);border:0;border-radius:8px;padding:12px;font-size:12.5px;max-height:240px;overflow:auto">' + U.esc(r.body) + '</pre></details>';
		if (!same) h += '<div class="tw-actions">' + U.button('下載新版本', { small: true, href: r.html_url }) + U.button('先備份設定', { small: true, href: 'Settings_' + U.unent(NV.productid) + '.CFG' }) + '</div>';
	}
	U.set('sy-fw', h);
}
function sy_fw_check() {
	var b = TW.$('sy-fw-btn'); b.disabled = true;
	sy_fw_show({ loading: true });
	TW.latestRelease(SY.repo).then(function (r) { b.disabled = false; sy_fw_show(r); }, function (e) { b.disabled = false; sy_fw_show({ error: e.message || '連線失敗' }); });
}

/* ---------- 備份與還原 ---------- */
function sy_backup_card() {
	var U = TW;
	return U.card({ title: '備份與還原', body: '<p class="tw-small">設定檔包含 Wi-Fi 密碼、PPPoE 帳號密碼等，請妥善保存。</p><div class="tw-actions">' +
		U.button('下載設定檔', { primary: true, icon: 'download', href: 'Settings_' + U.unent(NV.productid) + '.CFG' }) + U.button('從設定檔還原', { icon: 'upload', href: 'Advanced_SettingBackup_Content.asp' }) + '</div>' +
		'<div class="tw-small tw-muted">恢復原廠設定也在 <a href="Advanced_SettingBackup_Content.asp">備份與還原頁</a>：會清除所有設定，Wi-Fi 與管理密碼都會變回預設。</div>' });
}

/* ---------- 管理密碼 ---------- */
function sy_pwd_card() {
	var U = TW;
	var b = '<div class="tw-small">登入帳號：<b>' + U.esc(U.unent(NV.http_user)) + '</b></div>' +
		'<div class="tw-field"><label for="sy-p1">新的管理密碼</label><div class="tw-pwd"><input type="password" id="sy-p1" maxlength="64" autocomplete="new-password"></div></div>' +
		'<div class="tw-field"><label for="sy-p2">再輸入一次</label><div class="tw-pwd"><input type="password" id="sy-p2" maxlength="64" autocomplete="new-password"></div>' +
		'<div class="tw-help">至少 8 個字元。這是登入這個後台與 SSH 的密碼，不是 Wi-Fi 密碼。</div></div><div id="sy-p-err" class="tw-small" style="color:var(--bad)"></div>' +
		'<div class="tw-actions">' + U.button('變更密碼', { onclick: 'sy_pwd_apply()' }) + U.button('遠端管理、SSH 等存取設定', { small: true, ghost: true, href: 'Advanced_Services_Content.asp' }) + '</div>';
	return U.card({ title: '管理密碼', body: b });
}
function sy_pwd_apply() {
	var U = TW, a = U.$('sy-p1').value, b = U.$('sy-p2').value, err = U.$('sy-p-err');
	err.textContent = '';
	if (a.length < 8) { err.textContent = '至少 8 個字元'; return; }
	if (a != b) { err.textContent = '兩次輸入的密碼不一樣'; return; }
	if (/[^\x21-\x7e]/.test(a)) { err.textContent = '只能用英文字母、數字與符號（不能有空白或中文）'; return; }
	U.apply({ sid: 'General;', fields: { http_passwd: a }, title: '變更管理密碼？', danger: true, ok: '變更密碼',
		impacts: ['套用後要用新密碼重新登入這個後台', 'SSH 登入密碼也會一起改', '忘記密碼只能按路由器的 Reset 鍵恢復原廠設定'],
		confirmText: '我已經記下新密碼' });
}

/* ---------- 定時重開機 ---------- */
function sy_reboot_card() {
	var U = TW, s = NV.rb || '11111110400', on = NV.rb_on == '1';
	var hh = s.substr(7, 2) || '04', mm = s.substr(9, 2) || '00';
	var b = '<label class="tw-switch"><input type="checkbox" id="sy-rb"' + (on ? ' checked' : '') + '><span class="tw-track"></span>定時重新開機</label>' +
		'<div class="tw-field"><span class="tw-field-label">哪幾天</span><div class="tw-inline">' + SY_DAYS.map(function (d, i) {
			return '<label class="tw-small" style="display:inline-flex;gap:4px;align-items:center;min-height:36px"><input type="checkbox" id="sy-rb-d' + i + '"' + (s.charAt(i) == '1' ? ' checked' : '') + '>週' + d + '</label>';
		}).join('') + '</div></div>' +
		'<div class="tw-field"><label for="sy-rb-t">時間</label><input type="time" id="sy-rb-t" value="' + hh + ':' + mm + '" style="width:140px"></div>' +
		'<div class="tw-help">長時間運作偶爾會變慢的話可以開。重開機約 1～2 分鐘不能上網，建議挑半夜。</div>' +
		'<div class="tw-actions">' + U.button('套用', { onclick: 'sy_reboot_apply()' }) + '</div>';
	return U.card({ title: '定時重開機', body: b });
}
function sy_reboot_apply() {
	var U = TW, on = U.$('sy-rb').checked, days = '', t = (U.$('sy-rb-t').value || '04:00').split(':');
	for (var i = 0; i < 7; i++) days += U.$('sy-rb-d' + i).checked ? '1' : '0';
	if (on && days == '0000000') { U.toast('請至少選一天', 'bad'); return; }
	var v = days + ('0' + t[0]).slice(-2) + ('0' + t[1]).slice(-2);
	U.apply({ sid: 'General;', fields: { reboot_schedule_enable: on ? '1' : '0', reboot_schedule: v }, title: '套用定時重開機？',
		impacts: [on ? '每週' + SY_DAYS.filter(function (d, i) { return days.charAt(i) == '1'; }).join('、') + ' ' + t.join(':') + ' 自動重開機，約 1～2 分鐘不能上網' : '關閉定時重開機', '套用時不會重開機'] });
}

/* ---------- 時間 ---------- */
function sy_time_card() {
	var U = TW, now = typeof uptimeStr == 'string' ? uptimeStr.split('(')[0] : '';
	return U.card({ title: '時間', body: '<dl class="tw-kv"><dt>路由器時間</dt><dd>' + U.esc(now) + '</dd><dt>時區</dt><dd>' + U.esc(NV.tz == 'CCT-8' ? '台北（UTC+8）' : NV.tz) + '</dd>' +
		'<dt>自動對時</dt><dd>' + U.esc([NV.ntp0, NV.ntp1].filter(Boolean).join('、') || '--') + '</dd></dl>' +
		'<div class="tw-small tw-muted">時間會自動和國家時間與頻率標準實驗室（time.stdtime.gov.tw）同步。</div>' +
		'<div class="tw-actions">' + U.button('時區與對時設定', { small: true, ghost: true, href: 'Advanced_System_Content.asp' }) + '</div>' });
}

/* ---------- 燈號、語言、電源 ---------- */
function sy_misc_card() {
	var U = TW;
	var b = '<label class="tw-switch"><input type="checkbox" id="sy-led"' + (NV.led != '0' ? ' checked' : '') + ' onchange="sy_led(this)"><span class="tw-track"></span>路由器燈號</label>' +
		'<div class="tw-help" style="margin-top:-8px">放在臥室嫌亮可以關掉；不影響網路。</div>' +
		'<div class="tw-field"><label for="select_lang">語言（原始設定頁）</label><div class="tw-inline"><select id="select_lang" style="width:auto">' + LANG_OPTS + '</select>' +
		'<input type="hidden" id="preferred_lang" value="' + U.esc(NV.lang) + '">' + U.button('切換', { small: true, onclick: 'submit_language()' }) + '</div>' +
		'<div class="tw-help">新介面目前只有繁體中文；切換語言會影響「進階設定」裡的原始頁面。</div></div>' +
		'<hr class="tw-sep"><div class="tw-actions">' + U.button('重開機', { icon: 'restart', onclick: 'TW.rebootRouter()' }) + U.button('關機', { icon: 'power', onclick: 'shutdown()' }) + U.button('登出', { onclick: 'logout()' }) + '</div>';
	return U.card({ title: '燈號、語言與電源', body: b });
}
function sy_led(el) {
	var v = el.checked ? '1' : '0';
	TW.apply({ sid: 'General;', fields: { front_led_all: v }, title: v == '1' ? '打開燈號？' : '關閉燈號？', impacts: ['只影響路由器前面的燈，網路不會中斷'] })
		.then(function (y) { if (!y) el.checked = !el.checked; });
}
