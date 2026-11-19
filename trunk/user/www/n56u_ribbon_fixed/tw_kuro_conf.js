/*
 * padavan-tw：黑潮 DNS 的設定類分頁（基本設定、連線來源、廣告過濾、CDN 台灣節點、進階）
 * 欄位名稱、合法值、預設值照黑潮 DNS v3.2.0 的 LuCI（settings.js、access.js、filter.js、cdn.js、advanced.js）
 * Padavan 不同的地方（docs/HANDOFF-UI.md 13.2、13.4）：
 * - 網域、Token、DDNS、DoT/DoQ/DoH、開放外網、來源模式、日誌等級用 nvram（KuroshioConf），不是 UCI
 * - DNS 接管方式、DNS 埠、管理 API 埠、資料目錄、憑證來源、IP 來源由 kuroshio.sh 決定，不顯示
 * 注意：httpd 會處理 .js 裡的 ej 標記，這個檔案不能出現小於號接百分號或井號
 */
(function (K) {
	'use strict';
	var U = TW, esc = U.esc, FILES = window.KURO_FILES || {};
	var TF = [['0', '關閉'], ['1', '開啟']];

	/* 後台原有的指令機制（只限區網登入），用來看憑證申請的進度（跟舊的黑潮 DNS 頁一樣） */
	function panel(id, html) { var el = U.$(id); if (el) el.innerHTML = html; }

	/* =====================================================================
	 * 基本設定（settings.js）
	 * ===================================================================== */
	var S = { paths: null, ddns: null, status: null, dnr: null };

	function certPanel() {
		var t = S.paths && S.paths.tls, dom = K.nvGet('kuroshio_domain') || '', info = t && t.info, rows = [], state;
		rows.push(['來源', '自動申請（Let’s Encrypt＋Cloudflare DNS 驗證，到期前 30 天自動續期）']);
		if (t) { rows.push(['憑證檔', '<code class="kr-break">' + esc(t.cert || '-') + '</code>']); rows.push(['私鑰檔', '<code class="kr-break">' + esc(t.key || '-') + '</code>']); }
		if (!S.paths) state = K.badge('服務沒有執行，讀不到', 'off');
		else if (t && !t.exists) state = K.badge('還沒有申請到憑證', 'err');
		else if (!info) state = K.badge('還沒有憑證', 'err');
		else if (info.daysLeft < 0) state = K.badge('已經過期', 'err');
		else if (info.daysLeft < 14) state = K.badge('快到期（剩 ' + info.daysLeft + ' 天）', 'warn');
		else state = K.badge('有效（剩 ' + info.daysLeft + ' 天）', 'ok');
		rows.push(['狀態', state]);
		if (info) {
			rows.push(['涵蓋的名稱', esc(info.san || '（沒有 SAN）')]);
			rows.push(['到期', esc(info.validTo || '-')]);
			if (dom) rows.push(['綁定網域', covers(info, dom) ? K.badge('有涵蓋 ' + dom, 'ok') : K.badge('沒有涵蓋 ' + dom + '（用戶端會出現憑證錯誤）', 'err')]);
		}
		return K.kv(rows) + '<div class="tw-actions" style="margin-top:12px">' + K.btn('申請／更新憑證', 'acme', { primary: true }) + K.btn('強制重新申請', 'acme', { arg: 'force' }) + '</div>' +
			'<div class="tw-help">請先「儲存並套用」網域與 Cloudflare API Token。申請約需 1～3 分鐘；同一份憑證也會給路由器後台的 HTTPS 用。</div>' + K.pre('', 'kr-acme-log').replace('class="kr-pre"', 'class="kr-pre" hidden');
	}
	function covers(info, domain) {
		var d = String(domain || '').replace(/\.$/, '').toLowerCase();
		return String((info && info.san) || '').split(', ').some(function (n) {
			if (n.slice(0, 4) !== 'DNS:') return false;
			n = n.slice(4).toLowerCase();
			if (n === d) return true;
			var i = d.indexOf('.');
			return n.slice(0, 2) === '*.' && i > 0 && d.slice(i + 1) === n.slice(2);
		});
	}
	var DDNS_ACTION = { created: '已新增', updated: '已更新', unchanged: '沒有變', deleted: '已移除', kept: '暫時保留', skip: '略過', error: '失敗' };
	function ddnsPanel() {
		var st = S.ddns;
		if (!st) return '<em class="tw-muted">服務沒有執行，無法讀取。</em>';
		if (st.enabled === false) return '<em class="tw-muted">DDNS 沒有啟用（固定網域）：不會更新 DNS 記錄。</em>';
		var bad = function (x) { return K.badge(DDNS_ACTION[x.action] || '失敗', x.action === 'skip' ? 'warn' : 'err') + '<div class="tw-small" style="color:var(--bad)">' + esc(x.error || '') + '</div>'; };
		return (st.error ? K.note('上次更新有錯誤：' + esc(st.error), 'warn') : '') + '<p class="tw-small">上次檢查：' + K.time(st.lastRun) + '</p>' +
			K.table(['出口（網卡）', '類型', '偵測到的 IP', '狀態'], [].concat(st.sources || []).map(function (x) {
				return [esc(x.interface || '自動（預設路由）'), 'IPv' + esc(x.family), esc(x.ip || '-'), x.ok ? K.badge('正常', 'ok') : bad(x)];
			}), '還沒有偵測結果') +
			K.table(['名稱', '類型', '內容', '結果'], [].concat(st.records || []).map(function (x) {
				return [esc(x.name), esc(x.type), esc(x.content || x.ip || '-'), x.ok ? K.badge(DDNS_ACTION[x.action] || x.action || '-', x.action === 'kept' ? 'warn' : 'ok') : bad(x)];
			}), '還沒有更新過');
	}
	function dnrPanel() {
		if (K.valueOfKey('main.dnr') === '0') return '<em class="tw-muted">已關閉：不發布。</em>';
		var d = S.dnr;
		if (!d || d.error && d.ok === false && !d.reason) return '<em class="tw-muted">讀不到 DNR 的判斷結果' + (d && d.error ? '：' + esc(d.error) : '') + '</em>';
		if (d.ok) {
			var P = { h2: 'DoH', h3: 'DoH3', dot: 'DoT', doq: 'DoQ' };
			return K.badge('發布中（DHCPv4 選項 162）', 'ok') + '<p class="tw-small">網域（ADN）：' + esc(d.adn || '-') + '</p>' +
				K.table(['優先順序', '協議', '埠號', '位址', '路徑'], [].concat(d.protocols || []).map(function (x) {
					return [esc(x.priority), esc([].concat(x.alpn || []).map(function (a) { return P[a] || a; }).join(' + ')), esc(x.port), esc([].concat(x.addrs || []).join('、') || '-'), esc(x.dohpath || '-')];
				}), '沒有協議');
		}
		return K.badge('目前沒有發布', 'off') + ' <span id="kuroshio-dnr-reason">' + esc(d.reason || '原因不明') + '</span>';
	}
	function pathsPanel() {
		var p = S.paths;
		if (!p) return '<em class="tw-muted">服務沒有執行，無法讀取。啟用並套用後再回來看。</em>';
		var t = p.tls || {}, code = function (x) { return x ? '<code class="kr-break">' + esc(x) + '</code>' : '<em class="tw-muted">（沒有）</em>'; };
		return K.table(['項目', '位置', '用途'], [
			['設定檔', code('/etc/storage/kuroshio/kuroshio.uci'), '使用者設定（這些頁面修改的就是它）；啟動時複製到 ' + esc(p.configFile || '/tmp/kuroshio') + ' 再加上 nvram 的值'],
			['設定資料夾', code(p.configDir), '憑證、自訂規則、評測名單'],
			['憑證檔', code(t.cert), 'acme.sh 申請的憑證（含中繼憑證，PEM），續期時會更新'],
			['私鑰檔', code(t.key), '憑證的私鑰（PEM）' + (t.key ? ' ' + K.badge('含密鑰，請勿外流', 'warn') : '')],
			['學習資料', code(p.stateDir), '評測結果、節點池、CDN 網域庫、統計'],
			['執行期暫存', code(p.runtimeDir), '放在記憶體，重新開機就清掉'],
			['程式附帶的資料', code(p.shareDir), '內建名單，更新韌體時更新'],
			['自訂規則', code(p.customRules), '自己加的過濾規則'],
			['評測報表', code(p.benchmarkDir), '每日 DNS 評測的報表'],
			['社群金鑰', code(p.communityKeyDir), '好友社群的身分金鑰 ' + K.badge('含密鑰', 'warn')]
		]);
	}
	function encWarn() {
		var enc = ['kuroshio_dot', 'kuroshio_doq', 'kuroshio_doh'].some(function (k) { return K.nvGet(k) == '1'; }), dom = K.nvGet('kuroshio_domain');
		var ddns = K.nvGet('kuroshio_ddns') == '1', tok = K.nvGet('kuroshio_cf_token') || (window.KURO_NV && window.KURO_NV.token_set == '1');
		var w = [];
		if (enc && !dom) w.push('加密 DNS（DoT／DoQ／DoH）需要網域與憑證，請先填網域。');
		if (ddns && (!dom || !tok)) w.push('DDNS 需要網域與 Cloudflare API Token。');
		return w.length ? K.note(esc(w.join(' ')), 'warn') : '';
	}

	K.page('settings', {
		needDefaults: true,
		render: function () {
			var h = '';
			h += K.card('服務', K.fields([
				{ k: 'nv:kuroshio_enable', t: 'flag', l: '啟用黑潮 DNS', def: '0', d: '開啟後由路由器的 DNS（dnsmasq）轉給黑潮 DNS；黑潮 DNS 沒有回應時會自動暫時改用業者 DNS，不會斷網。' },
				{ k: 'main.ddr', t: 'flag', l: '自動發現（DDR）', def: '0', d: '區網裝置（Windows 11、iPhone、Mac）會自動改用 DoH / DoT / DoQ 加密連線，不用手動設定。需要設定網域並開啟至少一種加密協議。' },
				{ k: 'main.dnr', t: 'flag', l: '用 DHCP 通知加密 DNS（DNR）', def: '1', d: 'RFC 9463：在 DHCP 裡告訴區網裝置這台路由器有加密 DNS，裝置不用先查詢就能改用加密連線。要有綁定網域、涵蓋網域的有效憑證才會發布；條件不符就不發。' },
				{ k: '_dnr', t: 'html', l: 'DNR 目前狀態', html: function () { return '<div id="kr-dnr">' + dnrPanel() + '</div>'; } },
				{ k: 'nv:kuroshio_log', t: 'select', l: '日誌等級', def: 'warn', opts: [['warn', '只記警告與錯誤（建議）'], ['info', '一般'], ['debug', '除錯（很多）']] },
				{ k: 'main.query_log', t: 'flag', l: '記錄每筆查詢', def: '0', pro: 1, d: '寫進系統日誌，除錯用。會很快洗掉日誌緩衝區。' },
				{ k: 'main.allow_from', t: 'list', l: '允許查詢的來源', v: 'cidr', ph: '192.168.0.0/16', pro: 1, d: '區網 DNS 只回答這些網段（空白用預設的私有網段）。' }
			]) + '<p class="tw-small tw-muted">DNS 接管方式固定為「作為 dnsmasq 的上游」（dnsmasq 照常處理 DHCP 與區網主機名稱）；埠號與資料目錄由韌體決定。</p>');

			h += K.card('記憶體與儲存', '<p class="tw-lead">記憶體有空就多用（快取、CDN 資料庫、過濾清單），系統可用記憶體低於保留量就依序讓出來，DNS 轉送永遠不停；同時連線數依 CPU 核心數自動決定。</p>' + (K.isPro() ? K.fields([
				{ k: 'system.persist_max_age_hours', t: 'text', l: '最久未存（小時）', v: K.range(1, 24), ph: '24', d: '學到的資料至少每隔這麼久一定存一次（最多 24 小時）。越小，斷電時遺失越少，但 Flash 寫入越多。' },
				{ k: 'system.storage_reserve_mb', t: 'text', l: '儲存保留空間（MB）', v: 'uint', ph: '0', d: 'Flash 至少留這麼多給系統。空間在保留量以上時，可重建的資料大方留著；低於保留量就依序刪日誌 → 清單副本 → 可重建的資料，核心資料絕不自動刪除。0 = 自動（max(1 MB, 10%)）。' },
				{ k: 'system.storage_reserve_percent', t: 'text', l: '儲存保留空間（%）', v: K.range(0, 90), ph: '0', d: '檔案系統大小的百分比（最多 90）；跟 MB 都填取大的。' },
				{ k: 'system.memory_governor', t: 'flag', l: '記憶體控制', def: '1', d: '系統可用記憶體低於保留量時依序讓出：診斷緩衝 → DNS 快取 → CDN 冷資料移到 Flash → 優先順序最低的過濾清單 → 只轉送 → 最後才暫停保護清單。寬裕後依相反順序恢復。' },
				{ k: 'system.memory_reserve_mb', t: 'text', l: '記憶體保留量（MB）', v: 'uint', ph: '0', dep: { 'system.memory_governor': '1' }, d: '0 = 自動：max(16 MB, 實體記憶體 5%, min_free_kbytes × 3)。' },
				{ k: 'system.memory_reserve_percent', t: 'text', l: '記憶體保留量（%）', v: K.range(0, 90), ph: '0', dep: { 'system.memory_governor': '1' }, d: '實體記憶體的百分比；跟 MB 都填取大的。' },
				{ k: 'system.oom_score_adj', t: 'text', l: 'OOM 分數調整', v: K.range(-1000, 1000), ph: '-500', d: '記憶體用完時核心挑誰停掉：負數 = 不優先挑本程式（DNS 停了等於斷網）。-1000 = 完全豁免（不建議）。' }
			]) : '<p class="tw-small tw-muted">調整方式：自動（依系統可用記憶體與 CPU 核心數）。切換到「專業」可以調整保留量。</p>'));

			h += K.card('網域與憑證', '<p class="tw-lead">DoH / DoT / DoQ、DDNS、社群共用同一個網域。網域要放在 Cloudflare 管理；只在家裡用過濾功能的話可以不填。</p>' + K.fields([
				{ k: 'nv:kuroshio_domain', t: 'text', l: '綁定網域', v: 'domain', ph: 'dns.example.com', d: '固定網域或 DDNS 名稱。WireGuard 的連線位址也會用它。' },
				{ k: 'nv:kuroshio_cf_token', t: 'pass', l: 'Cloudflare API Token', ph: window.KURO_NV && window.KURO_NV.token_set == '1' ? '已設定（留空表示不變）' : '', d: '到 Cloudflare 後台「我的設定檔 → API 權杖」建立，權限：區域 → DNS → 編輯、區域 → 區域 → 讀取。DDNS 與申請憑證共用。' },
				{ k: 'nv:kuroshio_acme_email', t: 'text', l: '憑證通知信箱（選填）', v: 'email', d: '憑證到期通知用，可留空。' },
				{ k: '_cert', t: 'html', l: '目前憑證', html: function () { return '<div id="kr-cert">' + certPanel() + '</div>'; } }
			]) + '<div id="kr-encwarn">' + encWarn() + '</div>');

			h += K.card('加密 DNS', '<p class="tw-lead">要有網域與憑證。Android「私人 DNS」用 DoT；瀏覽器、iPhone 描述檔用 DoH；AdGuard 系列 App 支援 DoQ。記憶體 200 MB 以下的路由器不會開 QUIC（DoQ、DoH3）。</p>' + K.fields([
				{ k: 'nv:kuroshio_dot', t: 'flag', l: 'DoT（853 埠）', def: '0' },
				{ k: 'nv:kuroshio_doq', t: 'flag', l: 'DoQ（853 埠 UDP）', def: '0' },
				{ k: 'nv:kuroshio_doh', t: 'flag', l: 'DoH／DoH3', def: '0', d: '網址是 https://網域/dns-query。DoH3（HTTP/3）跟著 DoH 一起開。' },
				{ k: 'nv:kuroshio_doh_port', t: 'text', l: 'DoH 在路由器上的埠', v: 'port', ph: '8443', dep: { 'nv:kuroshio_doh': '1' }, d: '後台通常已經佔用 443，所以預設聽 8443，再由防火牆把外網的埠轉過來。' },
				{ k: 'nv:kuroshio_wan', t: 'flag', l: '開放給外面使用', def: '0', d: '手機在外面也能用家裡的加密 DNS。誰可以連進來看「連線來源」分頁（預設只開放台灣 IP）；路由器自動開放對應的埠。' },
				{ k: 'nv:kuroshio_doh_wan_port', t: 'text', l: 'DoH 對外的埠', v: 'port', ph: '443', dep: { 'nv:kuroshio_doh': '1', 'nv:kuroshio_wan': '1' }, d: '外面連這個埠會轉到路由器上的 DoH 埠。預設 443（網址就不用寫埠號）。' },
				{ k: 'doh.trust_proxy', t: 'flag', l: 'DoH：信任 X-Forwarded-For', def: '0', pro: 1, d: '只有前面還有反向代理時才打開，否則用戶端可以偽造來源 IP。' },
				{ k: 'doh.tls', t: 'select', l: 'DoH 自己做 TLS', def: 'auto', pro: 1, opts: [['auto', '自動（有憑證就用 TLS）'], ['1', '開啟（一律 TLS）'], ['0', '關閉（純 HTTP，TLS 交給前面的反向代理）']] },
				{ k: 'doh.host', t: 'text', l: 'DoH 監聽位址', v: 'ip', ph: '0.0.0.0', pro: 1, d: '下面的「多個監聽位址」有填時不使用這一欄。' },
				{ k: 'doh.binds', t: 'list', l: 'DoH 多個監聽位址', v: 'ip', ph: '0.0.0.0', pro: 1, d: '有填就取代「監聽位址」。IPv4 與 IPv6 可以同時寫（0.0.0.0 與 ::）。其中一個綁定失敗只記警告，其他照常。' },
				{ k: 'doh.http3_binds', t: 'list', l: 'DoH3 的監聽位址', v: 'ip', pro: 1, d: '空白 = 跟 DoH 同樣的位址。' },
				{ k: 'dot.binds', t: 'list', l: 'DoT 多個監聽位址', v: 'ip', pro: 1, d: '空白 = 0.0.0.0（所有 IPv4 位址）。' },
				{ k: 'doq.binds', t: 'list', l: 'DoQ 多個監聽位址', v: 'ip', pro: 1, d: '空白 = 0.0.0.0（所有 IPv4 位址）。' },
				{ k: '_listeners', t: 'html', l: '目前的監聽狀態', html: function () { return '<div id="kr-listeners">' + (S.status ? K.listenerTable(S.status.listenersDetail) : '<em class="tw-muted">服務沒有執行，無法讀取。</em>') + '</div>'; }, d: '實際綁定的位址（已套用的設定）；綁定失敗會列出原因。' }
			]));

			h += K.card('DDNS（網域的 IP 由誰更新）', '<p class="tw-lead">固定網域：IP 不會變，或已經由其他服務在更新。自動更新：公網 IP 變了就更新 Cloudflare 的 DNS 記錄；IP 來源由韌體依 WAN 自動決定（WAN 拿到公網 IP 就直接讀網卡，否則上網查）。</p>' + K.fields([
				{ k: 'nv:kuroshio_ddns', t: 'select', l: '更新方式', def: '0', opts: [['0', '固定網域，不需要更新'], ['1', '由黑潮 DNS 自動更新（DDNS，Cloudflare）']] },
				{ k: 'ddns.record', t: 'list', l: '要更新的記錄', v: 'hostname', dep: { 'nv:kuroshio_ddns': '1' }, d: '完整網域名稱，例如 home.example.com。空白 = 用綁定網域。記錄不存在會自動建立。' },
				{ k: 'ddns.ipv4', t: 'flag', l: '發布 IPv4（A）', def: '1', dep: { 'nv:kuroshio_ddns': '1' } },
				{ k: 'ddns.ipv6', t: 'flag', l: '發布 IPv6（AAAA）', def: '0', dep: { 'nv:kuroshio_ddns': '1' }, d: '預設關閉：不少線路（例如中華電信）會擋外面連進來的 IPv6，發布了別人反而連不上。確定外面連得進來再打開。' },
				{ k: 'ddns.interval', t: 'text', l: '檢查間隔（分鐘）', v: K.range(1, 1440), ph: '5', dep: { 'nv:kuroshio_ddns': '1' } },
				{ k: 'ddns.proxied', t: 'flag', l: '經過 Cloudflare 代理（橘色雲朵）', def: '0', pro: 1, dep: { 'nv:kuroshio_ddns': '1' }, d: 'DoT 不能經過代理，給 DoH / DoT 用的記錄請保持關閉。' },
				{ k: 'ddns.ttl', t: 'text', l: 'TTL（秒）', v: 'uint', ph: '1', pro: 1, dep: { 'nv:kuroshio_ddns': '1' }, d: '1 = 自動' },
				{ k: 'ddns.zone', t: 'text', l: 'Zone', v: 'hostname', pro: 1, dep: { 'nv:kuroshio_ddns': '1' }, d: '空白 = 從記錄名稱自動判斷' },
				{ k: 'ddns.force_hours', t: 'text', l: '強制確認間隔（小時）', v: 'uint', ph: '24', pro: 1, dep: { 'nv:kuroshio_ddns': '1' }, d: 'IP 沒變時多久重新向 Cloudflare 確認一次記錄。' },
				{ k: 'ddns.url4', t: 'text', l: 'IPv4 查詢網址', v: 'url', ph: 'https://1.1.1.1/cdn-cgi/trace', pro: 1, dep: { 'nv:kuroshio_ddns': '1' } },
				{ k: 'ddns.url6', t: 'text', l: 'IPv6 查詢網址', v: 'url', ph: 'https://[2606:4700:4700::1111]/cdn-cgi/trace', pro: 1, dep: { 'nv:kuroshio_ddns': '1' } },
				{ k: '_ddns', t: 'html', l: '目前發布的結果', html: function () { return '<div id="kr-ddns">' + ddnsPanel() + '</div>'; } }
			]) + '<div class="tw-actions">' + K.btn('立即更新', 'ddnsNow', { disabled: K.nvGet('kuroshio_ddns') != '1' }) + '<span class="tw-cost">DDNS 開啟、套用後，服務執行中才能使用</span></div>');

			if (K.isPro()) h += K.card('公開網頁', '<p class="tw-lead">Windows 版的官網與統計頁。路由器上建議關閉，改用這裡的儀表板；關閉不影響 DoH。</p>' + K.fields([
				{ k: 'site.enabled', t: 'flag', l: '啟用', def: '0' },
				{ k: 'site.min_clients', t: 'text', l: '排行最少人數', v: K.range(1, 1e9), dp: 'site.minClients', dep: { 'site.enabled': '1' }, d: '公開頁的網站排行只列出至少這麼多位不同使用者造訪過的網站。後台的儀表板不受限制。' }
			]));

			h += K.card('存放位置', '<p class="tw-lead">各種檔案實際放在哪裡（已套用的設定）。這裡只顯示路徑，不會顯示密鑰內容。</p><div id="kr-paths">' + U.stateBox('loading') + '</div>', { id: 'kuroshio-paths' });
			return h;
		},
		after: function () {
			Promise.all([K.view('/api/paths'), K.view('/api/ddns'), K.view('/api/status', { lite: 1 }), K.api('dnr')]).then(function (r) {
				S.paths = r[0]; S.ddns = r[1]; S.status = r[2]; S.dnr = r[3];
				panel('kr-cert', certPanel()); panel('kr-ddns', ddnsPanel()); panel('kr-dnr', dnrPanel()); panel('kr-paths', pathsPanel());
				panel('kr-listeners', S.status ? K.listenerTable(S.status.listenersDetail) : '<em class="tw-muted">服務沒有執行，無法讀取。</em>');
			});
		},
		hooks: {
			onchange: function () { panel('kr-encwarn', encWarn()); panel('kr-dnr', dnrPanel()); },
			act: {
				ddnsNow: function () {
					return K.action('/api/ddns/update').then(function (r) {
						var st = K.done(r);
						if (!st) return;
						S.ddns = st.sources || st.records ? st : S.ddns;
						U.toast(st.error || 'DDNS 已更新', st.error ? 'warn' : 'ok');
						panel('kr-ddns', ddnsPanel());
					});
				},
				acme: function (force) {
					if (K.changes()) { U.toast('請先「儲存並套用」，再申請憑證', 'warn'); return; }
					return U.dialog({ title: '申請憑證？', body: '<p>用 Cloudflare DNS 驗證向 Let’s Encrypt 申請 ' + esc(K.nvGet('kuroshio_domain') || '（還沒填網域）') + ' 的憑證，約 1～3 分鐘。</p>', ok: '開始申請' }).then(function (y) {
						if (!y) return;
						var out = U.$('kr-acme-log');
						out.hidden = false; out.textContent = '啟動中…';
						return K.api('acme', null, null, true, force ? '&q=force' : '').then(function (r) {
							if (!r || r.ok === false) { out.textContent = (r && r.error) || '無法啟動'; return; }
							/* op=acme-log：{ok, running, log}（kuroshio.sh acme-log-json；只給區網／VPN 登入的人） */
							var n = 0, tick = function () {
								K.api('acme-log').then(function (r) {
									if (!r || r.ok === false) { out.textContent = (r && r.error) || '讀不到進度'; return; }
									var t = r.log || '';
									out.textContent = t || '（還沒有輸出）';
									if (r.running || (!t && n < 3)) { n++; setTimeout(tick, 4000); }
									else K.view('/api/paths').then(function (p) { S.paths = p || S.paths; var c = U.$('kr-cert'); if (c) { var keep = out.textContent; c.innerHTML = certPanel(); var o2 = U.$('kr-acme-log'); o2.hidden = false; o2.textContent = keep; } });
								});
							};
							setTimeout(tick, 2500);
						});
					});
				}
			}
		}
	});

	/* =====================================================================
	 * 連線來源（access.js）
	 * ===================================================================== */
	var KIND = { dot: 'DoT', doh: 'DoH', doq: 'DoQ', doh3: 'DoH3', site: '公開頁', community: '社群共享', plain: '區網 DNS（53 埠）' };
	var APPLY_DEFAULT = ['dot', 'doh', 'doq', 'doh3', 'site'];
	var MODE = { taiwan: '只開放台灣', custom: '自訂 ISP', open: '全開放' };
	var A = { acc: null };
	function wan(n) { return n >= 10000 ? K.fmtNum(Math.floor(n / 10000)) + ' 萬' : K.fmtNum(n); }

	/*
	 * 勾選清單（UCI 的 list）：all＝「全選」的值（'*'）；dflt＝沒寫時的預設。
	 * 一項都不勾時寫 list xxx ''（有這個選項、內容是空的＝一項都不要；直接刪掉會變回預設）
	 */
	function checkList(o) {
		var sec = o.k.split('.')[0], opt = o.k.split('.')[1];
		var has = K.uci.has(sec, opt), cur = has ? K.uci.list(sec, opt).filter(function (x) { return x !== ''; }) : (o.dflt || []).slice();
		var star = o.all != null && cur.indexOf(o.all) >= 0, h = '<div class="kr-checklist" data-cl="' + esc(o.k) + '">';
		if (o.all != null) h += '<label class="kr-check kr-check-all"><input type="checkbox" data-all="1" value="' + esc(o.all) + '"' + (star ? ' checked' : '') + '><span><b>' + esc(o.allLabel) + '</b><small>' + esc(o.allDesc || '') + '</small></span></label>';
		o.items.forEach(function (it) { h += '<label class="kr-check"><input type="checkbox" value="' + esc(it.id) + '"' + (star || cur.indexOf(it.id) >= 0 ? ' checked' : '') + '><span>' + it.body + '</span></label>'; });
		cur.forEach(function (v) {
			if (v === o.all || o.items.some(function (it) { return it.id === v; })) return;
			h += '<label class="kr-check"><input type="checkbox" value="' + esc(v) + '" checked><span><b>' + esc(v) + '</b> ' + K.badge(o.missingText || '不認得', 'warn') + '</span></label>';
		});
		return h + '<div class="tw-note tw-s-warn kr-cl-none"' + (cur.length ? ' hidden' : '') + '>' + esc(o.noneText || '一項都沒有勾') + '</div></div>';
	}
	var CL = {};
	function bindCheckLists() {
		[].forEach.call(document.querySelectorAll('[data-cl]'), function (box) {
			box.addEventListener('change', function (ev) {
				var o = CL[box.getAttribute('data-cl')], all = box.querySelector('input[data-all]'), t = ev.target;
				ev.stopPropagation();
				var items = [].slice.call(box.querySelectorAll('input[type=checkbox]:not([data-all])'));
				if (t === all && all.checked) items.forEach(function (c) { c.checked = true; });
				else if (t !== all && all) all.checked = false;
				var v = all && all.checked ? [o.all] : items.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
				box.querySelector('.kr-cl-none').hidden = v.length > 0;
				var sec = o.k.split('.')[0], opt = o.k.split('.')[1], dflt = o.dflt || [];
				var same = function (a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); };
				if (same(v, dflt)) K.uci.unset(sec, opt); else K.uci.setList(sec, opt, v.length ? v : ['']);
				K.refresh();
			});
		});
	}
	function accessStatus() {
		var acc = A.acc, pro = K.isPro();
		if (!acc) return '<em class="tw-muted">服務沒有執行，無法讀取。</em>';
		var groups = acc.groups || [], dn = acc.denied || {}, by = dn.byListener || {}, on = groups.filter(function (g) { return g.enabled; });
		var rows = [
			['開放對象', esc((MODE[acc.mode] || acc.mode || '-') + (acc.mode === 'custom' && groups.length ? '（開放 ' + on.length + ' / ' + groups.length + ' 組）' : ''))],
			['套用在', esc([].concat(acc.applyTo || []).map(function (k) { return KIND[k] || k; }).join('、') || '（沒有，不限制）')],
			['台灣 IP 資料', acc.generatedAt ? esc(acc.generatedAt + ' 的資料（' + (acc.dataOrigin || '公版') + '）') + ' ' + (acc.autoUpdate || acc.localUpdate ? K.badge('每月在本機更新', 'ok') : K.badge('跟著韌體更新', 'off')) + (acc.update && acc.update.text ? ' ' + esc(acc.update.text) : '') : K.badge('讀不到', 'err')],
			['已拒絕', esc(K.fmtNum(dn.total) + ' 次' + (dn.total ? '（' + Object.keys(by).filter(function (k) { return by[k]; }).map(function (k) { return (KIND[k] || k) + ' ' + K.fmtNum(by[k]); }).join('、') + '）' : ''))],
			pro ? ['記憶體', esc(((acc.memoryBytes || 0) / 1024).toFixed(1) + ' KB（' + K.fmtNum(acc.ranges) + ' 個區間）')] : null
		];
		var top = [].concat(acc.topDenied || []).slice(0, 20);
		return (acc.failOpen ? K.note('台灣 IP 資料讀不到，現在不擋任何來源（封鎖名單照樣有效）' + (acc.warning ? '：' + esc(acc.warning) : ''), 'bad') : (acc.warning ? K.note(esc(acc.warning), 'warn') : '')) +
			K.kv(rows) + '<h3 class="kr-h3">被拒絕最多的網段</h3>' +
			K.table(['網段', '次數', ''], top.map(function (t) {
				return [esc(t.net), K.fmtNum(t.count), K.btn('加入封鎖', 'addNet', { arg: 'deny|' + t.net, danger: true }) + ' ' + K.btn('加入允許', 'addNet', { arg: 'allow|' + t.net })];
			}), '還沒有拒絕過任何連線', [1]) + (top.length ? '<p class="tw-small tw-muted">IPv4 以 /24、IPv6 以 /48 為單位統計。</p>' : '');
	}
	K.page('access', {
		needDefaults: true,
		render: function () {
			var acc = A.acc, groups = (acc && acc.groups) || [], pro = K.isPro();
			CL = {};
			var gopt = { k: 'access.groups', all: '*', dflt: ['*'], allLabel: '全選（含日後新增的 ISP）', allDesc: '台灣 IP 資料更新後新加入的業者也自動開放。',
				noneText: '一組都沒有勾：只剩區網、好友與允許名單可以連進來。', missingText: groups.length ? '資料裡沒有這一組，不會生效' : '已勾選（讀不到 ISP 清單）',
				items: groups.map(function (g) {
					var sz = g.size || {}, b = '<b>' + esc(g.name || g.id) + '</b> ' + (sz.v4 ? K.badge(wan(sz.v4) + ' 個位址', 'off') : K.badge('目前沒有網段', 'warn'));
					if (pro) {
						var asns = [].concat(g.asns || []), inNote = g.note && asns.every(function (n) { return g.note.indexOf(String(n)) >= 0; });
						if (g.note) b += '<small>' + esc(g.note) + '</small>';
						b += '<small class="kr-mono">' + esc(g.id + (asns.length && !inNote ? ' · ' + asns.map(function (n) { return 'AS' + n; }).join('、') : '') + ' · ' + K.fmtNum((g.cidrs || {}).v4) + ' 個 IPv4 網段、' + K.fmtNum((g.cidrs || {}).v6) + ' 個 IPv6 網段') + '</small>';
					}
					return { id: g.id, body: b };
				}) };
			CL[gopt.k] = gopt;
			var aopt = { k: 'access.apply_to', dflt: APPLY_DEFAULT, noneText: '一項都沒有勾：不限制任何服務。', items: ['dot', 'doh', 'doq', 'doh3', 'site', 'community', 'plain'].map(function (k) { return { id: k, body: esc(KIND[k]) }; }) };
			CL[aopt.k] = aopt;
			var h = '<p class="tw-lead">誰可以連進 DoH / DoT / DoQ / DoH3 與公開頁。黑潮 DNS 是為台灣網路調校的 DNS，在國外使用沒有好處，所以預設只讓台灣的 IP 連進來，順便擋掉國外的掃描與濫用。只影響從外面連進來的連線，不影響路由器與區網。</p>';
			h += K.card('目前狀態', '<p class="tw-small tw-muted">已套用的設定。拒絕的次數從服務啟動後開始算。</p><div id="kr-acc-status">' + (acc ? accessStatus() : U.stateBox('loading')) + '</div>', { id: 'kuroshio-access-status' });
			h += K.card('開放對象', '<p class="tw-lead">區網與私有位址、路由器自己、社群好友目前的 IP 一律允許，不用加進名單。人在國外、手機漫遊、用國外的 VPN 出口時連不進來：把那個 IP 加進下面的允許名單，或改成全開放。</p>' + K.fields([
				{ k: 'nv:kuroshio_access', t: 'radio', l: '誰可以連進來', def: 'taiwan', opts: [['taiwan', '只開放台灣（建議）', '台灣各家 ISP 與其他登記在台灣的網段都能連，國外的來源連不進來。'], ['custom', '自訂 ISP', '只開放下面勾選的業者，例如只給中華電信與學術網路。'], ['open', '全開放', '任何來源都能連（封鎖名單照樣有效）。']] },
				{ k: '_groups', t: 'html', l: '開放的 ISP', dep: { 'nv:kuroshio_access': 'custom' }, html: function () { return checkList(gopt); },
					d: '全部勾選 = 整個台灣。業者合併後網段會慢慢移到併購方，兩組都保留；大小是 0 表示已經全部移過去。' + (groups.length ? '' : ' 服務沒有執行或讀不到台灣 IP 資料，無法列出 ISP。') }
			]));
			h += K.card('自訂名單', '<p class="tw-lead">一行一個 IP 或網段（CIDR），IPv4 與 IPv6 都可以，例如 203.0.113.7、198.51.100.0/24、2001:db8::/32。</p>' + K.fields([
				{ k: 'access.allow', t: 'list', l: '允許名單', v: 'cidr', ph: '203.0.113.0/24', d: '不管上面選哪一種都放行，例如人在國外的家人、公司的固定 IP、國外的監測服務。' },
				{ k: 'access.deny', t: 'list', l: '封鎖名單', v: 'cidr', ph: '198.51.100.7', d: '優先於一切（本機除外）：區網、好友、允許名單、全開放都擋不住它。' }
			]));
			h += K.card('測試 IP', '<p class="tw-lead">輸入一個 IP，看它能不能連進來、是哪一條規則決定的（依已套用的設定，還沒套用的變更不算）。</p>' +
				'<div class="tw-actions"><input type="text" id="kuroshio-access-ip" placeholder="168.95.1.1" style="max-width:18em" aria-label="要測試的 IP">' + K.btn('測試', 'testIp', { primary: true, id: 'kuroshio-access-test' }) + '</div><div id="kuroshio-access-result" class="kr-out" role="status"></div>');
			h += K.card('台灣 IP 資料', K.fields([
				{ k: 'access.local_update', t: 'flag', l: '每月在本機重新產生台灣 IP 資料', def: '1', d: '排程工作「台灣 IP 清單」：每月一次（每台路由器錯開時間），慢慢向 RIR 與 RIPEstat 的公開資料查詢，在路由器上算出新的清單；不連本專案的任何伺服器。失敗就繼續用目前的清單；內容有變才寫入 Flash（約每月一次）。不開的話跟著韌體更新。' },
				{ k: 'access.data_file', t: 'text', l: '指定資料檔', v: 'path', pro: 1, d: '空白 = 韌體附帶的 /usr/share/kuroshio/geo/tw-ip.json。' },
				{ k: '_apply_to', t: 'html', l: '套用在哪些服務', pro: 1, html: function () { return checkList(aopt); }, d: '社群共享預設不套用（好友的 IP 本來就一律允許）；區網 DNS（53 埠）有「允許查詢的來源」另外把關。全部取消 = 不限制任何服務。' },
				{ k: 'access.log', t: 'flag', l: '拒絕時寫進日誌', def: '1', pro: 1, d: '每分鐘最多一行，含這一分鐘被拒絕的次數。' }
			]));
			return h;
		},
		after: function () {
			bindCheckLists();
			var ip = U.$('kuroshio-access-ip');
			if (ip) ip.addEventListener('keydown', function (e) { if (e.key == 'Enter') { e.preventDefault(); U.$('kuroshio-access-test').click(); } });
			if (!A.loaded) K.view('/api/access').then(function (x) { A.acc = x; A.loaded = true; if (K.current() == 'access' && !K.changes()) K.render(); else panel('kr-acc-status', accessStatus()); });
		},
		hooks: { act: {
			addNet: function (arg) {
				var p = arg.split('|'), opt = p[0], net = p[1], cur = K.uci.list('access', opt);
				if (cur.indexOf(net) < 0) { cur.push(net); K.uci.setList('access', opt, cur); }
				var el = document.querySelector('[data-kf="access.' + opt + '"]');
				if (el) el.value = cur.join('\n');
				K.refresh();
				U.toast('已把 ' + net + ' 加到' + (opt == 'deny' ? '封鎖名單' : '允許名單') + '（按「儲存並套用」才會生效）', 'ok');
			},
			testIp: function () {
				var ip = U.$('kuroshio-access-ip').value.trim(), out = U.$('kuroshio-access-result');
				if (!(K.isIp4(ip) || K.isIp6(ip))) { out.innerHTML = K.badge('請輸入一個 IP 位址（不含前綴長度與埠號）', 'warn'); return; }
				out.innerHTML = '<em class="tw-muted">查詢中…</em>';
				return K.view('/api/access', { ip: ip }).then(function (x) {
					if (!x) { out.innerHTML = K.badge('服務沒有回應', 'err'); return; }
					var kinds = [].concat(x.applyTo || []).map(function (k) { return KIND[k] || k; }).join('、');
					out.innerHTML = K.badge(x.allowed ? '可以連進來' : '會被擋下', x.allowed ? 'ok' : 'err') + ' ' + esc((x.reason || '') + (kinds ? '（套用在 ' + kinds + '）' : ''));
				});
			}
		} }
	});

	/* =====================================================================
	 * 廣告過濾（filter.js，含 3.2.0 的恢復預設清單、恢復預設自訂規則）
	 * ===================================================================== */
	var CAT = { ads: '廣告 / 追蹤', telemetry: '遙測 / 驗證', malware: '惡意 / 詐騙' };
	/*
	 * 恢復預設清單的比對：黑潮 3.3.0 起用韌體附的 KuroshioUiCore（跟 LuCI 同一份，K.core()）；
	 * 3.2.x 韌體沒有那個檔，用下面這份（照 3.2.0 LuCI common.js 移植，同一份規則）
	 */
	function planner(core) {
		if (core && typeof core.restorePlan === 'function' && typeof core.restoreSummary === 'function') return {
			plan: core.restorePlan,
			summary: function (ch) {
				var s = core.restoreSummary(ch);
				if (s.empty) return '<p class="kuroshio-restore-none">' + esc(s.empty) + '</p>';
				return '<div class="kuroshio-restore-list">' + s.blocks.map(function (b) {
					return '<div class="kuroshio-restore-' + esc(b.cls) + '"><b>' + esc(b.title) + '</b><ul class="kr-ul">' + b.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
				}).join('') + '</div>';
			}
		};
		return { plan: restorePlan, summary: restoreSummary };
	}
	/* 跟 LuCI common.js 的 restorePlan 同一份規則：先用網址、再用名稱對應；網址不在預設裡的是自己加的 */
	function restorePlan(cur, defs, removeOwn) {
		var norm = function (x) {
			var p = x.protect;
			return { name: String(x.name || ''), url: String(x.url || '').trim(), category: x.category || 'ads', enabled: x.enabled !== false,
				protect: (p === undefined || p === null || p === '') ? undefined : !!p, ref: x.ref };
		};
		cur = (cur || []).map(norm); defs = (defs || []).map(norm);
		var used = cur.map(function () { return false; }), match = defs.map(function () { return -1; });
		var find = function (test) { for (var j = 0; j < cur.length; j++) if (!used[j] && test(cur[j])) { used[j] = true; return j; } return -1; };
		defs.forEach(function (d, i) { match[i] = find(function (c) { return c.url === d.url; }); });
		defs.forEach(function (d, i) { if (match[i] < 0) match[i] = find(function (c) { return c.name !== '' && c.name === d.name; }); });
		var defUrl = {};
		defs.forEach(function (d) { defUrl[d.url] = true; });
		var ch = { add: [], remove: [], url: [], enabled: [], other: [], keep: [], reorder: false, count: 0 }, result = [];
		defs.forEach(function (d, i) {
			var j = match[i];
			result.push({ def: d, from: j });
			if (j < 0) { ch.add.push(d); return; }
			var c = cur[j], o = [];
			if (c.url !== d.url) ch.url.push({ name: d.name, from: c.url, to: d.url });
			if (c.enabled !== d.enabled) ch.enabled.push({ name: d.name, from: c.enabled, to: d.enabled });
			if (c.name !== d.name) o.push({ what: 'name', from: c.name, to: d.name });
			if (c.category !== d.category) o.push({ what: 'category', from: c.category, to: d.category });
			if (c.protect !== d.protect) o.push({ what: 'protect', from: c.protect, to: d.protect });
			if (o.length) ch.other.push({ name: d.name, diffs: o });
		});
		cur.forEach(function (c, j) {
			if (used[j]) return;
			var own = !defUrl[c.url];
			if (own && !removeOwn) { result.push({ own: c, from: j }); ch.keep.push(c); }
			else ch.remove.push({ name: c.name, url: c.url, own: own });
		});
		var order = result.filter(function (r) { return r.from >= 0; }).map(function (r) { return r.from; });
		ch.reorder = order.some(function (v, i) { return i > 0 && v < order[i - 1]; });
		ch.count = ch.add.length + ch.remove.length + ch.url.length + ch.enabled.length + ch.other.length + (ch.reorder ? 1 : 0);
		return { result: result, changes: ch };
	}
	function restoreSummary(ch) {
		if (!ch.count) return '<p class="kuroshio-restore-none">目前的訂閱清單已經跟這個版本的預設一樣，不需要變更。</p>';
		var onOff = function (v) { return v ? '啟用' : '停用'; }, prot = function (v) { return v === undefined ? '自動' : v ? '保護' : '不保護'; };
		var block = function (cls, title, items) {
			if (!items.length) return '';
			return '<div class="kuroshio-restore-' + cls + '"><b>' + esc(title) + '</b><ul class="kr-ul">' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
		};
		return '<div class="kuroshio-restore-list">' +
			block('add', '會新增（' + ch.add.length + '）', ch.add.map(function (d) { return d.name + '（' + onOff(d.enabled) + '）'; })) +
			block('remove', '會移除（' + ch.remove.length + '）', ch.remove.map(function (d) { return (d.name || d.url) + (d.own ? '（自己加的）' : '（重複的預設清單）'); })) +
			block('url', '網址改回預設（' + ch.url.length + '）', ch.url.map(function (d) { return d.name + '：' + d.from + ' → ' + d.to; })) +
			block('enabled', '啟用狀態改回預設（' + ch.enabled.length + '）', ch.enabled.map(function (d) { return d.name + '：' + onOff(d.from) + ' → ' + onOff(d.to); })) +
			block('other', '名稱 / 分類 / 保護改回預設（' + ch.other.length + '）', ch.other.map(function (o) {
				return o.name + '：' + o.diffs.map(function (x) {
					if (x.what === 'name') return '名稱「' + x.from + '」→「' + x.to + '」';
					if (x.what === 'category') return '分類「' + (CAT[x.from] || x.from) + '」→「' + (CAT[x.to] || x.to) + '」';
					return '保護「' + prot(x.from) + '」→「' + prot(x.to) + '」';
				}).join('、');
			})) +
			(ch.reorder ? block('reorder', '順序', ['改回預設的順序（自己加的清單排在預設清單後面）']) : '') +
			block('keep', '保留你自己加的清單（' + ch.keep.length + '，排在預設清單後面）', ch.keep.map(function (d) { return d.name || d.url; })) + '</div>';
	}
	function currentLists() {
		return K.uci.sections('filter_list').map(function (s) {
			var p = K.uci.get(s.id, 'protect');
			return { ref: s.id, name: K.uci.get(s.id, 'name'), url: K.uci.get(s.id, 'url'), category: K.uci.get(s.id, 'category'), enabled: K.uci.get(s.id, 'enabled') !== '0',
				protect: (p == null || p === '') ? undefined : p === '1' };
		});
	}
	function applyRestore(cur, plan) {
		var order = [], keep = {};
		plan.result.forEach(function (r) {
			var id;
			if (r.own) id = r.own.ref;
			else {
				var d = r.def, old = r.from >= 0 ? cur[r.from] : null;
				id = old ? old.ref : K.uci.add('filter_list').id;
				K.uci.set(id, 'enabled', d.enabled ? '1' : '0');
				K.uci.set(id, 'name', d.name);
				K.uci.set(id, 'url', d.url);
				K.uci.set(id, 'category', d.category);
				if (d.protect !== undefined) K.uci.set(id, 'protect', d.protect ? '1' : '0');
				else K.uci.unset(id, 'protect');
			}
			if (r.from >= 0) keep[r.from] = true;
			order.push(id);
		});
		cur.forEach(function (c, j) { if (!keep[j]) K.uci.remove(c.ref); });
		K.uci.reorder('filter_list', order);
	}
	function shortUrl(v) { v = v || ''; return v.length > 60 ? v.slice(0, 57) + '…' : v; }

	K.page('filter', {
		needDefaults: true,
		render: function () {
			var pro = K.isPro(), rules = FILES.rules;
			var h = '<p class="tw-lead">判定順序：自訂規則是最高原則，命中就不看任何訂閱清單（白名單 @@ 也會蓋過所有清單）；沒有命中才看訂閱清單。支援 AdGuard / hosts 語法，也會檢查 CNAME 鏈。</p>';
			h += K.card('過濾', K.fields([
				{ k: 'filter.enabled', t: 'flag', l: '啟用過濾', def: '1' },
				{ k: 'filter.update_interval_hours', t: 'text', l: '清單更新間隔（小時）', v: 'uint', dp: 'filter.updateIntervalHours', pro: 1 },
				{ k: 'filter.relaxed_modifiers', t: 'flag', l: '寬鬆套用瀏覽器規則', def: K.def('filter.relaxedModifiers') ? '1' : '0', pro: 1, d: 'EasyList 這類瀏覽器清單有很多帶 $third-party、$script 修飾詞的規則。關閉（預設，同 AdGuard Home）= 略過這些規則；打開 = 整個網域封鎖，擋得更多但可能誤殺。' }
			]));
			h += K.card('訂閱清單', '<p class="tw-lead">分類一層一層往上疊：廣告為底，遙測疊在上面，惡意在最上層。同一個網域出現在多份清單時只算一次，歸到最上層的分類。hosts 格式裡寫的 IP 一律不採用，只當成封鎖該網域。</p>' + K.grid({
				type: 'filter_list', anon: true, quick: 'enabled', addLabel: '新增清單', empty: '沒有訂閱清單', init: [['enabled', '1'], ['category', 'ads']],
				title: function (s) { return K.uci.get(s.id, 'name'); },
				summary: function (s) { return K.badge(CAT[K.uci.get(s.id, 'category') || 'ads'] || K.uci.get(s.id, 'category'), 'off') + ' <span class="tw-small tw-muted kr-ellip">' + esc(shortUrl(K.uci.get(s.id, 'url'))) + '</span>'; },
				cols: [
					{ k: 'enabled', t: 'flag', l: '啟用', def: '1' },
					{ k: 'name', t: 'text', l: '名稱', rmempty: false },
					{ k: 'url', t: 'text', l: '網址', v: 'url', rmempty: false },
					{ k: 'category', t: 'select', l: '分類', def: 'ads', opts: [['ads', '廣告 / 追蹤'], ['telemetry', '遙測 / 驗證'], ['malware', '惡意 / 詐騙']] },
					{ k: 'protect', t: 'select', l: '保護', def: '', pro: 1, opts: [['', '自動'], ['1', '保護'], ['0', '不保護']], d: '記憶體不足時也不暫時停用。自動 = 惡意 / 詐騙類保護（例如 165 反詐騙），其他不保護。' }
				],
				extraActions: K.btn('恢復預設清單', 'restoreLists', { id: 'kuroshio-restore-lists' })
			}));
			h += K.card('自訂規則', '<p class="tw-lead">最高原則：這裡的規則永遠優先於所有訂閱清單。一行一條，例：||ads.example.com^ 封鎖、@@||good.example.com^ 白名單、! 或 # 開頭是註解。分類段落用「! @begin 分類」開頭、「! @end」結尾。</p>' +
				(rules == null ? U.stateBox('unavailable', '讀不到自訂規則檔') :
					K.fileArea('custom-rules.txt', { cls: 'kr-rules', rows: 14, label: '自訂規則', ph: '||ads.example.com^' })) +
				'<p class="tw-small tw-muted">按「儲存並套用」後 3 秒內生效，不用重新啟動黑潮 DNS；檔案在 /etc/storage/kuroshio/custom-rules.txt。</p>' +
				'<div class="tw-actions">' + K.btn('恢復預設自訂規則', 'resetRules', { danger: true, id: 'kuroshio-reset-rules' }) + '</div><div id="kr-rules-out" class="kr-out" role="status"></div>');
			h += K.card('規則檢查', '<div class="tw-actions"><input type="text" id="kr-check-name" placeholder="ads.example.com" style="max-width:24em" aria-label="要檢查的網域">' +
				K.btn('檢查', 'check', { primary: true }) + K.btn('立即更新清單', 'update') + '</div><div id="kr-check-out" class="kr-out" role="status"></div>');
			return h;
		},
		after: function () {
			var n = U.$('kr-check-name');
			if (n) n.addEventListener('keydown', function (e) { if (e.key == 'Enter') { e.preventDefault(); KURO_FILTER_CHECK(); } });
		},
		hooks: { act: {
			check: function () { return KURO_FILTER_CHECK(); },
			update: function () { return K.updateLists(); },
			/* 3.2.0：恢復預設清單（預設值來自 op=defaults 的 filter.lists） */
			restoreLists: function () {
				var defs = K.def('filter.lists');
				if (!Array.isArray(defs) || !defs.length) { U.toast('讀不到這個版本的預設清單，沒有變更', 'bad'); return; }
				return K.core().then(function (core) {
					var P = planner(core), cur = currentLists(), plan = null;
					/* 比對失敗時說明原因並停用按鈕（同 LuCI 3.2.1），不要讓按鈕按了沒反應 */
					var calc = function (removeOwn) {
						try { plan = P.plan(cur, defs, removeOwn); return P.summary(plan.changes); }
						catch (e) { plan = null; return K.note('無法比對目前的清單：' + esc(e && e.message || e), 'bad'); }
					};
					var p = U.dialog({ title: '恢復預設清單', ok: '恢復預設清單', danger: true,
						body: '<p>把訂閱清單改回這個版本的預設：名稱、網址、分類、啟用狀態與順序。網址不在預設裡的清單是你自己加的，會保留並排在預設清單後面。</p>' +
							'<div id="kuroshio-restore-summary">' + calc(false) + '</div>' +
							'<p><label class="kr-inline-check"><input type="checkbox" id="kuroshio-restore-own"> 一併移除我自己加的清單</label></p>' +
							'<p class="tw-small tw-muted">按下「恢復預設清單」後，還要按「儲存並套用」才會生效。</p>' });
					var own = U.$('kuroshio-restore-own'), ok = U.$('tw-dialog-ok');
					var draw = function () { U.$('kuroshio-restore-summary').innerHTML = calc(own.checked); ok.disabled = !plan || !plan.changes.count; };
					own.onchange = draw;
					ok.disabled = !plan || !plan.changes.count;
					return p.then(function (y) {
						if (!y || !plan) return;
						applyRestore(cur, plan);
						K.redrawGrid('filter_list');
						U.toast('已改成這個版本的預設清單（' + plan.changes.count + ' 項變更），按「儲存並套用」後生效', 'ok');
					});
				});
			},
			/* 3.2.0：恢復預設自訂規則（服務會先備份成 custom-rules.txt.bak） */
			resetRules: function () {
				return U.dialog({ title: '恢復預設自訂規則？', ok: '恢復預設', danger: true,
					body: '<p>把自訂規則換成這個版本的預設規則，3 秒內生效。</p><p>目前的內容會先備份成同一個資料夾的 custom-rules.txt.bak（只保留最近一次）。</p>' +
						'<p class="tw-small tw-muted">這裡還沒儲存的自訂規則修改會一併捨棄。</p>' }).then(function (y) {
					if (!y) return;
					return K.action('/api/filter/reset-rules').then(function (r) {
						var x = K.done(r);
						if (!x) return;
						var t = x.changed === false ? '自訂規則已經是這個版本的預設，不需要變更。' : '已恢復預設自訂規則，3 秒內生效。原本的內容備份在 ' + (x.backup || 'custom-rules.txt.bak');
						U.toast(t, 'ok');
						/* 檔案是黑潮改的：重新讀一次，文字框換成新的內容 */
						return K.fileReload(true).then(function () { K.render(); U.set('kr-rules-out', esc(t)); },
							function () { U.set('kr-rules-out', esc(t) + ' <a href="#filter" onclick="location.reload();return false;">重新整理頁面</a>看新的內容。'); });
					});
				});
			}
		} }
	});
	window.KURO_FILTER_CHECK = function () {
		var name = (U.$('kr-check-name').value || '').trim(), out = U.$('kr-check-out');
		if (!name) return;
		return K.api('api', '/api/filter/check', { name: name }).then(function (r) {
			if (!r || r.ok === false) { out.innerHTML = K.badge((r && r.error) || '服務沒有回應', 'err'); return; }
			var x = r.result || {};
			var verdict = x.action === 'block' ? '會被封鎖' : x.action === 'allow' ? '白名單放行' : '沒有命中任何規則';
			out.innerHTML = '<p>' + K.badge(verdict, x.action === 'block' ? 'err' : x.action === 'allow' ? 'ok' : 'off') + ' ' + esc((x.rule ? x.rule : '') + (x.tier ? '（' + (x.tier === 'custom' ? '自訂規則' : '訂閱清單') + '）' : '')) + '</p>' + K.pre(JSON.stringify(x, null, 2));
		});
	};

	/* =====================================================================
	 * CDN 台灣節點（cdn.js）
	 * ===================================================================== */
	var LABELS = { cloudflare: 'Cloudflare', cloudfront: 'Amazon CloudFront', fastly: 'Fastly', gcore: 'Gcore', azure: 'Azure Front Door / CDN', akamai: 'Akamai', edgio: 'Edgio / Edgecast',
		cdnetworks: 'CDNetworks', tencent: '騰訊雲 CDN / EdgeOne', alibaba: '阿里雲 CDN', wangsu: '網宿', bytedance: '字節跳動 BytePlus', apple: 'Apple CDN' };
	var ANYCAST = { cloudflare: 1, cloudfront: 1, fastly: 1, gcore: 1, azure: 1 };
	function pools(r) {
		if (!r) return '<em class="tw-muted">服務沒有執行，或還沒建立節點池。</em>';
		return K.table(['CDN', 'IPv4 可用 / 全部', 'IPv6', '最快節點', '/24 掃描'], Object.keys(r).map(function (k) {
			var p = r[k], ok4 = (p.v4 || []).filter(function (x) { return !x.bad; });
			return [esc(LABELS[k] || k), ok4.length + ' / ' + (p.v4 || []).length, String((p.v6 || []).length),
				'<span class="kr-break">' + esc(ok4.slice(0, 4).map(function (x) { return x.ip + (x.ms != null ? ' (' + Math.round(x.ms) + 'ms)' : ''); }).join(', ') || '-') + '</span>',
				p.scan ? esc('TW ' + p.scan.tw + ' · Global ' + p.scan.global + ' · Dead ' + p.scan.dead) : '-'];
		}), '還沒有節點池', [1, 2]);
	}
	K.page('cdn', {
		needDefaults: true,
		render: function () {
			var pro = K.isPro(), n = function (k, l, dp, d, v) { return { k: 'cdn.' + k, t: 'text', l: l, dp: dp, d: d, v: v || 'uint' }; };
			var h = '<p class="tw-lead">Cloudflare、CloudFront 等常把台灣用戶導去國外機房。這裡把答案換成台北、高雄節點，並先用 HTTPS 實際連線驗證網站能正常運作才換；Akamai 等 DNS 分流型 CDN 則帶台灣網段的 ECS 找出更近的節點。</p>';
			h += K.card('節點置換', K.fields([
				{ k: 'cdn.enabled', t: 'flag', l: '啟用 CDN 台灣節點置換', def: '1' },
				{ k: 'cdn.trial_mode', t: 'select', l: '未驗證的網站', def: K.def('cdn.trialMode') || 'original', opts: [['original', '先回原始結果，驗證通過才換（推薦）'], ['alias', '先換台灣節點，驗證失敗再改回']], d: '還沒驗證過的網站要怎麼回答。「先回原始結果」最穩：驗證通過後下一次查詢才換台灣節點。' },
				{ k: 'cdn.v6_policy', t: 'select', l: '沒有台灣 IPv6 節點時', def: K.def('cdn.v6Policy') || 'drop', opts: [['drop', '丟棄該 CDN 的 IPv6 位址（避免 IPv6 繞回國外，推薦）'], ['keep', '保留']] }
			]) + (pro ? '<h3 class="kr-h3">驗證</h3>' + K.fields([
				n('trial_ttl', '未驗證時的 TTL（秒）', 'cdn.trialTtl'),
				n('verify_ok_hours', '驗證通過有效時間（小時）', 'cdn.verifyOkHours', '熱門網域到期前會自動複驗。'),
				n('verify_fail_hours', '驗證失敗後重試（小時）', 'cdn.verifyFailHours', '每次失敗加倍。'),
				n('verify_fail_max_days', '重試間隔上限（天）', 'cdn.verifyFailMaxDays'),
				n('verify_timeout_ms', '驗證逾時（毫秒）', 'cdn.verifyTimeoutMs'),
				n('verify_concurrency', '同時驗證數', 'cdn.verifyConcurrency'),
				n('nearest_min_gain_ms', '沒有台灣 POP 時最少快幾毫秒才換', 'cdn.nearestMinGainMs', 'Fastly 等：換到鄰近國家節點的門檻。')
			]) + '<h3 class="kr-h3">節點池</h3>' + K.fields([
				n('serve_count', '每次回幾個台灣 IP', 'cdn.serveCount'),
				n('min_pool', '可用節點少於幾個就重建', 'cdn.minPool'),
				n('health_interval_min', '節點池健檢間隔（分鐘）', 'cdn.healthIntervalMin'),
				n('quality_interval_min', '鄰近節點品質重測（分鐘）', 'cdn.qualityIntervalMin', 'Fastly：海纜壅塞、掉包變多時自動換 POP。')
			]) + '<h3 class="kr-h3">跨 CDN 備援</h3>' + K.fields([
				{ k: 'cdn.cross_enabled', t: 'flag', l: '啟用跨 CDN 備援', def: K.def('cdn.cross.enabled') === false ? '0' : '1', d: '原本的 CDN 在台灣沒有節點（例如 Fastly）時，測試同一個網站是不是也放在 Cloudflare、CloudFront、Azure、Akamai 的台灣節點上；憑證與網頁內容都一致才採用。' },
				n('cross_min_orig_ms', '原本延遲超過幾毫秒才嘗試', 'cdn.cross.minOrigMs'),
				n('cross_recheck_hours', '複驗間隔（小時）', 'cdn.cross.recheckHours'),
				n('cross_fail_days', '失敗後幾天再試', 'cdn.cross.failDays'),
				n('cross_akamai_max_ms', 'Akamai 台灣節點延遲上限（毫秒）', 'cdn.cross.akamaiMaxMs'),
				n('cross_concurrency', '同時測試數', 'cdn.cross.concurrency')
			]) + '<h3 class="kr-h3">其他</h3>' + K.fields([n('max_entries', 'CDN 網域資料庫上限（筆）', 'cdn.maxEntries', '記憶體較小的機器可以調低。')]) : ''));
			h += K.card('各家 CDN', '<p class="tw-lead">任播型（Cloudflare、CloudFront、Fastly、Gcore、Azure）用 IP 置換；DNS 分流型（Akamai 等）用 ECS 找台灣節點。</p>' + K.grid({
				type: 'cdn_provider', quick: 'enabled', empty: '設定檔裡沒有 CDN 業者',
				title: function (s) { return LABELS[s.id] || s.id; },
				summary: function (s) { return '<span class="tw-small tw-muted">' + (ANYCAST[s.id] ? '任播 · IP 置換' : 'DNS 分流 · ECS') + '</span>'; },
				cols: [
					{ k: 'enabled', t: 'flag', l: '啟用', def: '1' },
					{ k: 'ecs', t: 'flag', l: '用 ECS 找台灣節點', def: '0', pro: 1 },
					{ k: 'serve_count', t: 'text', l: '每次回幾個 IP', v: 'uint', ph: String(K.def('cdn.serveCount') || 4), pro: 1 },
					{ k: 'seed_v4', t: 'list', l: '種子節點（IPv4）', v: 'ip4', pro: 1, d: '節點池還沒建立前先用這些台灣 IP，每日工作會自動更新節點池。' }
				]
			}) + (pro ? '' : '<p class="tw-small tw-muted">切換到「專業」可以調整每家的 ECS、回應 IP 數與種子節點。</p>'));
			h += K.card('ECS 突破（DNS 分流型 CDN）', '<p class="tw-lead">帶不同的台灣網段去問支援 ECS 的 DNS，找到明顯更近且 HTTPS 驗證通過的節點才換。本機對外 IP 的 /24 會自動放在最前面。</p>' + K.fields([
				{ k: 'ecs.tw_subnet', t: 'list', l: '台灣網段', v: 'cidr4', d: '放你用戶實際所在的 ISP 網段效果最好。' },
				{ k: 'ecs.resolver', t: 'list', l: '支援 ECS 的 DNS', pro: 1, d: 'Cloudflare 1.1.1.1 不支援 ECS。' },
				{ k: 'ecs.min_gain_ms', t: 'text', l: '至少快幾毫秒', v: 'uint', dp: 'cdn.ecs.minGainMs', pro: 1 },
				{ k: 'ecs.min_gain_ratio', t: 'text', l: '且至少快幾成', v: 'ufloat', dp: 'cdn.ecs.minGainRatio', pro: 1, d: '0.3 = 30%' },
				{ k: 'ecs.result_hours', t: 'text', l: '結果有效時間（小時）', v: 'uint', dp: 'cdn.ecs.resultHours', pro: 1 },
				{ k: 'ecs.concurrency', t: 'text', l: '同時查詢數', v: 'uint', dp: 'cdn.ecs.concurrency', pro: 1 }
			]));
			h += K.card('台灣節點池', '<p class="tw-small tw-muted">每天 05:30 重建，每 30 分鐘健檢。</p><div id="kr-pools">' + U.stateBox('loading') + '</div><div class="tw-actions" style="margin-top:12px">' +
				K.btn('重新整理', 'pools') + K.btn('立即重建節點池', 'rebuild', { primary: true }) + '</div>');
			h += K.card('網域工具', '<p class="tw-lead">追蹤一個網域的完整解析過程，或手動指定要不要換台灣節點。</p><div class="tw-actions"><input type="text" id="kr-cdn-name" placeholder="www.example.com" style="max-width:22em" aria-label="網域">' +
				K.btn('追蹤', 'trace', { primary: true }) + K.btn('重新驗證', 'verify') + K.btn('ECS 突破', 'ecs') +
				'<select id="kr-cdn-policy" style="width:auto" aria-label="策略"><option value="auto">自動驗證</option><option value="always">一律置換</option><option value="never">永不置換</option></select>' + K.btn('套用策略', 'policy') + '</div><div id="kr-cdn-out" class="kr-out"></div>');
			return h;
		},
		after: function () { loadPools(); },
		hooks: { act: {
			pools: function () { return loadPools(); },
			rebuild: function () { return K.action('/api/jobs/run', { name: 'cdn-pool' }).then(function (r) { K.done(r, '已排入背景執行，完成後自動套用'); }); },
			trace: function () { var n = cdnName(); if (n) return K.api('api', '/api/trace', { name: n, type: 'A' }).then(showCdn); },
			verify: function () { var n = cdnName(); if (n) return K.action('/api/cdn/verify', { name: n, family: 4 }).then(showCdn); },
			ecs: function () { var n = cdnName(); if (n) return K.action('/api/cdn/ecs', { name: n }).then(showCdn); },
			policy: function () { var n = cdnName(); if (n) return K.action('/api/cdn/policy', { name: n, policy: U.$('kr-cdn-policy').value }).then(showCdn); }
		} }
	});
	function loadPools() { return K.view('/api/cdn/pools').then(function (r) { panel('kr-pools', pools(r)); }); }
	function cdnName() { var v = (U.$('kr-cdn-name').value || '').trim().toLowerCase(); if (!v) U.toast('請輸入網域', 'warn'); return v; }
	function showCdn(r) {
		var out = U.$('kr-cdn-out');
		if (!r || r.ok === false) { out.innerHTML = K.badge((r && r.error) || '操作失敗', 'err'); return; }
		out.innerHTML = K.pre(JSON.stringify(r.result, null, 2));
	}

	/* =====================================================================
	 * 進階（advanced.js）＋學習資料匯出
	 * ===================================================================== */
	var WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
	var JOBN = { dns_benchmark: 'DNS 評測（選出最佳上游組合、剔除汙染）', cdn_ranges: '抓 CDN 官方 IP 範圍', cdn_scan: 'CDN 網段分類（台灣 / 國外 / 失效）', cdn_pool: '重建台灣節點池（延遲、掉包、下載速度）' };
	var BENCH = [['iplist.txt', '一般 DNS 候選名單', '一行一個 IP。'], ['dohlist.txt', 'DoH 候選名單', '一行一個 https:// 網址（每一個也會自動用 HTTP/3 測）。'],
		['dotlist.txt', 'DoT 候選名單', '一行一個 tls://主機[:埠]。'], ['doqlist.txt', 'DoQ 候選名單', '一行一個 quic://主機[:埠]。'],
		['web.txt', '評測用網域', '用來判斷各 DNS 速度、汙染、封殺的網域。'], ['blacklist.txt', '自己加的淘汰名單', '不想讓評測使用的 DNS，一行一個。']];
	function backupCard() {
		return K.card('備份與分享', '<p class="tw-lead">換路由器時把累積的學習資料帶過去，或分享給朋友手動匯入。</p><ul class="kr-ul">' +
			'<li><b>完整備份</b>：全部學習資料、自訂規則、社群身分與好友。含私鑰，請自己保管，不要給別人。</li>' +
			'<li><b>分享給朋友</b>：CDN 網域驗證紀錄（只有網域名稱與驗證結果）、台灣節點池（匯入的一方只當候選，本機驗證通過才使用）。沒有身分、金鑰、統計與自訂規則。</li></ul>' +
			'<div class="tw-actions">' + K.btn('下載完整備份', 'export', { primary: true, arg: 'full' }) + K.btn('下載分享檔', 'export', { arg: 'share' }) +
			K.btn('匯入 .kuroshio 檔…', 'import') + '</div>' +
			'<p class="tw-small tw-muted">匯入是合併：本機已經有的資料以本機為準，不會被舊備份蓋掉；朋友的分享檔只當候選。匯入時黑潮 DNS 會重新載入一次（幾秒，不改用業者 DNS）。</p>' +
			'<div id="kr-export-out" class="kr-out" role="status"></div>', { id: 'kuroshio-backup' }) +
			K.card('直接編輯設定檔', '<p class="tw-lead">熟悉 UCI 格式的話，可以在舊版頁面直接編輯整份設定檔（CR6608 的 RWFS 資料區也在那裡啟用）。網域、Token、DDNS、DoT／DoQ／DoH、對外開放、來源模式以這裡的表單為準，在設定檔裡改不會生效。</p>' +
				'<div class="tw-actions">' + U.button('開啟舊版頁面', { small: true, href: 'Advanced_kuroshio.asp' }) + '</div>');
	}
	function num(sec, k, l, dp, d, v) { return { k: sec + '.' + k, t: 'text', l: l, dp: dp, d: d, v: v || 'uint' }; }
	function flag(sec, k, l, dp, d) { return { k: sec + '.' + k, t: 'flag', l: l, def: K.def(dp) === false ? '0' : '1', d: d }; }
	K.page('advanced', {
		needDefaults: true,
		render: function () {
			if (!K.isPro()) return K.card('進階', '<p>這裡是上游、解析時間、測速、排程與評測的細部參數。為了避免誤改，請先切換到右上角的「專業」模式。</p>') + backupCard();
			var h = '<p class="tw-lead">空白欄位使用程式內建預設值（顯示在欄位裡）。</p>';
			h += K.card('上游 DNS', '<p class="tw-lead">格式：udp://IP、tcp://IP、tls://主機、https://主機/dns-query。每日評測會自動選出最佳組合，以下是固定參與與備援。</p>' + K.fields([
				{ k: 'upstream.pinned', t: 'list', l: '固定上游', d: '每次查詢都參與、不會被評測淘汰。不要填路由器自己。' },
				{ k: 'upstream.fallback', t: 'list', l: '備援', d: '固定與自動上游都失敗時才用。' },
				{ k: 'upstream.bootstrap', t: 'list', l: 'Bootstrap', v: 'ip', d: '解析 DoH / DoT 上游主機名稱用，只能填 IP。' },
				{ k: 'upstream.last_resort', t: 'list', l: '最後手段', d: '所有上游都沒回應時。' },
				num('upstream', 'auto_max', '自動上游最多幾台', 'upstream.autoMax'),
				{ k: 'upstream.auto_type', t: 'multi', l: '自動上游可用協定', def: K.def('upstream.autoTypes') || ['udp', 'doh', 'dot'], opts: [['udp', 'UDP'], ['doh', 'DoH'], ['dot', 'DoT']] },
				flag('upstream', 'chain', '自動串接上游的黑潮', 'upstream.chain', '前面的路由器也跑黑潮（3.4.0 起）時，直接問它並共用它的評測結果、CDN 節點與清單副本，這台不用再自己跑評測與 CDN 掃描。關閉 = 自己重做，重複使用網路。'),
				flag('upstream', 'allow_downstream', '提供資料給下游的黑潮', 'upstream.allowDownstream', '後面接的路由器也跑黑潮時，提供評測結果與 CDN 節點給它。關閉 = 下游自己重做評測與掃描。有啟用「繞過防護」清單時建議關閉。')
			]));
			h += K.card('解析行為', K.fields([
				num('resolver', 'timeout_ms', '上游逾時（毫秒）', 'resolver.timeoutMs'),
				num('resolver', 'collect_window_ms', '收集其他上游答案的時間（毫秒）', 'resolver.collectWindowMs', '第一個回應之後再等多久，用來合併 IP 測速。'),
				flag('resolver', 'fast_path', '先回第一個正常回應', 'resolver.fastPath'),
				num('resolver', 'fast_path_ttl', '快速回應的 TTL（秒）', 'resolver.fastPathTtl', '測速排序完成後，下一次查詢就拿到最佳 IP。'),
				flag('resolver', 'rank_ips', '合併所有上游 IP 並測速排序', 'resolver.rankIps'),
				num('resolver', 'max_ips', '每個回應最多幾個 IP', 'resolver.maxIps'),
				num('resolver', 'max_ttl', 'TTL 上限（秒）', 'resolver.maxTtl'),
				num('resolver', 'min_ttl', 'TTL 下限（秒）', 'resolver.minTtl'),
				num('resolver', 'negative_max_ttl', '不存在網域的 TTL 上限（秒）', 'resolver.negativeMaxTtl'),
				num('resolver', 'serve_stale_sec', '過期後仍可先回舊資料（秒）', 'resolver.serveStaleSec'),
				num('resolver', 'prefetch_threshold_sec', '剩餘 TTL 低於幾秒就預取', 'resolver.prefetchThresholdSec'),
				num('resolver', 'prefetch_recent_sec', '最近幾秒內有人查才預取', 'resolver.prefetchRecentSec'),
				num('resolver', 'cache_max', '快取筆數上限', 'resolver.cacheMax'),
				flag('resolver', 'send_ecs', '對上游附帶 ECS（本機對外 IP 的 /24）', 'resolver.sendEcs'),
				flag('resolver', 'android_probe_fast', 'Android 私人 DNS 驗證查詢立即回覆', 'resolver.androidProbeFast')
			]));
			h += K.card('IP 測速', '<p class="tw-lead">以 TCP 連線測量每個 IP 的延遲。</p>' + K.fields([
				num('iprank', 'port', '測速埠號', 'iprank.port', null, 'port'), num('iprank', 'timeout_ms', '逾時（毫秒）', 'iprank.timeoutMs'),
				num('iprank', 'ok_ttl_sec', '成功結果保留（秒）', 'iprank.okTtlSec'), num('iprank', 'fail_ttl_sec', '失敗結果保留（秒）', 'iprank.failTtlSec'),
				num('iprank', 'concurrency', '同時測速數', 'iprank.concurrency')
			]));
			h += K.card('排程工作（台北時間）', '<p class="tw-lead">到時間以獨立程序在背景執行，不影響 DNS 回應。路由器在排定時間沒開機，下次啟動會自動補跑。</p>' +
				K.fields([{ k: 'main.catchup_window', t: 'text', l: '補跑時段', ph: '01:00-06:00', d: '剛刷機、學習資料不見或很久沒跑時的補跑（DNS 評測、CDN 掃描等）只在這段時間進行，期間先用預設上游；排定時間與手動執行不受影響。空白 = 開機後幾分鐘就補跑。（黑潮 3.4.0 起）' }]) + K.grid({
				type: 'job', quick: 'enabled', empty: '設定檔裡沒有排程工作',
				title: function (s) { return JOBN[s.id] || s.id; },
				summary: function (s) {
					var at = K.uci.list(s.id, 'at'), wd = K.uci.list(s.id, 'weekday');
					return '<span class="tw-small tw-muted">' + esc((at.length ? at.join(', ') : '預設時間') + ' · ' + (wd.length ? wd.map(function (i) { return WEEKDAYS[+i]; }).join(' ') : '每天')) + '</span>';
				},
				cols: [
					{ k: 'enabled', t: 'flag', l: '啟用', def: '1' },
					{ k: 'at', t: 'list', l: '時間', v: 'hhmm', d: 'HH:MM，可以多個。' },
					{ k: 'weekday', t: 'multi', l: '星期', opts: WEEKDAYS.map(function (w, i) { return [String(i), w]; }), d: '都不選 = 每天' },
					{ k: 'start_delay_sec', t: 'text', l: '補跑延遲（秒）', v: 'uint' },
					{ k: 'timeout_min', t: 'text', l: '逾時（分鐘）', v: 'uint' }
				]
			}));
			h += K.card('每日 DNS 評測', K.fields([
				num('benchmark', 'concurrency', '同時測試數', 'benchmark.concurrency'), num('benchmark', 'timeout_ms', '逾時（毫秒）', 'benchmark.timeoutMs'),
				num('benchmark', 'max_timeouts', '容許逾時次數', 'benchmark.maxTimeouts'), num('benchmark', 'coverage_target', '涵蓋率目標', 'benchmark.coverageTarget', '0.97 = 97%', 'ufloat'),
				num('benchmark', 'min_auto', '至少選幾台', 'benchmark.minAuto'), num('benchmark', 'max_avg_latency_ms', '平均延遲上限（毫秒）', 'benchmark.maxAvgLatencyMs'),
				num('benchmark', 'keep_days', '報表保留天數', 'benchmark.keepDays')
			]));
			h += K.card('CDN 網段掃描', K.fields([num('scan', 'samples_per_subnet', '每個 /24 抽樣幾個 IP', 'scan.samplesPerSubnet'), num('scan', 'concurrency', '同時連線數', 'scan.concurrency'), num('scan', 'timeout_ms', '逾時（毫秒）', 'scan.timeoutMs')]));
			h += K.card('節點池建立', K.fields([num('pool', 'candidates_per_provider', '每家 CDN 候選 IP 數', 'pool.candidatesPerProvider'), num('pool', 'pool_size', '節點池大小', 'pool.poolSize'),
				num('pool', 'speed_top', '取前幾名測下載速度', 'pool.speedTop'), num('pool', 'speed_seconds', '每次下載測速秒數', 'pool.speedSeconds')]));
			h += K.card('評測名單', '<p class="tw-lead">只放自己要加的；韌體附帶的預設名單會自動一起測，更新韌體時更新。</p>' +
				'<p class="tw-small tw-muted">存檔後不用重新啟動，下次每日評測時使用；檔案在 /etc/storage/kuroshio/benchmark/。</p>' +
				BENCH.map(function (f) {
					return '<div class="tw-field kr-wide"><span class="tw-field-label">' + esc(f[1]) + ' <small class="tw-muted">' + esc(f[0]) + '</small></span>' +
						K.fileArea('benchmark/' + f[0], { rows: 5, label: f[1], ph: '（沒有自己加的）' }) + '<div class="tw-help">' + esc(f[2]) + '</div></div>';
				}).join('') + '<p class="tw-small tw-muted">評測自動淘汰的 DNS（每一筆都實際驗證過）記在學習資料的 blacklist.txt，可以在「儀表板」的上游區塊查看。</p>');
			return h + backupCard();
		},
		hooks: { act: {
			/* op=backup-export（POST）→ 下載 /kuroshio_backup.kuroshio（下載後路由器端刪除） */
			export: function (kind) {
				var out = U.$('kr-export-out');
				out.textContent = '匯出中…';
				return K.api('backup-export', null, null, true, kind == 'share' ? '&q=share' : '').then(function (r) {
					if (!r || !r.ok) { out.textContent = ''; U.toast('匯出失敗：' + ((r && r.error) || ''), 'bad'); return; }
					var name = 'kuroshio-' + kind + '-' + K.time(Date.now(), 'date').replace(/-/g, '') + '.kuroshio';
					var a = document.createElement('a');
					a.href = '/kuroshio_backup.kuroshio'; a.download = name; a.style.display = 'none';
					document.body.appendChild(a); a.click();
					setTimeout(function () { a.remove(); }, 2000);
					out.textContent = '已下載 ' + name + '（' + Math.ceil((r.size || 0) / 1024) + ' KB）' + (kind == 'full' ? '。含私鑰，請自己保管。' : '');
				});
			},
			/*
			 * 匯入：上傳到 /kuroshio_import.cgi（httpd 檢查開頭是 zstd、最大 16 MB）→ kuroshio.sh 交給黑潮的
			 * /api/backup/import → 黑潮重新載入時合併，結果在 /api/backup/last-import（importedAt 跟送出前不同就是這次）
			 */
			'import': function () {
				var out = U.$('kr-export-out'), inp = document.createElement('input');
				inp.type = 'file'; inp.accept = '.kuroshio'; inp.style.display = 'none';
				document.body.appendChild(inp);
				inp.addEventListener('change', function () {
					var f = inp.files && inp.files[0];
					inp.remove();
					if (!f) return;
					if (f.size > 16 * 1048576) { U.toast('檔案太大（超過 16 MB）', 'bad'); return; }
					var prev = null, fd = new FormData();
					fd.append('file', f, f.name);
					out.textContent = '上傳中…（' + Math.ceil(f.size / 1024) + ' KB）';
					/* 先記下上一次匯入的時間（路由器與電腦的時鐘可能不同，不拿電腦的時間比） */
					K.view('/api/backup/last-import').then(function (li) { prev = (li && li.importedAt) || 0; })
						.then(function () { return fetch('/kuroshio_import.cgi', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-TW-Request': '1' }, body: fd }); })
						.then(function (r) { return r.text(); })
						.then(function (t) { try { return JSON.parse(t); } catch (e) { return { ok: false, error: '回應格式錯誤' }; } },
							function (e) { return { ok: false, error: '連不到路由器：' + (e && e.message || e) }; })
						.then(function (r) {
							var res = r && r.ok && r.result;
							if (!res || res.ok === false) { out.textContent = ''; U.toast('匯入失敗：' + ((r && r.error) || (res && res.error) || ''), 'bad'); return; }
							var label = (res.preview && res.preview.kindLabel) || '備份';
							out.textContent = '已收到' + label + '，黑潮 DNS 重新載入後合併…';
							var tries = 0;
							(function wait() {
								K.view('/api/backup/last-import').then(function (li) {
									if (li && li.importedAt && li.importedAt !== prev) {
										var items = (li.items || []).map(function (i) {
											var n = [['added', '新增'], ['updated', '更新'], ['kept', '保留本機'], ['skipped', '略過']]
												.filter(function (k) { return i[k[0]]; }).map(function (k) { return k[1] + ' ' + K.fmtNum(i[k[0]]); });
											return (i.label || i.file) + (i.error ? '：失敗（' + i.error + '）' : (n.length ? '：' + n.join('、') : ''));
										});
										out.textContent = (li.ok === false ? '匯入有部分失敗：' : '匯入完成：') + (items.join('；') || label);
										U.toast(li.ok === false ? '匯入有部分失敗，詳細在下方' : '匯入完成', li.ok === false ? 'bad' : 'ok');
										return;
									}
									if (++tries > 30) { out.textContent = '已送出，但 60 秒內沒看到合併結果，請稍後看「日誌」'; return; }
									setTimeout(wait, 2000);
								});
							})();
						});
				});
				inp.click();
			}
		} }
	});
})(KURO);
