<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - 總覽</title>
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
/* padavan-tw：總覽（docs/HANDOFF-UI.md 5.5）。原本的網路地圖移到 Main_NetMap.asp */
var flag = '<% get_parameter("flag"); %>';
if (flag != '')
	location.replace('Main_NetMap.asp?flag=' + encodeURIComponent(flag));

<% login_state_hook(); %>
var NV = {
	productid: "<% nvram_get_x("", "productid"); %>",
	firmver: "<% nvram_get_x("", "firmver_sub"); %>",
	rt_ssid: decodeURIComponent("<% nvram_char_to_ascii("", "rt_ssid"); %>"),
	wl_ssid: decodeURIComponent("<% nvram_char_to_ascii("", "wl_ssid"); %>"),
	rt_psk: decodeURIComponent("<% nvram_char_to_ascii("", "rt_wpa_psk"); %>"),
	wl_psk: decodeURIComponent("<% nvram_char_to_ascii("", "wl_wpa_psk"); %>"),
	rt_auth: "<% nvram_get_x("", "rt_auth_mode"); %>",
	wl_auth: "<% nvram_get_x("", "wl_auth_mode"); %>",
	rt_radio: "<% nvram_get_x("", "rt_radio_x"); %>",
	wl_radio: "<% nvram_get_x("", "wl_radio_x"); %>",
	sw_mode: "<% nvram_get_x("", "sw_mode"); %>"
};
</script>
<script type="text/javascript" src="/tw_p_home.js"></script>
</head>

<body onload="TW.start('home', page_init);" onunLoad="return unload_body();">
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
	<input type="hidden" name="current_page" value="index.asp">
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
