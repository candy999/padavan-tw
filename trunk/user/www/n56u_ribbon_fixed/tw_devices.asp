<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - 裝置</title>
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
/* padavan-tw：裝置：誰在用網路？某台怎麼了？（docs/HANDOFF-UI.md 5.5） */
<% login_state_hook(); %>
var NV = {
	lan_ip: "<% nvram_get_x("", "lan_ipaddr"); %>",
	lan_mask: "<% nvram_get_x("", "lan_netmask"); %>",
	dhcp_start: "<% nvram_get_x("", "dhcp_start"); %>",
	dhcp_end: "<% nvram_get_x("", "dhcp_end"); %>",
	dhcp_static: "<% nvram_get_x("", "dhcp_static_x"); %>",
	dhcp_num: "<% nvram_get_x("", "dhcp_staticnum_x"); %>",
	mf_mode: "<% nvram_get_x("", "macfilter_enable_x"); %>",
	mf_num: "<% nvram_get_x("", "macfilter_num_x"); %>"
};
var MDHCP = [<% get_nvram_list("LANHostConfig", "ManualDHCPList"); %>];
var MFLIST = [<% get_nvram_list("FirewallConfig", "MFList"); %>];
</script>
<script type="text/javascript" src="/tw_p_devices.js"></script>
</head>

<body onload="TW.start('devices', page_init);" onunLoad="return unload_body();">
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
	<input type="hidden" name="current_page" value="tw_devices.asp">
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
