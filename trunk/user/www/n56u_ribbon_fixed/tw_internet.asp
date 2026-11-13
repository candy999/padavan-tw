<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - 網際網路</title>
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
<script type="text/javascript" src="/tw_ui.js"></script>
<script>
/* padavan-tw：網際網路：連線方式對不對？（docs/HANDOFF-UI.md 5.5） */
<% login_state_hook(); %>
var NV = {
	wan_proto: "<% nvram_get_x("", "wan_proto"); %>",
	pppoe_user: "<% nvram_get_x("", "wan_pppoe_username"); %>",
	pppoe_mtu: "<% nvram_get_x("", "wan_pppoe_mtu"); %>",
	pppoe_mru: "<% nvram_get_x("", "wan_pppoe_mru"); %>",
	wan_mtu: "<% nvram_get_x("", "wan_mtu"); %>",
	wan_ip: "<% nvram_get_x("", "wan_ipaddr"); %>",
	wan_mask: "<% nvram_get_x("", "wan_netmask"); %>",
	wan_gw: "<% nvram_get_x("", "wan_gateway"); %>",
	dns_auto: "<% nvram_get_x("", "wan_dnsenable_x"); %>",
	dns1: "<% nvram_get_x("", "wan_dns1_x"); %>",
	dns2: "<% nvram_get_x("", "wan_dns2_x"); %>",
	ipv6: "<% nvram_get_x("", "ipv6_service"); %>",
	kuro_on: "<% nvram_get_x("", "kuroshio_enable"); %>",
	kuro_domain: "<% nvram_get_x("", "kuroshio_domain"); %>",
	kuro_ddns: "<% nvram_get_x("", "kuroshio_ddns"); %>",
	kuro_dot: "<% nvram_get_x("", "kuroshio_dot"); %>",
	kuro_doh: "<% nvram_get_x("", "kuroshio_doh"); %>",
	kuro_doq: "<% nvram_get_x("", "kuroshio_doq"); %>",
	kuro_wan: "<% nvram_get_x("", "kuroshio_wan"); %>",
	sw_mode: "<% nvram_get_x("", "sw_mode"); %>",
	lan_ip: "<% nvram_get_x("", "lan_ipaddr"); %>"
};
</script>
<script type="text/javascript" src="/tw_p_internet.js"></script>
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
	<form method="post" name="form" id="ruleForm" action="/start_apply.htm" target="hidden_frame" onsubmit="return false;">
	<input type="hidden" name="current_page" value="tw_internet.asp">
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
