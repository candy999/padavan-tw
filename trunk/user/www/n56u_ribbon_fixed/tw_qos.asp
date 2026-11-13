<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - 頻寬管理</title>
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
/* padavan-tw：頻寬管理：怎麼讓視訊、遊戲不卡？（docs/HANDOFF-UI.md 5.5） */
<% login_state_hook(); %>
var NV = {
	qos_mode: "<% nvram_get_x("", "tw_qos_mode"); %>",
	qos_down: "<% nvram_get_x("", "tw_qos_down"); %>",
	qos_up: "<% nvram_get_x("", "tw_qos_up"); %>",
	sqm_on: "<% nvram_get_x("", "sqm_enable"); %>",
	hw_nat: "<% nvram_get_x("", "hw_nat_mode"); %>"
};
</script>
<script type="text/javascript" src="/tw_p_qos.js"></script>
</head>

<body onload="TW.start('qos', page_init);" onunLoad="return unload_body();">
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
	<input type="hidden" name="current_page" value="tw_qos.asp">
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
