<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - 遠端與分享</title>
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
<script type="text/javascript" src="/qrcode.js"></script>
<script type="text/javascript" src="/wg.js"></script>
<script type="text/javascript" src="/tw_ui.js"></script>
<script>
/* padavan-tw：遠端與分享：外出怎麼連回家？外面怎麼連進來？（docs/HANDOFF-UI.md 5.5） */
<% login_state_hook(); %>
var NV = {
	wgs_on: "<% nvram_get_x("", "wgs_enable"); %>",
	wgs_port: "<% nvram_get_x("", "wgs_port"); %>",
	wgs_addr: "<% nvram_get_x("", "wgs_addr"); %>",
	wgs_host: "<% nvram_get_x("", "wgs_host"); %>",
	wgs_pub: "<% nvram_get_x("", "wgs_pubkey"); %>",
	wgs_lan_nat: "<% nvram_get_x("", "wgs_lan_nat"); %>",
	kuro_on: "<% nvram_get_x("", "kuroshio_enable"); %>",
	kuro_domain: "<% nvram_get_x("", "kuroshio_domain"); %>",
	kuro_ddns: "<% nvram_get_x("", "kuroshio_ddns"); %>",
	ddns_on: "<% nvram_get_x("", "ddns_enable_x"); %>",
	ddns_host: "<% nvram_get_x("", "ddns_hostname_x"); %>",
	wan_ip: "<% nvram_get_x("", "wan0_ipaddr"); %>",
	lan_ip: "<% nvram_get_x("", "lan_ipaddr"); %>",
	lan_mask: "<% nvram_get_x("", "lan_netmask"); %>",
	vts_on: "<% nvram_get_x("", "vts_enable_x"); %>",
	vts_num: "<% nvram_get_x("", "vts_num_x"); %>",
	upnp: "<% nvram_get_x("", "upnp_enable_x"); %>"
};
var WGPEERS = [<% get_nvram_list("WIREGUARD", "WGSPeerList", "wgs_psk_x"); %>];
var VSLIST = [<% get_nvram_list("IPConnection", "VSList"); %>];
</script>
<script type="text/javascript" src="/tw_p_remote.js"></script>
</head>

<body onload="TW.start('remote', page_init);" onunLoad="return unload_body();">
<div class="wrapper">
	<div class="container-fluid" style="padding-right: 0px">
		<div class="row-fluid">
			<div class="span3"><center><div id="logo"></div></center></div>
			<div class="span9"><div id="TopBanner"></div></div>
		</div>
	</div>
	<div id="Loading" class="popup_bg"></div>
	<iframe name="hidden_frame" id="hidden_frame" src="" width="0" height="0" frameborder="0"></iframe>
	<form method="post" name="form" id="ruleForm" action="/start_apply.htm" target="hidden_frame" onsubmit="return false;">
	<input type="hidden" name="current_page" value="tw_remote.asp">
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
