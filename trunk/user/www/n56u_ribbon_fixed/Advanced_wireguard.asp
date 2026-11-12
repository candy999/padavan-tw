<!DOCTYPE html>
<html>
<head>
<title><#Web_Title#> - <#menu5_35#></title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="-1">

<link rel="shortcut icon" href="images/favicon.ico">
<link rel="icon" href="images/favicon.png">
<link rel="stylesheet" type="text/css" href="/bootstrap/css/bootstrap.min.css">
<link rel="stylesheet" type="text/css" href="/bootstrap/css/main.css">
<link rel="stylesheet" type="text/css" href="/bootstrap/css/engage.itoggle.css">

<script type="text/javascript" src="/jquery.js"></script>
<script type="text/javascript" src="/bootstrap/js/bootstrap.min.js"></script>
<script type="text/javascript" src="/bootstrap/js/engage.itoggle.min.js"></script>
<script type="text/javascript" src="/state.js"></script>
<script type="text/javascript" src="/general.js"></script>
<script type="text/javascript" src="/itoggle.js"></script>
<script type="text/javascript" src="/client_function.js"></script>
<script type="text/javascript" src="/popup.js"></script>
<script type="text/javascript" src="/help.js"></script>
<script type="text/javascript" src="/help_b.js"></script>
<script type="text/javascript" src="/qrcode.js"></script>
<script type="text/javascript" src="/wg.js"></script>
<script>
var $j = jQuery.noConflict();
$j(document).ready(function() {
	init_itoggle('wgs_enable', change_wgs_enable);
	init_itoggle('wireguard_enable');
});
</script>
<script>
<% login_state_hook(); %>

var PeerList = [<% get_nvram_list("WIREGUARD", "WGSPeerList", "wgs_psk_x"); %>];
var wgs = {
	pub: '<% nvram_get_x("", "wgs_pubkey"); %>',
	port: '<% nvram_get_x("", "wgs_port"); %>',
	addr: '<% nvram_get_x("", "wgs_addr"); %>',
	host: '<% nvram_get_x("", "wgs_host"); %>',
	ddns_on: '<% nvram_get_x("", "ddns_enable_x"); %>',
	ddns: '<% nvram_get_x("", "ddns_hostname_x"); %>',
	wan: '<% nvram_get_x("", "wan0_ipaddr"); %>',
	lan_ip: '<% nvram_get_x("", "lan_ipaddr"); %>',
	lan_mask: '<% nvram_get_x("", "lan_netmask"); %>'
};
var MAX_PEERS = 32;

function initial(){
	show_banner(2);
	show_menu(5,17,0);
	showmenu();
	show_footer();
	change_wgs_enable();
	show_peers();
	show_endpoint_hint();
	try {
		if (sessionStorage.getItem("tw_wgs_apply") == "1") {
			sessionStorage.removeItem("tw_wgs_apply");
			applyRule();
		}
	} catch (e) {}
}

function showmenu(){
	showhide_div('allink', found_app_aliddns());
	showhide_div('zelink', found_app_zerotier());
	showhide_div('ddlink', found_app_ddnsto());
}

function change_wgs_enable(){
	var on = document.form.wgs_enable[0].checked;
	showhide_div('wgs_settings', on);
	showhide_div('wgs_peers_box', on);
}

function default_endpoint_host(){
	if (wgs.host != "") return wgs.host;
	if (wgs.ddns_on == "1" && wgs.ddns != "") return wgs.ddns;
	if (wgs.wan != "" && wgs.wan != "0.0.0.0") return wgs.wan;
	return "";
}

function show_endpoint_hint(){
	var h = default_endpoint_host(), msg;
	document.form.wgs_host.placeholder = h ? h : "例如 home.example.net";
	if (wgs.host == "" && wgs.ddns_on == "1" && wgs.ddns != "")
		msg = "空白時使用 DDNS 名稱 " + wgs.ddns + "。";
	else if (wgs.host == "" && h != "")
		msg = "空白時使用目前的 WAN IP " + h + "；浮動 IP 會變，建議設定 DDNS（黑潮 DNS 或「DDNS」頁）。";
	else
		msg = "裝置在外面連線時用的網域或 IP。";
	var ip = (wgs.host == "" ? h : "");
	if (ip != "" && tw_wg.is_private_ip(ip))
		msg += "<br><b>注意：WAN 拿到的是私人位址（" + ip + "），外面連不進來。</b>可能是數據機還在路由模式（改成橋接）、或是業者給的共用 IP（CGNAT，要向業者申請實體 IP）。";
	$("wgs_host_hint").innerHTML = msg;
}

