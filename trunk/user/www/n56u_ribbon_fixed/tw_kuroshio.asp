<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - 黑潮 DNS</title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="-1">

<link rel="shortcut icon" href="images/favicon.ico">
<link rel="icon" href="images/favicon.png">
<link rel="stylesheet" type="text/css" href="/bootstrap/css/bootstrap.min.css">
<link rel="stylesheet" type="text/css" href="/bootstrap/css/main.css">

<script type="text/javascript" src="/jquery.js"></script>
<script type="text/javascript" src="/bootstrap/js/bootstrap.min.js"></script>
<script type="text/javascript" src="/state.js"></script>
<script type="text/javascript" src="/general.js"></script>
<script type="text/javascript" src="/popup.js"></script>
<script type="text/javascript" src="/tw_ui.js"></script>
<script type="text/javascript" src="/tw_kuro.js"></script>
<script>
/* padavan-tw：黑潮 DNS 子頁組（docs/HANDOFF-UI.md 第 13 節，移植自黑潮 DNS v3.2.0 的 LuCI 介面） */
<% login_state_hook(); %>
var KURO_NV = {
	kuroshio_enable: "<% nvram_get_x("", "kuroshio_enable"); %>",
	kuroshio_domain: "<% nvram_get_x("", "kuroshio_domain"); %>",
	kuroshio_acme_email: "<% nvram_get_x("", "kuroshio_acme_email"); %>",
	kuroshio_ddns: "<% nvram_get_x("", "kuroshio_ddns"); %>",
	kuroshio_dot: "<% nvram_get_x("", "kuroshio_dot"); %>",
	kuroshio_doq: "<% nvram_get_x("", "kuroshio_doq"); %>",
	kuroshio_doh: "<% nvram_get_x("", "kuroshio_doh"); %>",
	kuroshio_doh_port: "<% nvram_get_x("", "kuroshio_doh_port"); %>",
	kuroshio_doh_wan_port: "<% nvram_get_x("", "kuroshio_doh_wan_port"); %>",
	kuroshio_wan: "<% nvram_get_x("", "kuroshio_wan"); %>",
	kuroshio_access: "<% nvram_get_x("", "kuroshio_access"); %>",
	kuroshio_log: "<% nvram_get_x("", "kuroshio_log"); %>",
	/* Token 不送到瀏覽器，只告訴頁面有沒有設定 */
	token_set: ('<% nvram_match_x("", "kuroshio_cf_token", "", "0"); %>' == '0') ? '0' : '1'
};
function kuro_text(id) { var el = document.getElementById(id); return el ? el.textContent.replace(/^\n/, '') : null; }
function page_init() {
	var nv = {};
	for (var k in KURO_NV) if (k != 'token_set') nv[k] = TW.unent(KURO_NV[k]);
	window.KURO_FILES = {
		rules: kuro_text('kuro-rules'),
		bench: { 'iplist.txt': kuro_text('kuro-b1'), 'dohlist.txt': kuro_text('kuro-b2'), 'dotlist.txt': kuro_text('kuro-b3'),
			'doqlist.txt': kuro_text('kuro-b4'), 'web.txt': kuro_text('kuro-b5'), 'blacklist.txt': kuro_text('kuro-b6') }
	};
	KURO.start({ nv: nv, uci: kuro_text('kuro-uci') });
}
</script>
</head>

<body onload="TW.start('internet', page_init);" onunLoad="return unload_body();">
<div class="wrapper">
	<div class="container-fluid" style="padding-right: 0px">
		<div class="row-fluid">
			<div class="span3"><center><div id="logo"></div></center></div>
			<div class="span9"><div id="TopBanner"></div></div>
		</div>
	</div>
	<div id="Loading" class="popup_bg"></div>
	<iframe name="hidden_frame" id="hidden_frame" src="" width="0" height="0" frameborder="0"></iframe>
	<!-- 設定檔原文（xmp 不解析 HTML 實體，內容原樣保留） -->
	<xmp id="kuro-uci" hidden>
<% nvram_dump("kuroshio.kuroshio.uci",""); %></xmp>
	<xmp id="kuro-rules" hidden>
<% nvram_dump("kuroshio.custom-rules.txt",""); %></xmp>
	<xmp id="kuro-b1" hidden>
<% nvram_dump("kuroshio.benchmark/iplist.txt",""); %></xmp>
	<xmp id="kuro-b2" hidden>
<% nvram_dump("kuroshio.benchmark/dohlist.txt",""); %></xmp>
	<xmp id="kuro-b3" hidden>
<% nvram_dump("kuroshio.benchmark/dotlist.txt",""); %></xmp>
	<xmp id="kuro-b4" hidden>
<% nvram_dump("kuroshio.benchmark/doqlist.txt",""); %></xmp>
	<xmp id="kuro-b5" hidden>
<% nvram_dump("kuroshio.benchmark/web.txt",""); %></xmp>
	<xmp id="kuro-b6" hidden>
<% nvram_dump("kuroshio.benchmark/blacklist.txt",""); %></xmp>
	<form method="post" name="form" id="ruleForm" action="/start_apply.htm" target="hidden_frame" onsubmit="return false;">
	<input type="hidden" name="current_page" value="tw_kuroshio.asp">
	<div class="container-fluid">
		<div class="row-fluid">
			<div class="span3">
				<div class="well sidebar-nav side_nav" style="padding: 0px;">
					<ul id="mainMenu" class="clearfix"></ul>
					<ul class="clearfix"><li><div id="subMenu" class="accordion"></div></li></ul>
				</div>
			</div>
			<div class="span9">
				<div id="tabMenu"></div>
				<div id="tw-page" class="tw-page"></div>
			</div>
		</div>
	</div>
	</form>
	<div id="footer"></div>
</div>
</body>
</html>
