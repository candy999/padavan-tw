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
<script>
var $j = jQuery.noConflict();
$j(document).ready(function() {
	init_itoggle('kuroshio_enable', change_enable);
	init_itoggle('kuroshio_ddns');
	init_itoggle('kuroshio_dot');
	init_itoggle('kuroshio_doq');
	init_itoggle('kuroshio_doh', change_doh);
	init_itoggle('kuroshio_wan', change_doh);
});
</script>
<script>
<% login_state_hook(); %>
<% kuroshio_status(); %>

var cf_token_set = ('<% nvram_match_x("", "kuroshio_cf_token", "", "0"); %>' != '0');

function initial(){
	show_banner(2);
	show_menu(5,16);
	show_footer();
	show_status();
	change_enable();
	change_doh();
	if (cf_token_set)
		document.form.kuroshio_cf_token.placeholder = "已設定（留空表示不變）";
	tw_kuroshio_cmd("kuroshio.sh status", "kuro_info", true);
}

function show_status(){
	var st = (typeof kuroshio_status == "function") ? kuroshio_status() : 0;
	var t, c;
	if (st == 2) { t = "接管 DNS 中"; c = "label-success"; }
	else if (st == 1) { t = "執行中，暫時使用業者 DNS（保護機制）"; c = "label-warning"; }
	else { t = "沒有執行"; c = "label"; }
	$("kuro_state").innerHTML = '<span class="label ' + c + '">' + t + '</span>';
}

function change_enable(){
	showhide_div("kuro_settings", document.form.kuroshio_enable[0].checked);
}

function change_doh(){
	var doh = document.form.kuroshio_doh[0].checked, wan = document.form.kuroshio_wan[0].checked;
	showhide_div("row_doh_port", doh);
	showhide_div("row_doh_wan_port", doh && wan);
}

function validForm(){
	var d = document.form.kuroshio_domain.value.replace(/^\s+|\s+$/g, "");
	document.form.kuroshio_domain.value = d;
	if (d != "" && !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(d)) {
		alert("網域格式不正確，例如 dns.example.net");
		document.form.kuroshio_domain.focus();
		return false;
	}
	var enc = document.form.kuroshio_dot[0].checked || document.form.kuroshio_doq[0].checked || document.form.kuroshio_doh[0].checked;
	if (enc && d == "") {
		alert("加密 DNS（DoT／DoQ／DoH）需要網域與憑證，請先填網域。");
		document.form.kuroshio_domain.focus();
		return false;
	}
	if (document.form.kuroshio_ddns[0].checked && (d == "" || (!cf_token_set && document.form.kuroshio_cf_token.value == ""))) {
		alert("DDNS 需要網域與 Cloudflare API Token。");
		return false;
	}
	if (!validate_range(document.form.kuroshio_doh_port, 1, 65535) || !validate_range(document.form.kuroshio_doh_wan_port, 1, 65535))
		return false;
	return true;
}

function applyRule(){
	if (!validForm())
		return;
	/* Token 留空＝不變：不送出這個欄位 */
	if (document.form.kuroshio_cf_token.value == "")
		document.form.kuroshio_cf_token.disabled = true;
	showLoading();
	document.form.action_mode.value = " Restart ";
	document.form.current_page.value = "/Advanced_kuroshio.asp";
	document.form.next_page.value = "";
	document.form.submit();
}

/* 在路由器上執行指令並顯示結果（後台原有的指令機制，只限區網登入） */
function tw_kuroshio_cmd(cmd, out_id, quiet, done){
	var o = document.getElementById(out_id);
	if (typeof login_safe == "function" && !login_safe()) {
		if (!quiet) alert("只能在區網登入時使用。");
		return;
	}
	if (!quiet) { o.style.display = ""; o.textContent = "執行中…"; }
	$j.post('/apply.cgi', {
		'action_mode': ' SystemCmd ',
		'current_page': 'console_response.asp',
		'next_page': 'console_response.asp',
		'SystemCmd': cmd
	}, function () {
		$j.ajax({ url: '/console_response.asp', cache: false, timeout: 30000,
			success: function (data) {
				var t = String(data).replace(/^\s+|\s+$/g, "");
				o.style.display = t ? "" : "none";
				o.textContent = t;
				if (out_id == "kuro_info")
					showhide_div("row_rwfs", t.indexOf("RWFS 裡有其他資料") >= 0);
				if (done) done(t);
			},
			error: function () { if (!quiet) o.textContent = "讀取失敗"; }
		});
	});
}