function vpn_net3(){
	var a = (wgs.addr || "10.66.0.1").split(".");
	return a[0] + "." + a[1] + "." + a[2];
}

function show_peers(){
	var code = '<table width="100%" cellspacing="0" cellpadding="4" align="center" class="table table-list">';
	if (PeerList.length == 0) {
		code += '<tr><td colspan="4"><div class="tw-hint">還沒有裝置。在下面輸入名稱並按「產生設定」。</div></td></tr>';
	} else {
		for (var i = 0; i < PeerList.length; i++) {
			code += '<tr id="row' + i + '">';
			code += '<td width="35%">' + escapeHTML(PeerList[i][0]) + '</td>';
			code += '<td width="25%">' + vpn_net3() + '.' + escapeHTML(PeerList[i][3]) + '</td>';
			code += '<td width="35%" style="word-break:break-all;"><small>' + escapeHTML((PeerList[i][1] || "").substr(0, 12)) + '…</small></td>';
			code += '<td width="5%" style="text-align:center;"><input type="checkbox" name="WGSPeerList_s" value="' + i + '" onClick="changeBgColor(this,' + i + ');" id="check' + i + '"></td>';
			code += '</tr>';
		}
		code += '<tr><td colspan="3">&nbsp;</td><td style="padding-bottom:0;"><button class="btn btn-danger" type="submit" onclick="return markGroupPeer(this, \' Del \');" name="WGSPeerList" title="刪除選取的裝置"><i class="icon icon-minus icon-white"></i></button></td></tr>';
	}
	code += '</table>';
	$("WGSPeerList_Block").innerHTML = code;
}

function escapeHTML(s){
	return String(s).replace(/[&<>"']/g, function (c) {
		return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
	});
}

function next_free_host(){
	var used = {}, i, own = parseInt((wgs.addr || "10.66.0.1").split(".")[3], 10);
	used[own] = 1;
	for (i = 0; i < PeerList.length; i++)
		used[parseInt(PeerList[i][3], 10)] = 1;
	for (i = 2; i <= 254; i++)
		if (!used[i]) return i;
	return 0;
}

