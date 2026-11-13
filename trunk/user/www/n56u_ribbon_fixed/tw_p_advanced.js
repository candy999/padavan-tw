/* padavan-tw 進階設定：保留所有原始 Padavan 頁面（docs/HANDOFF-UI.md 5.4） */
var AD_HINT = {
	1: '常用的名稱、密碼、頻道已經在新的「Wi-Fi」頁', 2: '常用的名稱、密碼、頻道已經在新的「Wi-Fi」頁', 3: '固定 IP 也可以在「裝置」頁設定',
	4: '連線方式、MTU 也可以在「網際網路」頁設定', 5: '暫停裝置上網也可以在「裝置」頁操作', 7: '韌體、備份、密碼也可以在「系統」頁設定'
};

function page_init() {
	var U = TW;
	/* 用上游的選單邏輯整理清單（依韌體功能、AP 模式刪掉不適用的頁面），側欄也會列出原始選單 */
	if (typeof show_menu == 'function') show_menu(0, 0, 0);
	var sm = TW.$('subMenu'); if (sm) sm.innerHTML = '';	/* 這頁本身就是完整清單，側欄不再重複 */
	var groups = [];
	for (var i = 1; i < menuL2_title.length; i++) {
		if (!menuL2_title[i]) continue;
		var links = [], tt = tabtitle[i - 1], tl = tablink[i - 1];
		if (tt && tl) for (var k = 1; k < tt.length; k++) if (tt[k] && tl[k]) links.push([tt[k], tl[k]]);
		if (!links.length && menuL2_link[i]) links.push([menuL2_title[i], menuL2_link[i]]);
		groups.push({ title: menuL2_title[i], hint: AD_HINT[i] || '', links: links });
	}
	var other = [['網路地圖（原本的首頁）', 'Main_NetMap.asp']];
	for (var j = 2; j < menuL1_title.length; j++) if (menuL1_title[j] && menuL1_link[j]) other.push([menuL1_title[j], menuL1_link[j]]);
	other.push(['流量：最近 24 小時', 'Main_TrafficMonitor_last24.asp'], ['流量：每日統計', 'Main_TrafficMonitor_daily.asp']);
	groups.unshift({ title: '狀態與工具', hint: '', links: other });

	var h = U.pageHead({ title: '進階設定', sub: '原始 Padavan 的完整設定頁，給熟悉路由器的人使用。大部分日常設定在左邊的新選單就能完成。' });
	h += '<div class="tw-toolbar"><input type="search" class="tw-search" placeholder="搜尋設定頁" aria-label="搜尋設定頁" oninput="ad_filter(this.value)"><span class="tw-small tw-muted" id="ad-count"></span></div>';
	h += '<div class="tw-adv" id="ad-groups">' + groups.map(function (g) {
		return '<section class="tw-card" aria-label="' + U.esc(g.title) + '"><div class="tw-card-head"><h2>' + U.esc(g.title) + '</h2></div>' +
			(g.hint ? '<p class="tw-lead">' + U.esc(g.hint) + '</p>' : '') + '<ul class="tw-adv-links">' + g.links.map(function (l) {
				return '<li><a href="' + U.esc(l[1]) + '"><span>' + U.esc(l[0]) + '</span><small>' + U.esc(l[1].replace(/\.asp.*$/, '').replace(/_Content$/, '')) + '</small></a></li>';
			}).join('') + '</ul></section>';
	}).join('') + '</div>';
	U.mount(h);
	ad_filter('');
}
function ad_filter(q) {
	q = String(q || '').toLowerCase();
	var cards = document.querySelectorAll('#ad-groups .tw-card'), n = 0;
	for (var i = 0; i < cards.length; i++) {
		var lis = cards[i].querySelectorAll('li'), any = false, gt = cards[i].querySelector('h2').textContent.toLowerCase();
		for (var k = 0; k < lis.length; k++) {
			var hit = !q || gt.indexOf(q) >= 0 || lis[k].textContent.toLowerCase().indexOf(q) >= 0;
			lis[k].hidden = !hit;
			if (hit) { any = true; n++; }
		}
		cards[i].hidden = !any;
	}
	var c = TW.$('ad-count'); if (c) c.textContent = n + ' 個頁面';
}
