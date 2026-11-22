/*
 * padavan-tw：黑潮 DNS 的「社群」分頁（移植自 LuCI community.js，功能、用語跟 Windows 設定頁一樣）
 * 注意：httpd 會處理 .js 裡的 ej 標記，這個檔案不能出現小於號接百分號或井號
 */
(function (K) {
	'use strict';
	var U = TW, esc = U.esc;
	var REL = { friend: '好友', out: '等待對方同意', 'in': '待我審核', none: '-' };
	var CHANNEL = { doq: 'DoQ', dot: 'DoT', https: 'HTTPS' };
	var KIND = { node: '節點池', site: '網站驗證', cross: '跨 CDN', upstream: '上游 DNS' };
	var C = { status: null, peers: null, events: null, invite: null };

	function peerState(p) {
		if (p.rel === 'friend') return REL.friend;
		if (p.myBlock) return '已封鎖';
		if (p.theirBlock) return '對方已封鎖你';
		if (p.rel === 'none' && p.rejectedUntil && p.rejectedUntil > Date.now()) return '已拒絕（' + K.time(p.rejectedUntil, 'date') + ' 前不能再請求）';
		if (p.rel === 'none' && p.theirRejectUntil && p.theirRejectUntil > Date.now()) return '對方拒絕（' + K.time(p.theirRejectUntil, 'date') + ' 前不能再請求）';
		if (p.rel === 'none' && p.deletedAt) return '已刪除';
		return REL[p.rel] || p.rel;
	}
	function stateKind(p) {
		if (p.rel === 'friend') return 'ok';
		if (p.rel === 'in') return 'warn';
		if (p.myBlock || p.theirBlock) return 'err';
		return p.rel === 'out' ? 'warn' : 'off';
	}
	function quality(p) {
		var sc = p.scores || {};
		var parts = Object.keys(KIND).map(function (k) {
			var x = sc[k];
			if (!x || !((x.ok || 0) + (x.fail || 0) + (x.invalid || 0))) return null;
			return KIND[k] + ' ' + Math.round(100 * x.score) + '%' + (x.paused ? '（暫停）' : '');
		}).filter(Boolean);
		return parts.length ? parts.join('、') : '-';
	}

	function statusHtml() {
		var st = C.status;
		if (!st) return '<em class="tw-muted">服務沒有在執行，或社群模式沒有啟用：在下方「設定」打開並「儲存並套用」。</em>';
		if (!st.enabled) return '<em class="tw-muted">社群模式沒有啟用：在下方「設定」打開並「儲存並套用」。</em>';
		var c = st.check || {}, ep = st.endpoints || {}, n = st.counts || {};
		var rows = [
			['狀態', st.ready ? K.badge('就緒', 'ok') : K.badge('未就緒', 'err') + '<ul class="kr-ul" id="kuroshio-community-problems">' + (c.problems || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'],
			['網域', esc(st.domain || '-')],
			['公鑰指紋', '<code class="kr-break">' + esc(st.fingerprint || '-') + '</code>'],
			['對外網址', '<span class="kr-break">' + esc([ep.doh, ep.dot, ep.doq].filter(Boolean).join('　') || '-') + '</span>'],
			['憑證', esc(c.cert && c.cert.validTo ? c.cert.validTo + ' 到期（剩 ' + c.cert.daysLeft + ' 天）' : '-')],
			['外部連線', esc(st.externalConfirmed ? '已由 ' + st.externalConfirmed.from + ' 於 ' + K.time(st.externalConfirmed.at) + ' 連入確認' : '還沒有其他節點連進來過（加好友時對方會回連驗證）')],
			['好友', esc('好友 ' + (n.friends || 0) + '　待我審核 ' + (n.incoming || 0) + '　等待對方同意 ' + (n.outgoing || 0) + '　已封鎖 ' + (n.blocked || 0))],
			['自我檢查', K.time(c.at)]
		];
		if (st.txt && st.txt.value && st.domain) rows.push(['TXT 記錄（選用）', '<code class="kr-break">' + esc(st.txt.name + '  TXT  "' + st.txt.value + '"') + '</code><div class="tw-small tw-muted">有設定時好友會多比對一次金鑰（第二管道）；沒設定也可以。</div>']);
		if (st.rotation) rows.push(['金鑰輪替', esc('已換新金鑰，舊金鑰到 ' + K.time(st.rotation.until) + ' 前仍有效（好友會自動更新）')]);
		return K.kv(rows) + '<div class="tw-actions" style="margin-top:12px">' + K.btn('重新檢查', 'act', { arg: '/api/community/check||已重新檢查' }) +
			K.btn('更換金鑰', 'confirm', { danger: true, arg: '更換金鑰|產生新的身分金鑰並通知所有好友（舊金鑰在過渡期內仍有效）。確定要更換嗎？|/api/community/rotate||已更換金鑰並通知好友' }) + '</div>';
	}
	/* 按鈕的參數：路徑|參數（a=b&c=d）|成功訊息 */
	function peerHtml(p) {
		var d = p.domain, info = p.info || {}, st = p.stats || {}, acts = [];
		var b = function (label, path, params, kind, ok, confirmText) {
			var arg = path + '|' + params + '|' + ok;
			return confirmText ? K.btn(label, 'confirm', { arg: label + '|' + confirmText + '|' + arg, danger: kind == 'danger' }) : K.btn(label, 'act', { arg: arg, primary: kind == 'primary', danger: kind == 'danger' });
		};
		var dq = 'domain=' + encodeURIComponent(d);
		if (p.rel === 'in') acts.push(b('同意', '/api/community/accept', dq, 'primary', '已同意'), b('拒絕', '/api/community/reject', dq, '', '已拒絕'),
			b('封鎖', '/api/community/block', dq, 'danger', '已封鎖', '封鎖 ' + d + '？對方之後的請求一律不受理。'));
		else if (p.rel === 'friend') acts.push(b('立即同步', '/api/community/sync', dq, '', '已同步'), b('刪除', '/api/community/delete', dq, 'danger', '已刪除', '刪除好友 ' + d + '？'),
			b('刪除並封鎖', '/api/community/delete', dq + '&block=1', 'danger', '已刪除並封鎖', '刪除並封鎖 ' + d + '？對方之後的請求一律不受理。'));
		else if (p.rel === 'out') acts.push(b('取消', '/api/community/delete', dq, '', '已取消'));
		if (p.myBlock) acts.push(b('解除封鎖', '/api/community/unblock', dq, '', '已解除封鎖'));
		else if (p.rel === 'none') acts.push(b('加好友', '/api/community/add', dq, 'primary', '已送出請求'));
		if (p.pendingKey) acts.push(b('接受新金鑰', '/api/community/accept-key', dq, '', '已接受新金鑰', '確定是 ' + d + ' 本人換的金鑰嗎？新指紋：' + (p.pendingKey.fingerprint || '-')));
		if (p.rel === 'friend') acts.push('<select class="kuroshio-channel" data-domain="' + esc(d) + '" aria-label="指定管道" style="width:auto">' +
			[['', '管道：自動'], ['doq', 'DoQ 優先'], ['dot', 'DoT 優先'], ['https', 'HTTPS 優先']].map(function (o) { return '<option value="' + o[0] + '"' + ((p.preferChannel || '') == o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>');
		var hit = st.tried ? Math.round(100 * (st.ok || 0) / st.tried) + '%（' + st.ok + '/' + st.tried + '）' : '-';
		var kv = [
			['業者 · 機房', (info.asn ? 'AS' + info.asn : '-') + (info.colo ? ' · ' + info.colo : '')],
			['連線品質', info.rttMs != null ? info.rttMs + ' ms（抖動 ' + (info.jitterMs || 0) + '、掉包 ' + (info.lossPct || 0) + '%）' : '-'],
			['最後同步', K.time(p.lastSyncOk)],
			['提供筆數', (st.offered || 0) + (st.invalid ? ' / 違規 ' + st.invalid : '')],
			['命中率', hit], ['資料品質', quality(p)],
			['管道', p.channel ? (CHANNEL[p.channel] || p.channel) + (p.preferChannel ? '（指定 ' + (CHANNEL[p.preferChannel] || p.preferChannel) + '）' : '') : '-'],
			['加入', p.invitedAt ? '透過邀請碼，' + K.time(p.invitedAt) : (p.friendSince ? '成為好友 ' + K.time(p.friendSince) : '-')]
		];
		var notes = [];
		if (p.lastError) notes.push('<div class="tw-small" style="color:var(--bad)">' + esc(p.lastError) + '</div>');
		if (p.oldVersion) notes.push('<div class="tw-small" style="color:var(--warn)">對方版本較舊（v1），每 6 小時重試</div>');
		if (p.pendingKey) notes.push('<div class="tw-small" style="color:var(--warn)">對方換了金鑰，但沒有用舊金鑰簽名：確認是對方本人換的才接受。新指紋 ' + esc(p.pendingKey.fingerprint || '-') + '</div>');
		if (p.autoBlockAt) notes.push('<div class="tw-small tw-muted">自動封鎖於 ' + K.time(p.autoBlockAt) + '</div>');
		return '<div class="kr-peer kuroshio-peer" data-domain="' + esc(d) + '" data-rel="' + esc(p.rel) + '"><div class="tw-inline"><b class="kr-mono kr-break">' + esc(d) + '</b> ' + K.badge(peerState(p), stateKind(p)) +
			(p.fingerprint ? ' <span class="tw-small tw-muted kr-mono">' + esc(String(p.fingerprint).slice(0, 19)) + '…</span>' : '') + '</div>' + notes.join('') +
			'<dl class="kr-peer-kv">' + kv.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>' +
			(acts.length ? '<div class="tw-actions">' + acts.join('') + '</div>' : '') + '</div>';
	}
	function peersHtml() {
		var list = Array.isArray(C.peers) ? C.peers : [];
		return list.length ? list.map(peerHtml).join('') : '<em class="tw-muted">還沒有好友</em>';
	}
	function eventsHtml() {
		var ev = Array.isArray(C.events) ? C.events : [];
		return K.pre(ev.slice(0, 80).map(function (e) { return K.time(e.at, 'sec') + '  ' + e.domain + '  ' + e.type + (e.detail ? '（' + e.detail + '）' : ''); }).join('\n') || '沒有紀錄');
	}
	function inviteHtml() {
		var r = C.invite, res = r && r.result;
		if (!r || r.ok === false || !res || (res.ok === undefined && !res.code)) return '<em class="tw-muted">服務沒有在執行，或社群模式沒有啟用：啟用並「儲存並套用」後才有邀請碼。</em>';
		if (!res.ok) return '<em class="tw-muted">' + esc(res.reason || '無法產生邀請碼') + '</em>';
		var qr = res.qr ? '<img id="kuroshio-invite-qr" class="kr-qr" alt="我的邀請碼 QR 碼" width="160" height="160" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(res.qr) + '">' : '';
		return (res.ready ? '' : K.note('社群模式還沒就緒（' + esc((res.problems || []).join('；')) + '）：好友暫時無法用這個邀請碼加你。', 'warn')) +
			'<div class="kr-invite">' + qr + '<div class="kr-invite-main">' + U.copyField(res.code, '邀請碼') +
			'<p class="tw-small tw-muted">建立於 ' + K.time(res.createdAt) + '　身分指紋 ' + esc(res.fingerprint || '-') + '</p>' +
			'<div class="tw-actions">' + K.btn('重新產生', 'refreshInvite', { danger: true }) + '</div>' +
			'<p class="tw-small tw-muted">邀請碼等同好友密碼：只給想加的好友，可以重複使用；外流時按「重新產生」，舊的立刻失效。</p></div></div>';
	}

	function refresh() {
		return Promise.all([K.api('api', '/api/community/status'), K.api('api', '/api/community/peers'), K.api('api', '/api/community/events')]).then(function (r) {
			C.status = r[0] && r[0].ok !== false ? r[0].result : null;
			C.peers = r[1] && r[1].ok !== false ? r[1].result : null;
			C.events = r[2] && r[2].ok !== false ? r[2].result : null;
			set('kr-comm-status', statusHtml()); set('kr-comm-peers', peersHtml()); set('kr-comm-events', eventsHtml());
		});
	}
	function loadInvite() { return K.api('api', '/api/community/invite').then(function (r) { C.invite = r; set('kuroshio-invite-box', inviteHtml()); }); }
	function set(id, h) { var el = U.$(id); if (el) el.innerHTML = h; }
	/* 送出動作；成功後重新讀取全部面板 */
	function act(path, query, okText) {
		var params = {};
		String(query || '').split('&').filter(Boolean).forEach(function (kv) { var i = kv.indexOf('='); params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
		return K.action(path, params).then(function (r) {
			var res = r && r.result;
			if (!r || r.ok === false) { U.toast((r && r.error) || '操作失敗', 'bad'); return false; }
			if (res && res.ok === false) { U.toast(res.reason || res.error || '操作失敗', 'warn'); return refresh().then(function () { return false; }); }
			U.toast(okText || '完成', 'ok');
			return refresh().then(function () { return true; });
		});
	}

	K.page('community', {
		needDefaults: true,
		render: function () {
			var h = '<p class="tw-lead">跟好友交換台灣節點池、網站驗證結果、上游 DNS。只分享自己驗證過的資料；收到的資料一律在本機驗證後才使用，CDN 官方範圍外的 IP 直接丟掉。</p>';
			h += K.card('我的身分', '<div id="kr-comm-status">' + U.stateBox('loading') + '</div>', { id: 'kuroshio-community-status' });
			h += K.card('好友邀請碼', '<p class="tw-lead">互加好友最快的方法：把「我的邀請碼」傳給朋友，朋友貼到他的黑潮 DNS 就會自動成為好友。雙方都要先符合社群條件（網域、DoH / DoT / DoQ 至少一種、網域解析得到）。</p>' +
				'<h3 class="kr-h3">我的邀請碼</h3><div id="kuroshio-invite-box">' + U.stateBox('loading') + '</div>' +
				'<h3 class="kr-h3">貼上好友的邀請碼</h3><div class="tw-actions"><input type="text" id="kuroshio-invite-input" class="kr-mono" placeholder="KRS1.…" spellcheck="false" autocomplete="off" style="flex:1 1 18em;min-width:0" aria-label="好友的邀請碼">' +
				K.btn('加好友', 'useInvite', { primary: true }) + '</div><div id="kuroshio-invite-out" class="kr-out" role="status"></div>', { id: 'kuroshio-invite' });
			h += K.card('新增好友', '<p class="tw-lead">輸入對方的網域（非標準埠可以寫成 網域:埠）。對方會回連驗證你的網域與憑證；你的出口 IP 必須跟網域解析出的 IP 一樣。</p>' +
				'<div class="tw-actions"><input type="text" id="kuroshio-community-add-input" placeholder="dns.example.net" style="max-width:22em" aria-label="對方的網域">' + K.btn('送出請求', 'add', { primary: true }) + '</div>');
			h += K.card('好友與請求', '<div id="kr-comm-peers">' + U.stateBox('loading') + '</div>');
			h += K.card('事件紀錄', '<div id="kr-comm-events"></div>');
			h += K.card('設定', '<p class="tw-lead">需要先在「基本設定」設好網域、憑證，並打開 DoH 或 DoT 其中一種（共享走同一個加密連線，不另開埠）。</p>' + K.fields([
				{ k: 'community.enabled', t: 'flag', l: '啟用社群模式', def: '0' },
				{ k: 'community.share_domains', t: 'flag', l: '分享網站驗證結果', def: K.def('community.shareDomains') === false ? '0' : '1', d: '只分享網域雜湊，不公開網站名稱。' },
				{ k: 'community.share_upstreams', t: 'flag', l: '分享上游 DNS', def: K.def('community.shareUpstreams') === false ? '0' : '1', d: '好友收到後只當每日評測的候選。' },
				/* 3.4.3 */
				{ k: 'community.use_hints', t: 'flag', l: '使用好友的 CDN 資料', def: K.def('community.useHints') === false ? '0' : '1', d: '好友給的網站驗證結果、跨 CDN 結果、台灣節點只當候選，本機驗證通過才使用。關掉 = 只靠自己找。' },
				{ k: 'community.use_upstreams', t: 'flag', l: '使用好友的上游 DNS', def: K.def('community.useUpstreams') === false ? '0' : '1', d: '好友給的上游只當每日評測的候選（合計最多 100 個），照常經過汙染、封殺、速度檢查。' },
				{ k: 'community.stale_days', t: 'text', l: '好友幾天連不上就自動刪除', v: 'uint', dp: 'community.staleDays' },
				{ k: 'community.reject_days', t: 'text', l: '拒絕後幾天才能再請求', v: 'uint', dp: 'community.rejectDays', pro: 1 },
				{ k: 'community.sync_interval', t: 'text', l: '多久向好友拉一次資料（分鐘）', v: 'uint', dp: 'community.syncIntervalMin', pro: 1 },
				{ k: 'community.max_friends', t: 'text', l: '好友數上限', v: 'uint', dp: 'community.maxFriends', pro: 1, d: '達到上限後，自動同意的請求改成人工審核。' },
				{ k: 'community.min_hit_rate', t: 'text', l: '命中率下限', v: K.range(0, 1, true), dp: 'community.minHitRate', pro: 1, d: '好友給的資料在我這邊驗證成功的比例（0～1），試過 20 次以上還低於下限就暫停採用那一種資料，每 3 天重試一小批。預設 0.3；0 = 不檢查。' },
				{ k: 'community.auto_delete_low_hit_rate', t: 'flag', l: '命中率太低時自動刪除好友', def: K.def('community.autoDeleteLowHitRate') ? '1' : '0', pro: 1, d: '試過 20 次以上還低於命中率下限就自動刪除。' },
				{ k: 'community.pow_bits', t: 'text', l: '好友請求的工作量證明難度', v: 'uint', dp: 'community.powBits', pro: 1, d: '越高越難灌請求，但對方送請求也越久。' }
			]));
			var rules = K.uci.sections('community_rule'), pro = K.isPro();
			var cols = [
				{ k: 'enabled', t: 'flag', l: '啟用', def: '1' },
				{ k: 'name', t: 'text', l: '名稱' },
				{ k: 'action', t: 'select', l: '動作', def: 'accept', opts: [['accept', '同意'], ['manual', '人工審核'], ['reject', '拒絕'], ['block', '封鎖']] },
				{ k: 'domain_suffix', t: 'list', l: '網域結尾', d: '例如 example.net' },
				{ k: 'asn', t: 'list', l: '電信業者 ASN', v: 'uint', d: '例如 3462（中華電信）、4780（Seednet）、9924（台灣固網）、17421（遠傳）' },
				{ k: 'same_asn', t: 'flag', l: '跟我同一家電信業者', def: '0' },
				{ k: 'colo', t: 'list', l: 'Cloudflare 機房', d: '對方自報，例如 TPE、KHH' },
				{ k: 'max_rtt_ms', t: 'text', l: '延遲上限（毫秒）', v: 'uint' },
				{ k: 'max_jitter_ms', t: 'text', l: '抖動上限（毫秒）', v: 'uint' },
				{ k: 'max_loss', t: 'text', l: '掉包率上限（%）', v: K.range(0, 100) },
				{ k: 'min_age_days', t: 'text', l: '對方至少運作幾天', v: 'uint', d: '對方自報，只能證明「至少」' },
				{ k: 'min_mutual', t: 'text', l: '至少幾個共同好友', v: 'uint' },
				{ k: 'max_friends', t: 'text', l: '我的好友數少於', v: 'uint' }
			];
			/* 專業模式才有的條件；簡易模式下已經有規則用到時也顯示（不讓設定藏起來） */
			[['require_ip_match', '來源 IP 要在對方網域的解析結果裡'], ['has_txt', '對方有設定 _kuroshio TXT 記錄']].forEach(function (c) {
				if (!pro && !rules.some(function (r) { return K.uci.has(r.id, c[0]); })) return;
				cols.push({ k: c[0], t: 'flag', l: c[1], def: '0' });
			});
			var ACTN = { accept: '同意', manual: '人工審核', reject: '拒絕', block: '封鎖' };
			h += K.card('自動規則', '<p class="tw-lead">收到好友請求時由上往下比對，第一條「所有有填的條件都符合」的規則決定動作；都不符合就等人工審核。你刪除過的對象一律人工審核。</p>' + K.grid({
				type: 'community_rule', anon: true, quick: 'enabled', addLabel: '新增規則', empty: '沒有自動規則：所有請求都等人工審核', init: [['enabled', '1'], ['action', 'accept']],
				title: function (s) { return K.uci.get(s.id, 'name') || '（未命名規則）'; },
				summary: function (s) { var a = K.uci.get(s.id, 'action') || 'accept'; return K.badge(ACTN[a] || a, a == 'accept' ? 'ok' : a == 'manual' ? 'off' : 'err'); },
				cols: cols
			}));
			return h;
		},
		after: function () {
			refresh(); loadInvite();
			K.every(refresh, 15000);
			var inv = U.$('kuroshio-invite-input'), add = U.$('kuroshio-community-add-input');
			if (inv) inv.addEventListener('keydown', function (e) { if (e.key == 'Enter') { e.preventDefault(); KURO_COMM.useInvite(); } });
			if (add) add.addEventListener('keydown', function (e) { if (e.key == 'Enter') { e.preventDefault(); KURO_COMM.add(); } });
			var box = U.$('kr-comm-peers');
			if (box) box.addEventListener('change', function (e) {
				var sel = e.target;
				if (!sel.classList || !sel.classList.contains('kuroshio-channel')) return;
				e.stopPropagation();
				sel.disabled = true;
				act('/api/community/channel', 'domain=' + encodeURIComponent(sel.getAttribute('data-domain')) + '&channel=' + (sel.value || 'auto'), '已指定管道');
			});
		},
		hooks: { act: {
			act: function (arg) { var p = arg.split('|'); return act(p[0], p[1], p[2]); },
			confirm: function (arg) {
				var p = arg.split('|');
				return U.dialog({ title: p[0], body: '<p>' + esc(p[1]) + '</p>', ok: p[0], danger: true }).then(function (y) { if (y) return act(p[2], p[3], p[4]); });
			},
			add: function () { return KURO_COMM.add(); },
			useInvite: function () { return KURO_COMM.useInvite(); },
			refreshInvite: function () {
				return U.dialog({ title: '重新產生邀請碼？', body: '<p>重新產生後，舊的邀請碼立刻失效（已經加入的好友不受影響）。</p>', ok: '重新產生', danger: true }).then(function (y) {
					if (!y) return;
					return K.action('/api/community/invite/refresh').then(function (x) {
						C.invite = x; set('kuroshio-invite-box', inviteHtml());
						if (x && x.result && x.result.ok) U.toast('已重新產生邀請碼，舊的已失效', 'ok');
					});
				});
			}
		} }
	});

	window.KURO_COMM = {
		add: function () {
			var el = U.$('kuroshio-community-add-input'), d = (el.value || '').trim();
			if (!d) return;
			return act('/api/community/add', 'domain=' + encodeURIComponent(d), '已送出好友請求').then(function (ok) { if (ok) el.value = ''; });
		},
		useInvite: function () {
			var input = U.$('kuroshio-invite-input'), out = U.$('kuroshio-invite-out'), code = (input.value || '').replace(/\s+/g, '');
			if (!code) { out.innerHTML = '<em class="tw-muted">請先貼上好友的邀請碼</em>'; return; }
			out.innerHTML = '<em class="tw-muted">驗證中…（會回連對方確認身分，最多約 30 秒）</em>';
			return K.action('/api/community/invite/use', { code: code }).then(function (r) {
				var d = r && r.result;
				if (!r || r.ok === false || !d) { out.innerHTML = '<p style="color:var(--bad)">' + esc((r && r.error) || '服務沒有在執行，或社群模式沒有啟用') + '</p>'; return; }
				if (d.error && !d.steps) { out.innerHTML = '<p style="color:var(--bad)">' + esc(d.error) + '</p>'; return; }
				var verdict = d.ok ? (d.stage === 'accepted' ? '已成為好友：' + d.domain : '已送出請求，等待 ' + d.domain + ' 審核') : (d.reason || '加好友失敗');
				out.innerHTML = '<div id="kuroshio-invite-result"><ol class="kr-ul">' + (d.steps || []).map(function (s) {
					return '<li>' + K.badge(s.ok ? '完成' : '失敗', s.ok ? 'ok' : 'err') + ' ' + esc(s.text) + '</li>';
				}).join('') + '</ol>' + ((d.problems || []).length ? '<ul class="kr-ul">' + d.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
					'<p><b style="color:' + (d.ok ? 'var(--good)' : 'var(--bad)') + '">' + esc(verdict) + '</b></p></div>';
				if (d.ok) { input.value = ''; return refresh(); }
			});
		}
	};
})(KURO);