function gen_peer(){
	var name = document.form.wgs_name_x_0.value.replace(/^\s+|\s+$/g, "");
	document.form.wgs_name_x_0.value = name;
	if (!tw_wg.supported()) {
		alert("這個瀏覽器不支援產生金鑰，請改用較新的 Chrome、Edge、Safari 或 Firefox。");
		return;
	}
	if (wgs.pub == "") {
		alert("還沒有伺服器金鑰：請先開啟伺服器並按「套用」，路由器會產生金鑰。");
		return;
	}
	if (name == "") {
		alert("請輸入裝置名稱，例如「我的手機」。");
		document.form.wgs_name_x_0.focus();
		return;
	}
	for (var i = 0; i < PeerList.length; i++) {
		if (PeerList[i][0] == name) {
			alert("已經有叫「" + name + "」的裝置了。");
			return;
		}
	}
	if (PeerList.length >= MAX_PEERS) {
		alert("最多 " + MAX_PEERS + " 台裝置。");
		return;
	}
	var host = default_endpoint_host();
	if (host == "") {
		alert("請先填「裝置連線位址」（網域或 IP）。");
		document.form.wgs_host.focus();
		return;
	}
	var n = next_free_host();
	if (!n) { alert("VPN 網段的位址用完了。"); return; }

	var k = tw_wg.keypair();
	var full = document.form.tw_wgs_mode.value == "full";
	var conf = tw_wg.client_conf({
		priv: k.priv, psk: k.psk,
		addr: vpn_net3() + "." + n,
		dns: wgs.lan_ip,
		serverPub: wgs.pub,
		endpoint: host + ":" + (wgs.port || "51820"),
		full: full,
		lanCidr: tw_wg.lan_cidr(wgs.lan_ip, wgs.lan_mask),
		vpnNet: vpn_net3() + ".0/24"
	});
	document.form.wgs_pub_x_0.value = k.pub;
	document.form.wgs_psk_x_0.value = k.psk;
	document.form.wgs_ip_x_0.value = n;

	$("tw_wgs_conf").value = conf;
	$("tw_wgs_qr").innerHTML = tw_wg.qr_svg(conf);
	var a = $("tw_wgs_dl");
	a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(conf);
	a.setAttribute("download", name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") + "-wg.conf");
	if (a.getAttribute("download") == "-wg.conf") a.setAttribute("download", "padavan-tw-wg.conf");
	showhide_div("tw_wgs_result", 1);
}

function markGroupPeer(o, b){
	document.form.group_id.value = "WGSPeerList";
	if (b == " Add ") {
		if (document.form.wgs_pub_x_0.value == "" || document.form.wgs_name_x_0.value == "") {
			alert("請先按「產生設定」。");
			return false;
		}
	} else {
		var any = false, c = document.form.WGSPeerList_s;
		if (c) {
			if (c.length === undefined) any = c.checked;
			else for (var i = 0; i < c.length; i++) if (c[i].checked) any = true;
		}
		if (!any) { alert("請先勾選要刪除的裝置。"); return false; }
		if (!confirm("刪除後這些裝置就連不進來了，確定刪除？")) return false;
	}
	try { sessionStorage.setItem("tw_wgs_apply", "1"); } catch (e) {}
	pageChanged = 0;
	document.form.current_page.value = "/Advanced_wireguard.asp";
	document.form.action_mode.value = b;
	return true;
}

function validForm(){
	if (document.form.wgs_enable[0].checked) {
		if (!validate_range(document.form.wgs_port, 1, 65535))
			return false;
		var a = document.form.wgs_addr.value.split(".");
		if (a.length != 4 || parseInt(a[3], 10) < 1 || parseInt(a[3], 10) > 254) {
			alert("VPN 位址格式是 10.66.0.1 這樣的 IPv4 位址。");
			document.form.wgs_addr.focus();
			return false;
		}
		if (tw_wg.lan_cidr(document.form.wgs_addr.value, "255.255.255.0") == tw_wg.lan_cidr(wgs.lan_ip, "255.255.255.0")) {
			alert("VPN 網段不能跟區網一樣。");
			document.form.wgs_addr.focus();
			return false;
		}
	}
	return true;
}

function applyRule(){
	if (validForm()) {
		showLoading();
		document.form.group_id.value = "";
		document.form.action_mode.value = " Restart ";
		document.form.current_page.value = "/Advanced_wireguard.asp";
		document.form.next_page.value = "";
		document.form.submit();
	}
}

function copy_conf(){
	var t = $("tw_wgs_conf");
	t.select();
	try { document.execCommand("copy"); } catch (e) {}
}

function done_validating(action){
	refreshpage();
}
</script>
</head>

<body onload="initial();" onunLoad="return unload_body();">

<div class="wrapper">
	<div class="container-fluid" style="padding-right: 0px">
		<div class="row-fluid">
			<div class="span3"><center><div id="logo"></div></center></div>
			<div class="span9" >
				<div id="TopBanner"></div>
			</div>
		</div>
	</div>

	<div id="Loading" class="popup_bg"></div>

	<iframe name="hidden_frame" id="hidden_frame" src="" width="0" height="0" frameborder="0"></iframe>

	<form method="post" name="form" id="ruleForm" action="/start_apply.htm" target="hidden_frame">

	<input type="hidden" name="current_page" value="Advanced_wireguard.asp">
	<input type="hidden" name="next_page" value="">
	<input type="hidden" name="next_host" value="">
	<input type="hidden" name="sid_list" value="WIREGUARD;">
	<input type="hidden" name="group_id" value="">
	<input type="hidden" name="action_mode" value="">
	<input type="hidden" name="action_script" value="">


	<div class="container-fluid">
		<div class="row-fluid">
			<div class="span3">
				<!--Sidebar content-->
				<!--=====Beginning of Main Menu=====-->
				<div class="well sidebar-nav side_nav" style="padding: 0px;">
					<ul id="mainMenu" class="clearfix"></ul>
					<ul class="clearfix">
						<li>
							<div id="subMenu" class="accordion"></div>
						</li>
					</ul>
				</div>
			</div>

			<div class="span9">
				<!--Body content-->
				<div class="row-fluid">
					<div class="span12">
						<div class="box well grad_colour_dark_blue">
							<h2 class="box_head round_top"><#menu5_30#> - <#menu5_35#></h2>
							<div class="round_bottom">
							<div>
                            <ul class="nav nav-tabs" style="margin-bottom: 10px;">
								<li id="allink" style="display:none">
                                    <a href="Advanced_aliddns.asp"><#menu5_23_1#></a>
                                </li>
								<li id="zelink" style="display:none">
                                    <a href="Advanced_zerotier.asp"><#menu5_32_1#></a>
                                </li>
								<li id="ddlink" style="display:none">
                                    <a href="Advanced_ddnsto.asp"><#menu5_34_1#></a>
                                </li>
								<li class="active">
                                    <a href="Advanced_wireguard.asp"><#menu5_35_1#></a>
                                </li>
                            </ul>
                        </div>
								<div class="row-fluid">
									<div id="tabMenu" class="submenuBlock"></div>
									<div class="alert alert-info" style="margin: 10px;">
										<b>WireGuard 伺服器</b>：在外面用手機、筆電連回家，存取家裡的 NAS、攝影機、印表機，或透過家裡的網路上網。<br>
										每台裝置有自己的金鑰；裝置的私鑰只在這個瀏覽器裡產生、只顯示一次，路由器不會保存。
									</div>
									<input type="hidden" name="wgs_num_x_0" value="<% nvram_get_x("", "wgs_num_x"); %>" readonly="1" />
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th width="40%" style="border-top: 0 none;">啟用 WireGuard 伺服器</th>
											<td style="border-top: 0 none;">
												<div class="main_itoggle">
													<div id="wgs_enable_on_of">
														<input type="checkbox" id="wgs_enable_fake" <% nvram_match_x("", "wgs_enable", "1", "value=1 checked"); %><% nvram_match_x("", "wgs_enable", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="wgs_enable" id="wgs_enable_1" class="input" <% nvram_match_x("", "wgs_enable", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="wgs_enable" id="wgs_enable_0" class="input" <% nvram_match_x("", "wgs_enable", "0", "checked"); %> /><#checkbox_No#>
												</div>
											</td>
										</tr>
									</table>
									<div id="wgs_settings">
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th width="40%">連線埠（UDP）</th>
											<td>
												<input type="text" maxlength="5" size="6" class="input" name="wgs_port" value="<% nvram_get_x("", "wgs_port"); %>" onkeypress="return is_number(this,event);" />
												<div class="tw-hint">預設 51820。路由器會自動開放這個連線埠。</div>
											</td>
										</tr>
										<tr>
											<th>VPN 位址（伺服器）</th>
											<td>
												<input type="text" maxlength="15" size="15" class="input" name="wgs_addr" value="<% nvram_get_x("", "wgs_addr"); %>" />
												<div class="tw-hint">裝置會拿到同一個 /24 網段的位址，不能跟家裡區網相同。</div>
											</td>
										</tr>
										<tr>
											<th>裝置連線位址</th>
											<td>
												<input type="text" maxlength="128" class="input" name="wgs_host" value="<% nvram_get_x("", "wgs_host"); %>" style="width: 260px;" />
												<div class="tw-hint" id="wgs_host_hint"></div>
											</td>
										</tr>
										<tr>
											<th>連到家裡裝置時</th>
											<td>
												<select name="wgs_lan_nat" class="input">
													<option value="1" <% nvram_match_x("", "wgs_lan_nat", "1", "selected"); %>>用路由器的位址 (*)</option>
													<option value="0" <% nvram_match_x("", "wgs_lan_nat", "0", "selected"); %>>保留 VPN 位址</option>
												</select>
												<div class="tw-hint">NAS、攝影機常只接受「同一個區網」的連線，用路由器的位址最不容易出問題。要在 NAS 上看到是哪台裝置連進來，才改成保留 VPN 位址。</div>
											</td>
										</tr>
										<tr>
											<th>伺服器公鑰</th>
											<td style="word-break: break-all;">
												<code id="wgs_pub_show"><% nvram_get_x("", "wgs_pubkey"); %></code>
												<div class="tw-hint">第一次啟用並按「套用」時由路由器產生。</div>
											</td>
										</tr>
									</table>
									</div>
									<div id="wgs_peers_box">
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th colspan="4" style="background-color: #E3E3E3;">裝置（最多 32 台）</th>
										</tr>
										<tr>
											<th width="35%">名稱</th>
											<th width="25%">VPN 位址</th>
											<th width="35%">公鑰</th>
											<th width="5%">&nbsp;</th>
										</tr>
									</table>
									<div id="WGSPeerList_Block"></div>
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th width="40%">新增裝置</th>
											<td>
												<input type="text" maxlength="32" class="input" name="wgs_name_x_0" value="" placeholder="例如：我的手機" />
												<select name="tw_wgs_mode" class="input" style="width:auto;">
													<option value="full" selected>全部流量走家裡（公共 Wi-Fi 較安全）</option>
													<option value="home">只有連回家裡的網路才走 VPN</option>
												</select>
												<input type="hidden" name="wgs_pub_x_0" value="" />
												<input type="hidden" name="wgs_psk_x_0" value="" />
												<input type="hidden" name="wgs_ip_x_0" value="" />
												<div><input class="btn" type="button" value="產生設定" onclick="gen_peer()" style="margin-top:6px;" /></div>
											</td>
										</tr>
									</table>
									<div id="tw_wgs_result" style="display:none;">
										<div class="alert alert-warning" style="margin: 10px;">
											<b>這份設定只會出現這一次。</b>用手機的 WireGuard App 掃描 QR 碼，或把設定檔存到電腦，然後按「儲存這台裝置」。
										</div>
										<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
											<tr>
												<td style="text-align:center;"><div id="tw_wgs_qr" style="display:inline-block;background:#fff;padding:6px;border-radius:8px;"></div></td>
											</tr>
											<tr>
												<td>
													<textarea id="tw_wgs_conf" class="input" rows="11" readonly style="width:100%;font-family:monospace;font-size:12px;box-sizing:border-box;"></textarea>
													<div style="margin-top:6px;">
														<a class="btn" id="tw_wgs_dl" href="#">下載設定檔</a>
														<input class="btn" type="button" value="複製" onclick="copy_conf()" />
														<button class="btn btn-primary" type="submit" name="WGSPeerList2" onclick="return markGroupPeer(this, ' Add ');">儲存這台裝置</button>
													</div>
												</td>
											</tr>
										</table>
									</div>
									</div>

									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th colspan="2" style="background-color: #E3E3E3;">WireGuard 用戶端（連到別的 WireGuard 伺服器）</th>
										</tr>
										<tr>
											<th width="40%">啟用用戶端</th>
											<td>
												<div class="main_itoggle">
													<div id="wireguard_enable_on_of">
														<input type="checkbox" id="wireguard_enable_fake" <% nvram_match_x("", "wireguard_enable", "1", "value=1 checked"); %><% nvram_match_x("", "wireguard_enable", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="wireguard_enable" id="wireguard_enable_1" class="input" <% nvram_match_x("", "wireguard_enable", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="wireguard_enable" id="wireguard_enable_0" class="input" <% nvram_match_x("", "wireguard_enable", "0", "checked"); %> /><#checkbox_No#>
												</div>
											</td>
										</tr>
										<tr>
											<th>本機私鑰</th>
											<td><input type="text" class="input" name="wireguard_localkey" style="width: 260px" value="<% nvram_get_x("","wireguard_localkey"); %>" /></td>
										</tr>
										<tr>
											<th>本機位址（例如 10.0.0.2/24）</th>
											<td><input type="text" class="input" name="wireguard_localip" style="width: 260px" value="<% nvram_get_x("","wireguard_localip"); %>" /></td>
										</tr>
										<tr>
											<th>對方公鑰</th>
											<td><input type="text" class="input" name="wireguard_peerkey" style="width: 260px" value="<% nvram_get_x("","wireguard_peerkey"); %>" /></td>
										</tr>
										<tr>
											<th>對方位址:連線埠（例如 vpn.example.net:51820）</th>
											<td><input type="text" class="input" name="wireguard_peerip" style="width: 260px" value="<% nvram_get_x("","wireguard_peerip"); %>" /></td>
										</tr>
										<tr>
											<td colspan="2" style="border-top: 0 none;">
												<br />
												<center><input class="btn btn-primary" style="width: 219px" type="button" value="<#CTL_apply#>" onclick="applyRule()" /></center>
											</td>
										</tr>
									</table>

										
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	</form>

	<div id="footer"></div>
</div>
</body>
</html>