var acme_timer = null;
function acme_issue(force){
	if (!confirm("用 Cloudflare DNS 驗證向 Let's Encrypt 申請憑證，約 1～3 分鐘。\n請先儲存網域與 Cloudflare API Token。開始？"))
		return;
	tw_kuroshio_cmd("kuroshio.sh acme-bg" + (force ? " force" : ""), "kuro_acme", false, function () {
		clearInterval(acme_timer);
		acme_timer = setInterval(function () {
			tw_kuroshio_cmd("kuroshio.sh acme-log", "kuro_acme", true, function (t) {
				if (t.indexOf("== 結束") >= 0) {
					clearInterval(acme_timer);
					tw_kuroshio_cmd("kuroshio.sh status", "kuro_info", true);
				}
			});
		}, 4000);
	});
}

function rwfs_enable(){
	if (!confirm("RWFS 分割區裡有其他資料（可能是原廠韌體備援）。\n這會清空它、格式化成 UBIFS 給黑潮 DNS 放學習資料，原本的資料無法復原。\n完成後要重新開機。確定？"))
		return;
	tw_kuroshio_cmd("rwfs2ubi.sh", "kuro_rwfs_out", false);
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

	<input type="hidden" name="current_page" value="Advanced_kuroshio.asp">
	<input type="hidden" name="next_page" value="">
	<input type="hidden" name="next_host" value="">
	<input type="hidden" name="sid_list" value="KuroshioConf;">
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
							<h2 class="box_head round_top"><#menu5_29#> - 黑潮 DNS</h2>
							<div class="round_bottom">
								<div class="row-fluid">
									<div id="tabMenu" class="submenuBlock"></div>
									<div class="alert alert-info" style="margin: 10px;">
										<b>黑潮 DNS</b>：找出真正在台灣的 CDN 節點、每天挑最快且沒有汙染的上游、過濾廣告與詐騙網站，並提供加密 DNS（DoT／DoH／DoQ）與 DDNS、憑證。<br>
										開啟後由路由器的 DNS 轉給黑潮 DNS；黑潮 DNS 沒有回應時會自動暫時改用業者 DNS，不會斷網。
										<a href="https://github.com/candy999/kuroshio-dns" target="_blank">專案網站</a>（GPL-3.0）
									</div>
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th width="40%" style="border-top: 0 none;">啟用黑潮 DNS</th>
											<td style="border-top: 0 none;">
												<div class="main_itoggle">
													<div id="kuroshio_enable_on_of">
														<input type="checkbox" id="kuroshio_enable_fake" <% nvram_match_x("", "kuroshio_enable", "1", "value=1 checked"); %><% nvram_match_x("", "kuroshio_enable", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="kuroshio_enable" id="kuroshio_enable_1" class="input" <% nvram_match_x("", "kuroshio_enable", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="kuroshio_enable" id="kuroshio_enable_0" class="input" <% nvram_match_x("", "kuroshio_enable", "0", "checked"); %> /><#checkbox_No#>
												</div>
												<div id="kuro_state" style="margin-top:6px;"></div>
											</td>
										</tr>
									</table>
									<div id="kuro_settings">
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th colspan="2" style="background-color: #E3E3E3;">網域、DDNS 與憑證（選用）</th>
										</tr>
										<tr>
											<th width="40%">網域</th>
											<td>
												<input type="text" maxlength="253" class="input" name="kuroshio_domain" value="<% nvram_get_x("", "kuroshio_domain"); %>" placeholder="例如 dns.example.net" style="width: 260px;" />
												<div class="tw-hint">網域要放在 Cloudflare 管理。DDNS、憑證、加密 DNS、WireGuard 的連線位址都會用它。只在家裡用過濾功能的話可以不填。</div>
											</td>
										</tr>
										<tr>
											<th>Cloudflare API Token</th>
											<td>
												<input type="password" maxlength="128" class="input" name="kuroshio_cf_token" value="" autocomplete="new-password" style="width: 260px;" />
												<div class="tw-hint">權限：Zone → DNS → Edit、Zone → Zone → Read。DDNS 與申請憑證共用。</div>
											</td>
										</tr>
										<tr>
											<th width="40%">DDNS（公網 IP 變了自動更新網域）</th>
											<td>
												<div class="main_itoggle">
													<div id="kuroshio_ddns_on_of">
														<input type="checkbox" id="kuroshio_ddns_fake" <% nvram_match_x("", "kuroshio_ddns", "1", "value=1 checked"); %><% nvram_match_x("", "kuroshio_ddns", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="kuroshio_ddns" id="kuroshio_ddns_1" class="input" <% nvram_match_x("", "kuroshio_ddns", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="kuroshio_ddns" id="kuroshio_ddns_0" class="input" <% nvram_match_x("", "kuroshio_ddns", "0", "checked"); %> /><#checkbox_No#>
												</div>
											</td>
										</tr>
										<tr>
											<th>憑證通知信箱（選填）</th>
											<td><input type="text" maxlength="128" class="input" name="kuroshio_acme_email" value="<% nvram_get_x("", "kuroshio_acme_email"); %>" style="width: 260px;" /></td>
										</tr>
										<tr>
											<th>憑證</th>
											<td>
												<input class="btn" type="button" value="申請／更新憑證" onclick="acme_issue(false);" />
												<div class="tw-hint">Let's Encrypt，用 Cloudflare DNS 驗證，不用開 80 埠；之後每天自動檢查續期。同一份憑證也會給路由器後台的 HTTPS 用。</div>
												<pre id="kuro_acme" style="display:none;margin-top:6px;white-space:pre-wrap;max-height:300px;overflow:auto;"></pre>
											</td>
										</tr>
									</table>
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th colspan="2" style="background-color: #E3E3E3;">加密 DNS（要有網域與憑證）</th>
										</tr>
										<tr>
											<th width="40%">DoT（853 埠；Android「私人 DNS」用這個）</th>
											<td>
												<div class="main_itoggle">
													<div id="kuroshio_dot_on_of">
														<input type="checkbox" id="kuroshio_dot_fake" <% nvram_match_x("", "kuroshio_dot", "1", "value=1 checked"); %><% nvram_match_x("", "kuroshio_dot", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="kuroshio_dot" id="kuroshio_dot_1" class="input" <% nvram_match_x("", "kuroshio_dot", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="kuroshio_dot" id="kuroshio_dot_0" class="input" <% nvram_match_x("", "kuroshio_dot", "0", "checked"); %> /><#checkbox_No#>
												</div>
											</td>
										</tr>
										<tr>
											<th width="40%">DoQ（853 埠 UDP）</th>
											<td>
												<div class="main_itoggle">
													<div id="kuroshio_doq_on_of">
														<input type="checkbox" id="kuroshio_doq_fake" <% nvram_match_x("", "kuroshio_doq", "1", "value=1 checked"); %><% nvram_match_x("", "kuroshio_doq", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="kuroshio_doq" id="kuroshio_doq_1" class="input" <% nvram_match_x("", "kuroshio_doq", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="kuroshio_doq" id="kuroshio_doq_0" class="input" <% nvram_match_x("", "kuroshio_doq", "0", "checked"); %> /><#checkbox_No#>
												</div>
											</td>
										</tr>
										<tr>
											<th width="40%">DoH／DoH3（瀏覽器、iPhone 描述檔）</th>
											<td>
												<div class="main_itoggle">
													<div id="kuroshio_doh_on_of">
														<input type="checkbox" id="kuroshio_doh_fake" <% nvram_match_x("", "kuroshio_doh", "1", "value=1 checked"); %><% nvram_match_x("", "kuroshio_doh", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="kuroshio_doh" id="kuroshio_doh_1" class="input" <% nvram_match_x("", "kuroshio_doh", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="kuroshio_doh" id="kuroshio_doh_0" class="input" <% nvram_match_x("", "kuroshio_doh", "0", "checked"); %> /><#checkbox_No#>
												</div>
											</td>
										</tr>
										<tr id="row_doh_port">
											<th>DoH 在路由器上的埠</th>
											<td><input type="text" maxlength="5" size="6" class="input" name="kuroshio_doh_port" value="<% nvram_get_x("", "kuroshio_doh_port"); %>" onkeypress="return is_number(this,event);" /></td>
										</tr>
										<tr>
											<th width="40%">開放給外面使用（只讓台灣 IP 連線）</th>
											<td>
												<div class="main_itoggle">
													<div id="kuroshio_wan_on_of">
														<input type="checkbox" id="kuroshio_wan_fake" <% nvram_match_x("", "kuroshio_wan", "1", "value=1 checked"); %><% nvram_match_x("", "kuroshio_wan", "0", "value=0"); %> />
													</div>
												</div>
												<div style="position: absolute; margin-left: -10000px;">
													<input type="radio" value="1" name="kuroshio_wan" id="kuroshio_wan_1" class="input" <% nvram_match_x("", "kuroshio_wan", "1", "checked"); %> /><#checkbox_Yes#>
													<input type="radio" value="0" name="kuroshio_wan" id="kuroshio_wan_0" class="input" <% nvram_match_x("", "kuroshio_wan", "0", "checked"); %> /><#checkbox_No#>
												</div>
												<div class="tw-hint">手機在外面也能用家裡的加密 DNS，家人朋友也能用。來源 IP 是不是台灣由黑潮 DNS 判斷；路由器自動開放對應的埠。</div>
											</td>
										</tr>
										<tr id="row_doh_wan_port">
											<th>DoH 對外的埠</th>
											<td>
												<input type="text" maxlength="5" size="6" class="input" name="kuroshio_doh_wan_port" value="<% nvram_get_x("", "kuroshio_doh_wan_port"); %>" onkeypress="return is_number(this,event);" />
												<div class="tw-hint">外面連這個埠會轉到路由器上的 DoH 埠。預設 443（網址就不用寫埠號）。</div>
											</td>
										</tr>
										<tr>
											<th>外面連線的來源</th>
											<td>
												<select name="kuroshio_access" class="input">
													<option value="taiwan" <% nvram_match_x("", "kuroshio_access", "taiwan", "selected"); %>>只有台灣 IP (*)</option>
													<option value="open" <% nvram_match_x("", "kuroshio_access", "open", "selected"); %>>全部開放</option>
												</select>
											</td>
										</tr>
									</table>
									<table width="100%" align="center" cellpadding="4" cellspacing="0" class="table">
										<tr>
											<th colspan="2" style="background-color: #E3E3E3;">狀態與進階</th>
										</tr>
										<tr>
											<th width="40%">目前狀態</th>
											<td>
												<input class="btn" type="button" value="重新整理" onclick="tw_kuroshio_cmd('kuroshio.sh status', 'kuro_info', false);" />
												<pre id="kuro_info" style="display:none;margin-top:6px;white-space:pre-wrap;"></pre>
											</td>
										</tr>
										<tr id="row_rwfs" style="display:none;">
											<th>學習資料存放</th>
											<td>
												<input class="btn btn-warning" type="button" value="清除 RWFS 並啟用" onclick="rwfs_enable();" />
												<div class="tw-hint">RWFS 裡有其他資料，為了安全沒有自動清除，學習資料暫時放記憶體、每天備份一次。確定不需要那些資料（例如原廠韌體備援）就可以清除，之後跟其他機器一樣直接存在 Flash。</div>
												<pre id="kuro_rwfs_out" style="display:none;margin-top:6px;white-space:pre-wrap;"></pre>
											</td>
										</tr>
										<tr>
											<th>記錄等級</th>
											<td>
												<select name="kuroshio_log" class="input">
													<option value="warn" <% nvram_match_x("", "kuroshio_log", "warn", "selected"); %>>只記警告與錯誤 (*)</option>
													<option value="info" <% nvram_match_x("", "kuroshio_log", "info", "selected"); %>>一般</option>
													<option value="debug" <% nvram_match_x("", "kuroshio_log", "debug", "selected"); %>>除錯（很多）</option>
												</select>
											</td>
										</tr>
										<tr>
											<td colspan="2">
												<b>進階設定</b>（OpenWrt 版同一套 UCI 格式：過濾清單、上游、CDN、社群等）
												<div class="tw-hint">網域、Token、DDNS、DoT／DoQ／DoH、對外開放、來源限制以上方表單為準，在這裡改不會生效。清空後儲存會恢復預設值。</div>
												<textarea rows="16" wrap="off" spellcheck="false" maxlength="65536" class="span12" name="kuroshio.kuroshio.uci" style="font-family:'Courier New'; font-size:12px; margin-top:6px;"><% nvram_dump("kuroshio.kuroshio.uci",""); %></textarea>
											</td>
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
	</div>

	</form>

	<div id="footer"></div>
</div>
</body>
</html>

