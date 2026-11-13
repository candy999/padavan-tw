var sw_mode = '<% nvram_get_x("", "sw_mode"); %>';
var wan_route_x = '<% nvram_get_x("", "wan_route_x"); %>';
var wan_proto = '<% nvram_get_x("", "wan_proto"); %>';
var lan_proto = '<% nvram_get_x("", "lan_proto_x"); %>';
var log_float = '<% nvram_get_x("", "log_float_ui"); %>';
var reboot_schedule_support = '<% nvram_get_x("", "reboot_schedule_enable"); %>';
var log_stamp = 0;
var sysinfo = <% json_system_status(); %>;
var uptimeStr = "<% uptime(); %>";
var timezone = uptimeStr.substring(26,31);
var newformat_systime = uptimeStr.substring(8,11) + " " + uptimeStr.substring(5,7) + " " + uptimeStr.substring(17,25) + " " + uptimeStr.substring(12,16);  //Ex format: Jun 23 10:33:31 2008
var systime_millsec = Date.parse(newformat_systime); // millsec from system
var JS_timeObj = new Date(); // 1970.1.1
var cookie_pref = 'n56u_cookie_';
var ss_schedule_support = '<% nvram_get_x("", "ss_schedule_enable"); %>';
var uagent = navigator.userAgent.toLowerCase();
var is_ie11p = (/trident\/7\./).test(uagent);
var is_mobile = (/iphone|ipod|ipad|iemobile|android|blackberry|fennec/).test(uagent);

var new_wan_internet = '<% nvram_get_x("", "link_internet"); %>';
var id_check_status = 0;
var id_system_info = 0;

var cookie = {
	set: function(key, value, days) {
		document.cookie = cookie_pref + key + '=' + value + '; expires=' +
			(new Date(new Date().getTime() + ((days ? days : 14) * 86400000))).toUTCString() + '; path=/';
	},
	get: function(key) {
		var r = ('; ' + document.cookie + ';').match('; ' + cookie_pref + key + '=(.*?);');
		return r ? r[1] : null;
	},
	unset: function(key) {
		document.cookie = cookie_pref + key + '=; expires=' + (new Date(1)).toUTCString() + '; path=/';
	}
};

<% firmware_caps_hook(); %>

function get_ap_mode(){
	return (wan_route_x == 'IP_Bridged' || sw_mode == '3') ? true : false;
}

function unload_body(){
	disableCheckChangedStatus();
	no_flash_button();
	return true;
}

function enableCheckChangedStatus(flag){
	var tm_int_sec = 1;

	disableCheckChangedStatus();

	if (new_wan_internet == '0')
		tm_int_sec = 2;
	else if (new_wan_internet == '1')
		tm_int_sec = 5;

	id_check_status = setTimeout("get_changed_status();", tm_int_sec * 1000);
}

function disableCheckChangedStatus(){
	clearTimeout(id_check_status);
}

function update_internet_status(){
	if (new_wan_internet == '1')
		showMapWANStatus(1);
	else if(new_wan_internet == '2')
		showMapWANStatus(2);
	else
		showMapWANStatus(0);
}

function notify_status_internet(wan_internet){
	this.new_wan_internet = wan_internet;
	if((location.pathname == "/" || location.pathname == "/index.asp" || location.pathname == "/Main_NetMap.asp") && (typeof(update_internet_status) === 'function'))
		update_internet_status();
}

function notify_status_vpn_client(vpnc_state){
	if((location.pathname == "/vpncli.asp") && (typeof(update_vpnc_status) === 'function'))
		update_vpnc_status(vpnc_state);
}

function get_changed_status(){
	var $j = jQuery.noConflict();
	$j.ajax({
		type: 'get',
		url: '/status_internet.asp',
		dataType: 'script',
		cache: true,
		error: function(xhr) {
			;
		},
		success: function(response) {
			notify_status_internet(now_wan_internet);
			notify_status_vpn_client(now_vpnc_state);
			enableCheckChangedStatus();
		}
	});
}

function get_system_info(){
	var $j = jQuery.noConflict();
	clearTimeout(id_system_info);
	$j.ajax({
		type: 'get',
		url: '/system_status_data.asp',
		dataType: 'script',
		cache: true,
		error: function(xhr) {
			id_system_info = setTimeout('get_system_info()', 2000);
		},
		success: function(response) {
			id_system_info = setTimeout('get_system_info()', 2000);
			setSystemInfo(response);
		}
	});
}

function bytesToSize(bytes, precision){
	var absval = Math.abs(bytes);
	var kilobyte = 1024;
	var megabyte = kilobyte * 1024;
	var gigabyte = megabyte * 1024;
	var terabyte = gigabyte * 1024;

	if (absval < kilobyte)
		return bytes + ' B';
	else if (absval < megabyte)
		return (bytes / kilobyte).toFixed(precision) + ' KB';
	else if (absval < gigabyte)
		return (bytes / megabyte).toFixed(precision) + ' MB';
	else if (absval < terabyte)
		return (bytes / gigabyte).toFixed(precision) + ' GB';
	else
		return (bytes / terabyte).toFixed(precision) + ' TB';
}

function getLALabelStatus(num){
	var la = parseFloat(num);
	return la > 0.9 ? 'danger' : (la > 0.5 ? 'warning' : 'info');
}

function setSystemInfo(response){
	if(typeof(si_new) !== 'object')
		return;

	var cpu_now = {};
	var cpu_total = (si_new.cpu.total - sysinfo.cpu.total);
	if (!cpu_total)
		cpu_total = 1;

	cpu_now.busy = parseInt((si_new.cpu.busy - sysinfo.cpu.busy) * 100 / cpu_total);
	cpu_now.user = parseInt((si_new.cpu.user - sysinfo.cpu.user) * 100 / cpu_total);
	cpu_now.nice = parseInt((si_new.cpu.nice - sysinfo.cpu.nice) * 100 / cpu_total);
	cpu_now.system = parseInt((si_new.cpu.system - sysinfo.cpu.system) * 100 / cpu_total);
	cpu_now.idle = parseInt((si_new.cpu.idle - sysinfo.cpu.idle) * 100 / cpu_total);
	cpu_now.iowait = parseInt((si_new.cpu.iowait - sysinfo.cpu.iowait) * 100 / cpu_total);
	cpu_now.irq = parseInt((si_new.cpu.irq - sysinfo.cpu.irq) * 100 / cpu_total);
	cpu_now.sirq = parseInt((si_new.cpu.sirq - sysinfo.cpu.sirq) * 100 / cpu_total);

	sysinfo = si_new;

	showSystemInfo(cpu_now,1);
}

function showSystemInfo(cpu_now,force){
	var $j = jQuery.noConflict();
	var arrLA = sysinfo.lavg.split(' ');
	var h = sysinfo.uptime.hours < 10 ? ('0'+sysinfo.uptime.hours) : sysinfo.uptime.hours;
	var m = sysinfo.uptime.minutes < 10 ? ('0'+sysinfo.uptime.minutes) : sysinfo.uptime.minutes;

	$j("#la_info").html('<span class="label label-'+getLALabelStatus(arrLA[0])+'">'+arrLA[0]+'</span>&nbsp;<span class="label label-'+getLALabelStatus(arrLA[1])+'">'+arrLA[1]+'</span>&nbsp;<span class="label label-'+getLALabelStatus(arrLA[2])+'">'+arrLA[2]+'</span>');
	$j("#cpu_info").html(cpu_now.busy + '%');
	$j("#mem_info").html(bytesToSize(sysinfo.ram.free*1024, 0) + " / " + bytesToSize(sysinfo.ram.total*1024, 0));
	// padavan-tw：「23 天 04:12」，不再截字（中文會變成「小」「分」）
	$j("#uptime_info").html(sysinfo.uptime.days + " <#Day#> " + h + ":" + m);

	$j("#cpu_usage tr:nth-child(1) td:first").html('busy: '+cpu_now.busy+'%');
	$j("#cpu_usage tr:nth-child(2) td:first").html('user: '+cpu_now.user+'%');
	$j("#cpu_usage tr:nth-child(2) td:last").html('system: '+cpu_now.system+'%');
	$j("#cpu_usage tr:nth-child(3) td:first").html('sirq: '+cpu_now.sirq+'%');
	$j("#cpu_usage tr:nth-child(3) td:last").html('irq: '+cpu_now.irq+'%');
	$j("#cpu_usage tr:nth-child(4) td:first").html('idle: '+cpu_now.idle+'%');
	$j("#cpu_usage tr:nth-child(4) td:last").html('nice: '+cpu_now.nice+'%');

	$j("#mem_usage tr:nth-child(1) td:first").html('total: '+bytesToSize(sysinfo.ram.total*1024, 2));
	$j("#mem_usage tr:nth-child(2) td:first").html('free: '+bytesToSize(sysinfo.ram.free*1024, 2));
	$j("#mem_usage tr:nth-child(2) td:last").html('used: '+bytesToSize(sysinfo.ram.used*1024, 2));
	$j("#mem_usage tr:nth-child(3) td:first").html('cached: '+bytesToSize(sysinfo.ram.cached*1024, 2));
	$j("#mem_usage tr:nth-child(3) td:last").html('buffers: '+bytesToSize(sysinfo.ram.buffers*1024, 2));
	$j("#mem_usage tr:nth-child(4) td:first").html('swap: '+bytesToSize(sysinfo.swap.total*1024, 2));
	$j("#mem_usage tr:nth-child(4) td:last").html('swap used: '+bytesToSize(sysinfo.swap.used*1024, 2));

	if(parseInt(sysinfo.wifi2.state) > 0)
		$j('#wifi2_b').addClass('btn-info');
	else
		$j('#wifi2_b').removeClass('btn-info');

	if(parseInt(sysinfo.wifi5.state) > 0)
		$j('#wifi5_b').addClass('btn-info');
	else
		$j('#wifi5_b').removeClass('btn-info');

	if(parseInt(sysinfo.wifi2.guest) > 0)
		$j('#wifi2_b_g').addClass('btn-info');
	else
		$j('#wifi2_b_g').removeClass('btn-info');

	if(parseInt(sysinfo.wifi5.guest) > 0)
		$j('#wifi5_b_g').addClass('btn-info');
	else
		$j('#wifi5_b_g').removeClass('btn-info');

	setLogStamp(sysinfo.logmt);

	if(force && typeof(parent.getSystemJsonData) === 'function')
		getSystemJsonData(cpu_now, sysinfo.ram);
}

var menu_code="", menu1_code="", menu2_code="", tab_code="", footer_code;
var enabled2Gclass = '<% nvram_match_x("","rt_radio_x", "1", "btn-info"); %>';
var enabled5Gclass = '<% nvram_match_x("","wl_radio_x", "1", "btn-info"); %>';
var enabledGuest2Gclass = '<% nvram_match_x("","rt_guest_enable", "1", "btn-info"); %>';
var enabledGuest5Gclass = '<% nvram_match_x("","wl_guest_enable", "1", "btn-info"); %>';
var enabledBtnCommit = '<% nvram_match_x("","nvram_manual", "0", "display:none;"); %>';

// L3 = The third Level of Menu
function tw_icon(name, size){
	// 線條圖示（設計語彙：stroke 2、圓角端點），顏色跟隨文字
	var sz = size || 18;
	var p = {
		menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
		home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
		vpn: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>',
		globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
		chart: '<path d="M3 12h4l3 7 4-14 3 7h4"/>',
		info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
		gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
		storage: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>',
		power: '<path d="M12 3v9"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
		restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
		logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
		trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
		save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7"/><path d="M8 20v-6h8v6"/>',
		wifi: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="M8 14a4 4 0 0 1 8 0"/><circle cx="12" cy="14" r="1"/><path d="M5 19h14"/>',
		devices: '<rect x="3" y="4" width="13" height="10" rx="2"/><rect x="15" y="9" width="6" height="11" rx="1"/><path d="M7 18h5"/>',
		gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
		sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><circle cx="18" cy="18" r="2"/>',
		more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
	};
	return '<svg class="tw-ico" width="'+sz+'" height="'+sz+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(p[name]||'')+'</svg>';
}

function tw_label(str){
	// 字典字串常帶冒號，頂部列只要名稱
	return str.replace(/[:：]\s*$/, '');
}

function show_banner(L3){
	var bc = '';
	var has2g = support_2g_radio(), has5g = support_5g_radio();

	// log panel
	if (!is_mobile && log_float != '0'){
		bc += '<div class="syslog_panel">\n';
		bc += '<button id="syslog_panel_button" class="handle" href="/"><span class="log_text">Log</span></button>\n';
		bc += '<table class="" style="margin-top: 0px; margin-bottom: 5px" width="100%" border="0">\n';
		bc += '  <tr>\n';
		bc += '    <td width="60%" style="text-align: left"><b><#General_x_SystemTime_itemname#>:</b><span class="alert alert-info" style="margin-left: 10px; padding-top: 4px; padding-bottom: 4px;" id="system_time_log_area"></span></td>\n';
		bc += '    <td style="text-align: lift"><input type="hidden" id="scrATop" value=""></td>\n';
		bc += '    <td style="text-align: right"><button type="button" id="clearlog_btn" class="btn btn-info" style="min-width: 170px;" onclick="clearlog();"><#CTL_clear#></button></td>\n';
		bc += '  </tr>\n';
		bc += '</table>\n';
		bc += '<span><textarea rows="28" wrap="off" class="span12" readonly="readonly" id="log_area"></textarea></span>\n';
		bc += '</div>\n';
	}

	// for chang language
	bc +='<form method="post" name="titleForm" id="titleForm" action="/start_apply.htm" target="hidden_frame">\n';
	bc +='<input type="hidden" name="current_page" value="">\n';
	bc +='<input type="hidden" name="sid_list" value="LANGUAGE;">\n';
	bc +='<input type="hidden" name="action_mode" value=" Apply ">\n';
	bc +='<input type="hidden" name="preferred_lang" value="">\n';
	bc +='<input type="hidden" name="flag" value="">\n';
	bc +='</form>\n';

	// padavan-tw 頂部列：狀態（CPU、記憶體、運作時間、負載）＋ Wi-Fi ＋ 動作
	bc += '<header class="tw-top" role="banner">\n';
	bc += '<button type="button" class="tw-icon-btn tw-menu-btn" aria-label="開啟選單" aria-controls="tw-side" aria-expanded="false" onclick="tw_nav(true);">'+tw_icon('menu')+'</button>\n';
	bc += '<span class="tw-mobile-brand">padavan-tw</span>\n';

	bc += '<div class="tw-stats" id="main_info">\n';
	bc += '<button type="button" class="tw-stat" onclick="click_info_cpu();">'+tw_label('<#SI_LoadCPU#>')+' <b id="cpu_info">-- %</b></button>\n';
	bc += '<button type="button" class="tw-stat" onclick="click_info_mem();">'+tw_label('<#SI_FreeMem#>')+' <b id="mem_info">--</b></button>\n';
	bc += '<span class="tw-stat">'+tw_label('<#SI_Uptime#>')+' <b id="uptime_info">--</b></span>\n';
	bc += '<span class="tw-stat tw-stat-la">'+tw_label('<#SI_LoadAvg#>')+' <span id="la_info">-- -- --</span></span>\n';
	bc += '</div>\n';

	// 舊程式碼會更新這兩個表格（CPU／記憶體細項），保留但不顯示
	bc += '<div id="cpu_usage" style="display: none;"><table class="table table-condensed"><tr><td></td><td></td></tr><tr><td></td><td></td></tr><tr><td></td><td></td></tr><tr><td></td><td></td></tr></table></div>\n';
	bc += '<div id="mem_usage" style="display: none;"><table class="table table-condensed"><tr><td></td><td></td></tr><tr><td></td><td></td></tr><tr><td></td><td></td></tr><tr><td></td><td></td></tr></table></div>\n';

	bc += '<div class="tw-top-actions">\n';
	if (has2g || has5g){
		bc += '<span class="tw-wifi tw-hide-sm">'+tw_icon('wifi', 16);
		if (has2g)
			bc += '<input type="button" id="wifi2_b" class="btn btn-mini '+enabled2Gclass+'" value="2.4G" title="<#menu5_1#> 2.4GHz" onclick="go_setting(2);">';
		if (has5g)
			bc += '<input type="button" id="wifi5_b" class="btn btn-mini '+enabled5Gclass+'" value="5G" title="<#menu5_1#> 5GHz" onclick="go_setting(5);">';
		bc += '</span>\n';
		bc += '<span class="tw-wifi tw-wifi-guest tw-hide-sm">'+tw_tiny_label('<#menu5_1_2#>');
		if (has2g)
			bc += '<input type="button" id="wifi2_b_g" class="btn btn-mini '+enabledGuest2Gclass+'" value="2.4G" title="<#menu5_1_2#> 2.4GHz" onclick="go_wguest(2);">';
		if (has5g)
			bc += '<input type="button" id="wifi5_b_g" class="btn btn-mini '+enabledGuest5Gclass+'" value="5G" title="<#menu5_1_2#> 5GHz" onclick="go_wguest(5);">';
		bc += '</span>\n';
		bc += '<span class="tw-top-sep tw-hide-sm"></span>\n';
	}
	bc += '<a class="tw-stat tw-firm tw-hide-sm" href="/Advanced_FirmwareUpgrade_Content.asp" title="'+tw_label('<#General_x_FirmwareVersion_itemname#>')+'"><span id="firmver" class="time"></span></a>\n';
	bc += '<button type="button" id="commit_btn" class="btn btn-mini" style="'+enabledBtnCommit+'" onclick="commit();" title="<#CTL_Commit#>">'+tw_icon('save', 16)+'<#CTL_Commit#></button>\n';
	bc += '<button type="button" id="freememory_btn" class="tw-icon-btn tw-hide-sm" title="<#BTN_FREEMEMORY#>" aria-label="<#BTN_FREEMEMORY#>" onclick="freememory();">'+tw_icon('trash')+'</button>\n';
	bc += '<button type="button" id="logout_btn" class="tw-icon-btn" title="<#t1Logout#>" aria-label="<#t1Logout#>" onclick="logout();">'+tw_icon('logout')+'</button>\n';
	bc += '<button type="button" id="reboto_btn" class="tw-icon-btn" title="<#BTN_REBOOT#>" aria-label="<#BTN_REBOOT#>" onclick="reboot();">'+tw_icon('restart')+'</button>\n';
	bc += '<button type="button" id="shutdown_btn" class="tw-icon-btn tw-danger tw-hide-sm" title="<#BTN_SHUTDOWN#>" aria-label="<#BTN_SHUTDOWN#>" onclick="shutdown();">'+tw_icon('power')+'</button>\n';
	bc += '</div>\n';
	bc += '</header>\n';

	$("TopBanner").innerHTML = bc;

	show_loading_obj();
	show_top_status();
}

function tw_tiny_label(str){
	return '<span>'+tw_label(str)+'</span>';
}

var tabtitle = new Array(20);
var tablink = new Array(20);
tabtitle[0] = new Array("", "<#menu5_1_1#>", "<#menu5_1_2#>", "<#menu5_1_3#>", "<#menu5_1_4#>", "<#menu5_1_5#>", "<#menu5_1_6#>");
tabtitle[1] = new Array("", "<#menu5_1_1#>", "<#menu5_1_2#>", "<#menu5_1_3#>", "<#menu5_1_4#>", "<#menu5_1_5#>", "<#menu5_1_6#>");
tabtitle[2] = new Array("", "<#menu5_2_1#>", "<#menu5_2_2#>", "<#menu5_2_3#>", "<#menu5_2_4#>", "<#menu5_2_5#>", "<#menu5_2_6#>");
tabtitle[3] = new Array("", "<#menu5_3_1#>", "<#menu5_3_3#>", "<#menu5_3_4#>", "<#menu5_3_5#>", "<#menu5_3_6#>");
tabtitle[4] = new Array("", "<#menu5_5_1#>", "<#menu5_5_5#>", "<#menu5_5_2#>", "<#menu5_5_3#>", "<#menu5_5_4#>");
tabtitle[5] = new Array("", "<#menu5_4_3#>", "<#menu5_4_1#>", "<#menu5_4_2#>", "<#menu5_4_4#>", "<#menu5_4_5#>");
tabtitle[6] = new Array("", "<#menu5_6_2#>", "<#menu5_6_5#>", "<#menu5_6_1#>", "<#menu5_6_3#>", "<#menu5_6_4#>", "<#menu5_6_6#>");
tabtitle[7] = new Array("", "<#menu5_10_1#>", "<#menu5_10_2#>", "<#menu5_10_3#>");
tabtitle[8] = new Array("", "<#menu5_11#>", "<#menu5_12#>", "WAN", "", "", "", "", "", "", "");
tabtitle[9] = new Array("", "<#menu5_7_2#>", "<#menu5_7_3#>", "<#menu5_7_5#>", "<#menu5_7_6#>", "<#menu5_7_8#>");
if (found_app_scutclient()){
	tabtitle[10] = new Array("", "<#menu5_1_1#>","<#menu5_13_log#>");
}
if (found_app_dnsforwarder()){
	tabtitle[11] = new Array("", "<#menu5_1_1#>");
}
if (found_app_shadowsocks()){
	tabtitle[12] = new Array("", "<#menu5_1_1#>","<#menu5_16_20#>");
}
if (found_app_mentohust()){
	tabtitle[13] = new Array("", "<#menu5_1_1#>","<#menu5_13_log#>");
}
if (found_app_adbyby()){
	tabtitle[14] = new Array("", "<#menu5_20_1#>");
}
if (found_app_kuroshio()||found_app_smartdns()||found_app_adguardhome()){
	tabtitle[15] = new Array("", "<#menu5_29#>");
}

if (found_app_aliddns()||found_app_zerotier()||found_app_ddnsto()||found_app_wireguard()){
	tabtitle[16] = new Array("", "<#menu5_30#>");
}
if (found_app_aldriver()){
	tabtitle[17] = new Array("", "<#menu5_36#>");
}
if (found_app_sqm()){
	tabtitle[18] = new Array("", "<#menu5_37#>");
}
if (found_app_frp()){
	tabtitle[19] = new Array("", "<#menu5_25#>");
}

//Level 3 Tab title

tablink[0] = new Array("", "Advanced_Wireless2g_Content.asp", "Advanced_WGuest2g_Content.asp", "Advanced_WMode2g_Content.asp", "Advanced_ACL2g_Content.asp", "Advanced_WSecurity2g_Content.asp", "Advanced_WAdvanced2g_Content.asp");
tablink[1] = new Array("", "Advanced_Wireless_Content.asp", "Advanced_WGuest_Content.asp", "Advanced_WMode_Content.asp", "Advanced_ACL_Content.asp", "Advanced_WSecurity_Content.asp", "Advanced_WAdvanced_Content.asp");
tablink[2] = new Array("", "Advanced_LAN_Content.asp", "Advanced_DHCP_Content.asp", "Advanced_GWStaticRoute_Content.asp", "Advanced_IPTV_Content.asp", "Advanced_Switch_Content.asp", "Advanced_WOL_Content.asp");
tablink[3] = new Array("", "Advanced_WAN_Content.asp", "Advanced_IPv6_Content.asp", "Advanced_VirtualServer_Content.asp", "Advanced_Exposed_Content.asp", "Advanced_DDNS_Content.asp");
/* padavan-tw：DDNS 統一由黑潮 DNS 處理，隱藏 Padavan 原本的 DDNS 分頁（最後一個） */
if (typeof found_app_kuroshio == "function" && found_app_kuroshio()){
	tabtitle[3].pop();
	tablink[3].pop();
}
tablink[4] = new Array("", "Advanced_BasicFirewall_Content.asp", "Advanced_Netfilter_Content.asp", "Advanced_URLFilter_Content.asp", "Advanced_MACFilter_Content.asp", "Advanced_Firewall_Content.asp");
tablink[5] = new Array("", "Advanced_AiDisk_others.asp", "Advanced_AiDisk_samba.asp", "Advanced_AiDisk_ftp.asp", "Advanced_Modem_others.asp", "Advanced_Printer_others.asp");
tablink[6] = new Array("", "Advanced_System_Content.asp", "Advanced_Services_Content.asp", "Advanced_OperationMode_Content.asp", "Advanced_FirmwareUpgrade_Content.asp", "Advanced_SettingBackup_Content.asp", "Advanced_Console_Content.asp");
tablink[7] = new Array("", "Advanced_Tweaks_Content.asp", "Advanced_Scripts_Content.asp", "Advanced_InetDetect_Content.asp");
tablink[8] = new Array("", "Main_WStatus2g_Content.asp", "Main_WStatus_Content.asp", "", "", "", "", "", "", "", "");
tablink[9] = new Array("", "Main_LogStatus_Content.asp", "Main_DHCPStatus_Content.asp", "Main_IPTStatus_Content.asp", "Main_RouteStatus_Content.asp", "Main_CTStatus_Content.asp");
if (found_app_scutclient()){
	scutclient_array = new Array("", "scutclient.asp", "scutclient_log.asp");
	tablink[10] = (scutclient_array);
}
if (found_app_dnsforwarder()){
	dns_forwarder_array = new Array("", "dns-forwarder.asp");
	tablink[11] = (dns_forwarder_array);
}
if (found_app_shadowsocks()){
	shadowsocks_array = new Array("","Shadowsocks.asp","Shadowsocks_log.asp");
	tablink[12] = (shadowsocks_array);
}
if (found_app_mentohust()){
	mentohust_array = new Array("","mentohust.asp","mentohust_log.asp");
	tablink[13] = (mentohust_array);
}
if (found_app_adbyby()){
	ad_array = new Array("","Advanced_adbyby.asp");
	tablink[14] = (ad_array);
}
if (found_app_kuroshio()){
	kuroshio_array = new Array("","Advanced_kuroshio.asp");
	tablink[15] = (kuroshio_array);
}else if (found_app_smartdns()){
	smartdns_array = new Array("","Advanced_smartdns.asp");
	tablink[15] = (smartdns_array);
}else if (found_app_adguardhome()){
	adg_array = new Array("","Advanced_adguardhome.asp");
	tablink[15] = (adg_array);
}
if (found_app_aliddns()){
	aliddns_array = new Array("","Advanced_aliddns.asp");
	tablink[16] = (aliddns_array);
}else if (found_app_zerotier()){
	zerotier_array = new Array("","Advanced_zerotier.asp");
	tablink[16] = (zerotier_array);
}else if (found_app_ddnsto()){
	ddnsto_array = new Array("","Advanced_ddnsto.asp");
	tablink[16] = (ddnsto_array);
}else if (found_app_wireguard()){
	wireguard_array = new Array("","Advanced_wireguard.asp");
	tablink[16] = (wireguard_array);
}
if (found_app_aldriver()){
	aldriver_arry = new Array("","Advanced_aliyundrive.asp");
	tablink[17] = (aldriver_arry);
}
if (found_app_sqm()){
	sqm_array = new Array("","Advanced_SQM.asp");
	tablink[18] = (sqm_array);
}
if (found_app_frp()){
	frp_array = new Array("","Advanced_frp.asp");
	tablink[19] = (frp_array);
	tabtitle[9].push('<#menu5_25_1#>');
	tablink[9].push('Advanced_frp_log.asp');
}

//Level 2 Menu
menuL2_title = new Array(20)
menuL2_title = new Array("", "<#menu5_11#>", "<#menu5_12#>", "<#menu5_2#>", "<#menu5_3#>", "<#menu5_5#>", "<#menu5_4#>", "<#menu5_6#>", "<#menu5_10#>", "<#menu5_9#>", "<#menu5_7#>");
if (found_app_scutclient()){
	menuL2_title.push("<#menu5_13#>");
} else menuL2_title.push("");

if (found_app_dnsforwarder()){
	menuL2_title.push("<#menu5_15#>");
} else menuL2_title.push("");

if (found_app_shadowsocks()){
	menuL2_title.push("<#menu5_16#>");
} else menuL2_title.push("");

if (found_app_mentohust()){
	menuL2_title.push("mentohust");
} else menuL2_title.push("");

if (found_app_adbyby()){
	menuL2_title.push("<#menu5_20#>");
} else menuL2_title.push("");

if (found_app_kuroshio()||found_app_smartdns()||found_app_adguardhome()){
	menuL2_title.push("<#menu5_29#>");
} else menuL2_title.push("");

if (found_app_aliddns()||found_app_zerotier()||found_app_ddnsto()||found_app_wireguard()){
	menuL2_title.push("<#menu5_30#>");
} else menuL2_title.push("");

if (found_app_aldriver()){
	menuL2_title.push("<#menu5_36#>");
} else menuL2_title.push("");

if (found_app_sqm()){
	menuL2_title.push("<#menu5_37#>");
} else menuL2_title.push("");

if (found_app_frp()){
	menuL2_title.push("<#menu5_25#>");
} else menuL2_title.push("");

menuL2_link  = new Array("", tablink[0][1], tablink[1][1], tablink[2][1], tablink[3][1], tablink[4][1], tablink[5][1], tablink[6][1], tablink[7][1], support_2g_radio() ? tablink[8][1] : "Main_EStatus_Content.asp", tablink[9][1]);
if (found_app_scutclient()){
	menuL2_link.push(scutclient_array[1]);
} else menuL2_link.push("");

if (found_app_dnsforwarder()){
	menuL2_link.push(dns_forwarder_array[1]);
} else menuL2_link.push("");

if (found_app_shadowsocks()){
	menuL2_link.push(shadowsocks_array[1]);
} else menuL2_link.push("");

if (found_app_mentohust()){
	menuL2_link.push(mentohust_array[1]);
} else menuL2_link.push("");

if (found_app_adbyby()){
	menuL2_link.push(ad_array[1]);
}  else menuL2_link.push("");

if (found_app_kuroshio()){
	menuL2_link.push(kuroshio_array[1]);
} else if (found_app_smartdns()){
	menuL2_link.push(smartdns_array[1]);
} else if (found_app_adguardhome()){
	menuL2_link.push(adg_array[1]);
} else menuL2_link.push("");

if (found_app_aliddns()){
	menuL2_link.push(aliddns_array[1]);
} else if (found_app_zerotier()){
	menuL2_link.push(zerotier_array[1]);
} else if (found_app_ddnsto()){
	menuL2_link.push(ddnsto_array[1]);
} else if (found_app_wireguard()){
	menuL2_link.push(wireguard_array[1]);
} else menuL2_link.push("");

if (found_app_aldriver()){
	menuL2_link.push(aldriver_arry[1]);
} else menuL2_link.push("");

if (found_app_sqm()){
	menuL2_link.push(sqm_array[1]);
} else menuL2_link.push("");

if (found_app_frp()){
	menuL2_link.push(frp_array[1]);
} else menuL2_link.push("");

//Level 1 Menu in Gateway, Router mode
menuL1_title = new Array("", "<#menu1#>", "", "<#menu2#>", "<#menu6#>", "<#menu4#>", "<#menu5_8#>", "<#menu5#>");
menuL1_link = new Array("", "index.asp", "", "vpnsrv.asp", "vpncli.asp", "Main_TrafficMonitor_realtime.asp", "Advanced_System_Info.asp", "as.asp");
menuL1_icon = new Array("", "icon-home", "icon-hdd", "icon-retweet", "icon-globe", "icon-tasks", "icon-random", "icon-wrench");

if (!found_app_vpnsvr()) {
	menuL1_title[3] = '';
	menuL1_link[3] = '';
	menuL1_icon[3] = '';
}
if (!found_app_vpncli()) {
	menuL1_title[4] = '';
	menuL1_link[4] = '';
	menuL1_icon[4] = '';
}

function show_menu(L1, L2, L3){
	var i;
	var num_ephy = support_num_ephy();
	if (num_ephy < 2)
		num_ephy = 2;
	if (num_ephy > 8)
		num_ephy = 8;
	if(sw_mode == '3'){
		tabtitle[2].splice(3,1);//LAN
		tablink[2].splice(3,1);
		tabtitle[3].splice(1,5);//WAN
		tablink[3].splice(1,5);
		tabtitle[4].splice(1,5);//firewall
		tablink[4].splice(1,5);
		tabtitle[5].splice(4,1);//USB
		tablink[5].splice(4,1);
		tabtitle[9].splice(2,4);//log
		tablink[9].splice(2,4);
		tablink[2][1] = "Advanced_APLAN_Content.asp";
		menuL2_link[3] = tablink[2][1];
		menuL2_link[4] = "";  //remove WAN
		menuL2_title[4] = "";
		menuL2_link[5] = "";  //remove Firewall
		menuL2_title[5] = "";
		
		if (lan_proto == '1'){
			tabtitle[2].splice(2,1);
			tablink[2].splice(2,1);
		}
	}else{
		if(sw_mode == '4'){
			tablink[3].splice(3,2);
			tabtitle[3].splice(3,2);
		}
		if(!support_ipv6()){
			tablink[3].splice(2,1);
			tabtitle[3].splice(2,1);
		}
	}

	for (i=0;i<num_ephy;i++){
		tablink[8][i+3] = "Main_EStatus_Content.asp#"+i.toString();
		if (i>0)
			tabtitle[8][i+3] = "LAN"+i.toString();
	}

	if(num_ephy<8){
		tabtitle[8].splice(3+num_ephy,8-num_ephy);
		tablink[8].splice(3+num_ephy,8-num_ephy);
	}

	if(!support_2g_radio()){
		menuL2_link[1] = "";  //remove 2G
		menuL2_title[1] = "";
		tabtitle[0].splice(1,6);
		tablink[0].splice(1,6);
		tabtitle[8].splice(1,1);
		tablink[8].splice(1,1);
	}

	if(!support_5g_radio()){
		menuL2_link[2] = "";  //remove 5GHz
		menuL2_title[2] = "";
		tabtitle[1].splice(1,6);
		tablink[1].splice(1,6);
		var idx = support_2g_radio() ? 2 : 1;
		tabtitle[8].splice(idx,1);
		tablink[8].splice(idx,1);
	}

	if(!support_storage()){
		tabtitle[5].splice(1,5);
		tablink[5].splice(1,5);
		menuL2_link[6] = "";  //remove USB
		menuL2_title[6] = "";
	}else{
		if(!support_usb()){
			tabtitle[5].splice(4,2);
			tablink[5].splice(4,2);
		}
		if(!found_app_smbd() && !found_app_ftpd()){
			tabtitle[5].splice(2,2);
			tablink[5].splice(2,2);
		}
		else if(!found_app_smbd()){
			tabtitle[5].splice(2,1);
			tablink[5].splice(2,1);
		}
		else if(!found_app_ftpd()){
			tabtitle[5].splice(3,1);
			tablink[5].splice(3,1);
		}
	}

	/* padavan-tw：主選單改成依使用者目的分類（docs/HANDOFF-UI.md 5.4）；
	 * 上游頁面全部收在「進階設定」，原本的第一層（網路地圖除外）與第二層選單列在它底下 */
	$("mainMenu").innerHTML = tw_nav_code(L1 == 1 ? 'home' : 'adv');
	tw_side_brand();

	for(i = 1; i <= menuL1_title.length-1; i++){
		if(menuL1_title[i] == "" || i == 1)
			continue;
		if(L1 == i && L2 <= 0)
			menu2_code += '<a href="javascript: void(0)" style="font-weight: bold" aria-current="page">'+menuL1_title[i]+'</a>\n';
		else
			menu2_code += '<a href="'+menuL1_link[i]+'">'+menuL1_title[i]+'</a>\n';
	}
	for(var i = 1; i <= menuL2_title.length-1; ++i){
		if(menuL2_title[i] == "")
			continue;
		else if(L2 == i)
			menu2_code += '<a href="javascript: void(0)" style="font-weight: bold" aria-current="page">'+menuL2_title[i]+'</a>\n';
		else
			menu2_code += '<a href="'+menuL2_link[i]+'">'+menuL2_title[i]+'</a>\n';
	}
	if (L1 == 1)
		menu2_code = '';
	$("subMenu").innerHTML = menu2_code;
	$("subMenu").setAttribute('data-title', '進階設定（原始頁面）');

	if(L3){
		tab_code = '<ul class="nav nav-tabs" style="margin-bottom: 0px;">\n';
		for(var i = 1; i < tabtitle[L2-1].length; ++i){
			if(tabtitle[L2-1][i] == "")
				continue;
			if(L3 == i){
				tab_ref = "javascript: void(0)";
				if (L2==9 && i>0 && tablink[L2-1][i].indexOf("#")>0)
					tab_ref = tablink[L2-1][i];
				tab_code += '<li class="active"><a href="' +tab_ref+ '">'+tabtitle[L2-1][i]+'</a></li>\n';
			}else
				tab_code += '<li><a href="' +tablink[L2-1][i]+ '">'+tabtitle[L2-1][i]+'</a></li>\n';
		}
		tab_code += '</ul>\n';
		$("tabMenu").innerHTML = tab_code;
	}
	else
		$("tabMenu").innerHTML = "";
}

function tw_menu_icon(cls){
	var map = {'icon-home':'home', 'icon-hdd':'storage', 'icon-retweet':'vpn', 'icon-globe':'globe', 'icon-tasks':'chart', 'icon-random':'info', 'icon-wrench':'gear'};
	return tw_icon(map[cls] || 'info', 18);
}

/* padavan-tw：新的主選單（9 項）。新頁面呼叫 tw_show_menu(id)，上游頁面由 show_menu() 標成「進階設定」 */
var tw_nav_items = [
	['home', 'index.asp', '總覽', 'home'],
	['devices', 'tw_devices.asp', '裝置', 'devices'],
	['wifi', 'tw_wifi.asp', 'Wi-Fi', 'wifi'],
	['internet', 'tw_internet.asp', '網際網路', 'globe'],
	['remote', 'tw_remote.asp', '遠端與分享', 'vpn'],
	['qos', 'tw_qos.asp', '頻寬管理', 'gauge'],
	['diag', 'tw_diag.asp', '診斷', 'search'],
	['system', 'tw_system.asp', '系統', 'gear'],
	['adv', 'tw_advanced.asp', '進階設定', 'sliders']
];

function tw_nav_code(active){
	var h = '';
	for (var i = 0; i < tw_nav_items.length; i++) {
		var it = tw_nav_items[i];
		if (it[0] == active)
			h += '<li class="active" id="tw_nav_'+it[0]+'"><a href="/'+it[1]+'" aria-current="page">'+tw_icon(it[3], 18)+it[2]+'</a></li>\n';
		else
			h += '<li id="tw_nav_'+it[0]+'"><a href="/'+it[1]+'">'+tw_icon(it[3], 18)+it[2]+'</a></li>\n';
	}
	return h;
}

function tw_show_menu(active){
	$("mainMenu").innerHTML = tw_nav_code(active);
	tw_side_brand();
	$("subMenu").innerHTML = '';
	$("tabMenu") && ($("tabMenu").innerHTML = '');
}

function tw_side_brand(){
	var nav = document.querySelector('.side_nav');
	if (!nav || document.getElementById('tw-brand'))
		return;
	var b = document.createElement('div');
	b.id = 'tw-brand';
	b.className = 'tw-brand';
	b.innerHTML = '<span class="tw-brand-mark">'+tw_icon('wifi', 18)+'</span><span>padavan-tw<small><% nvram_get_x("", "productid"); %></small></span>';
	nav.insertBefore(b, nav.firstChild);
}

function show_footer(){
	footer_code = '<div align="center" class="bottom-image"></div>\n';
	footer_code +='<div align="center" class="copyright"><#footer_copyright_desc#></div>\n';
	footer_code +='<div align="center">\n';
	footer_code +='  <span>Developed by © <a href="https://bitbucket.org/padavan/rt-n56u/">Andy Padavan</a> &amp; <a href="https://github.com/hanwckf/padavan-4.4">hanwckf</a> &amp; <a href="https://github.com/MeIsReallyBa/padavan-4.4">MeIsReallyBa</a> &amp; <a href="https://github.com/tsl0922/padavan">tsl0922</a> &amp; <a href="https://github.com/TurBoTse/padavan">TurBoTse</a></span></br>\n';
	footer_code +='  <span>Firmware distribution is prohibited , Non-Commercial Use Only</span></br>\n';
	footer_code +='</div>\n';

	$("footer").innerHTML = footer_code;

	flash_button();
}

function show_top_status(){
	var $j = jQuery.noConflict();

	// padavan-tw：CPU／記憶體改成直接連到系統資訊頁（見 click_info_cpu），不再切換頂部列內容

	id_system_info = setTimeout('get_system_info()', 2000);
	showSystemInfo({busy: 0, user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, sirq: 0}, 0);

	showtext($("firmver"), '<% nvram_get_x("",  "firmver_sub"); %>');

	/*if(sw_mode == "3")
		$("sw_mode_span").innerHTML = "AP";
	else
		$("sw_mode_span").innerHTML = "Router";*/
}

/* padavan-tw：頂部列的 Wi-Fi／訪客按鈕改到新的 Wi-Fi 頁（原始頁面在「進階設定」） */
function go_setting(band){
	location.href = "tw_wifi.asp";
}

function go_wguest(band){
	location.href = "tw_wifi.asp#guest";
}

function show_time(){
	JS_timeObj.setTime(systime_millsec); // Add millsec to it.
	JS_timeObj3 = JS_timeObj.toString();
	JS_timeObj3 = checkTime(JS_timeObj.getHours()) + ":" +
			checkTime(JS_timeObj.getMinutes()) + ":" +
			checkTime(JS_timeObj.getSeconds());
	$('systemtime').innerHTML ="<a href='/Advanced_System_Content.asp'>" + JS_timeObj3 + "</a>";
	systime_millsec += 1000;
	stime_ID = setTimeout("show_time();", 1000);
}

function checkTime(i){
	if (i<10)
		{i="0" + i}
	return i;
}

function show_loading_obj(){
	var code = '';

	code += '<center><div id="loadingBlock" class="loadingBlock">';
	code += '<div class="container-fluid">';
	code += '<div class="well" style="background-color: #212121; width: 60%;">';
	code += '<div class="progress progress-striped active" style="width: 50%; text-align: left;"><div class="bar" id="proceeding_bar" style="width: 0%;"><span id="proceeding_txt"></span></div></div>';
	code += '<span id="proceeding_main_txt"><#Main_alert_proceeding_desc4#></span></span>';
	code += '</div>';
	code += '</div>';
	code += '</div></center>';

	$("Loading").innerHTML = code;
	id_check_status = setTimeout('hideLoading();', 3000);
}

function submit_language(){
	if($("select_lang").value != $("preferred_lang").value){
		showLoading();
		with(document.titleForm){
			action = "/start_apply.htm";
			if(location.pathname == "/")
				current_page.value = "/index.asp";
			else
				current_page.value = location.pathname;
			preferred_lang.value = $("select_lang").value;
			flag.value = "set_language";
			submit();
		}
	}
}

function logout(){
	if(!confirm('<#JS_logout#>'))
		return;
	setTimeout('location = "Logout.asp";', 1);
}

function reboot(){
	if(!confirm('<#JS_reboot#>'))
		return;
	showLoading(board_boot_time());
	var $j = jQuery.noConflict();
	$j.post('/apply.cgi',
	{
		'action_mode': ' Reboot ',
	});
}

function shutdown(){
	if(!confirm('<#JS_shutdown#>'))
		return;
	var $j = jQuery.noConflict();
	$j.post('/apply.cgi',
	{
		'action_mode': ' Shutdown ',
		'current_page': 'Main_LogStatus_Content.asp'
	});
}

function freememory(){
	var $j = jQuery.noConflict();
	$j.post('/apply.cgi',
	{
		'action_mode': ' FreeMemory ',
	});
}

function click_info_cpu(){
	location.href="/Advanced_System_Info.asp#CPU";
}

function click_info_mem(){
	location.href="/Advanced_System_Info.asp#MEM";
}

function hide_adv_info(){
	var $j = jQuery.noConflict();
	$j("#cpu_usage").hide();
	$j("#mem_usage").hide();
	$j("#main_info").show();
}

function reset_btn_commit(btn_id){
	var $j = jQuery.noConflict();
	var $btn=$j('#'+btn_id);
	$btn.removeClass('alert-error').removeClass('alert-success');
}

function commit(){
	if(!confirm('<#Commit_confirm#>'))
		return;
	var $j = jQuery.noConflict();
	var $btn = $j('#commit_btn');
	$j.ajax({
		type: "post",
		url: "/apply.cgi",
		data: {
			action_mode: " CommitFlash ",
			nvram_action: "commit_nvram"
		},
		dataType: "json",
		error: function(xhr) {
			$btn.addClass('alert-error');
			setTimeout("reset_btn_commit('#commit_btn')", 1500);
		},
		success: function(response) {
			var sys_result = (response != null && typeof response === 'object' && "sys_result" in response)
				? response.sys_result : -1;
			if(sys_result == 0)
				$btn.addClass('alert-success');
			else
				$btn.addClass('alert-error');
			setTimeout("reset_btn_commit('commit_btn')", 1500);
		}
	});
}

function clearlog(){
	var $j = jQuery.noConflict();
	$j.post('/apply.cgi',
	{
		'action_mode': ' ClearLog ',
		'current_page': 'Main_LogStatus_Content.asp'
	});
	setLogData();
}

function kb_to_gb(kilobytes){
	if(typeof(kilobytes) == "string" && kilobytes.length == 0)
		return 0;
	return (kilobytes*1024)/(1024*1024*1024);
}

function simpleNum(num){
	if(typeof(num) == "string" && num.length == 0)
		return 0;
	return parseInt(kb_to_gb(num)*1000)/1000;
}

function simpleNum2(num){
	if(typeof(num) == "string" && num.length == 0)
		return 0;
	return parseInt(num*1000)/1000;
}

function simpleNum3(num){
	if(typeof(num) == "string" && num.length == 0)
		return 0;
	return parseInt(num)/1024;
}

function $(){
	var elements = new Array();

	for(var i = 0; i < arguments.length; ++i){
		var element = arguments[i];
	if(typeof element == 'string')
		element = document.getElementById(element);
		
		if(arguments.length == 1)
			return element;
		
		elements.push(element);
	}

	return elements;
}

function E(e) {
	return (typeof(e) === 'string') ? document.getElementById(e) : e;
}

function getElementsByName_iefix(tag, name){
	var tagObjs = document.getElementsByTagName(tag);
	var objsName;
	var targetObjs = new Array();
	var targetObjs_length;

	if(!(typeof(name) == "string" && name.length > 0))
		return [];

	for(var i = 0, targetObjs_length = 0; i < tagObjs.length; ++i){
		objsName = tagObjs[i].getAttribute("name");
		
		if(objsName && objsName.indexOf(name) == 0){
			targetObjs[targetObjs_length] = tagObjs[i];
			++targetObjs_length;
		}
	}

	return targetObjs;
}

function getElementsByClassName_iefix(tag, name){
	var tagObjs = document.getElementsByTagName(tag);
	var objsName;
	var targetObjs = new Array();
	var targetObjs_length;

	if(!(typeof(name) == "string" && name.length > 0))
		return [];

	for(var i = 0, targetObjs_length = 0; i < tagObjs.length; ++i){
		if(navigator.appName == 'Netscape')
			objsName = tagObjs[i].getAttribute("class");
		else
			objsName = tagObjs[i].getAttribute("className");
		
		if(objsName == name){
			targetObjs[targetObjs_length] = tagObjs[i];
			++targetObjs_length;
		}
	}

	return targetObjs;
}

function showtext(obj, str){
	if(obj)
		obj.innerHTML = str;//*/
}

function showhtmlspace(ori_str){
	var str = "", head, tail_num;

	head = ori_str;
	while((tail_num = head.indexOf(" ")) >= 0){
		str += head.substring(0, tail_num);
		str += "&nbsp;";
		
		head = head.substr(tail_num+1, head.length-(tail_num+1));
	}
	str += head;

	return str;
}

function showhtmland(ori_str){
	var str = "", head, tail_num;

	head = ori_str;
	while((tail_num = head.indexOf("&")) >= 0){
		str += head.substring(0, tail_num);
		str += "&amp;";
		
		head = head.substr(tail_num+1, head.length-(tail_num+1));
	}
	str += head;

	return str;
}

// A dummy function which just returns its argument. This was needed for localization purpose
function translate(str){
	return str;
}

function trim(str){
	return str.replace(/^\s+|\s+$/g, '');
}

function validate_string(string_obj, flag){
	if(string_obj.value.charAt(0) == '"'){
		if(flag != "noalert")
			alert('<#JS_validstr1#> ["]');

		string_obj.value = "";
		string_obj.focus();

		return false;
	}
	else{
		invalid_char = "";
		
		for(var i = 0; i < string_obj.value.length; ++i){
			if(string_obj.value.charAt(i) < ' ' || string_obj.value.charAt(i) > '~'){
				invalid_char = invalid_char+string_obj.value.charAt(i);
			}
		}
		
		if(invalid_char != ""){
			if(flag != "noalert")
				alert("<#JS_validstr2#> '"+invalid_char+"' !");
			string_obj.value = "";
			string_obj.focus();
			
			return false;
		}
	}
	
	return true;
}

function validate_hex(obj){
	var obj_value = obj.value
	var re = new RegExp("[^a-fA-F0-9]+","gi");
	if(re.test(obj_value))
		return false;
	else
		return true;
}

function validate_psk(psk_obj){
	var psk_length = psk_obj.value.length;
	if(psk_length < 8){
		alert("<#JS_passzero#>");
		psk_obj.value = "00000000";
		psk_obj.focus();
		psk_obj.select();

		return false;
	}
	if(psk_length > 64){
		alert("<#JS_PSK64Hex#>");
		psk_obj.value = psk_obj.value.substring(0, 64);
		psk_obj.focus();
		psk_obj.select();

		return false;
	}
	if(psk_length >= 8 && psk_length <= 63 && !validate_string(psk_obj)){
		alert("<#JS_PSK64Hex#>");
		psk_obj.value = "00000000";
		psk_obj.focus();
		psk_obj.select();
		
		return false;
	}
	if(psk_length == 64 && !validate_hex(psk_obj)){
		alert("<#JS_PSK64Hex#>");
		psk_obj.value = "00000000";
		psk_obj.focus();
		psk_obj.select();
		
		return false;
	}
	return true;
}

function checkDuplicateName(newname, targetArray){
	var existing_string = targetArray.join(',');
	existing_string = ","+existing_string+",";
	var newstr = ","+trim(newname)+",";
	var re = new RegExp(newstr, "gi");
	var matchArray = existing_string.match(re);

	if(matchArray != null)
		return true;
	else
		return false;
}

function alert_error_msg(error_msg){
	alert(error_msg);
	refreshpage();
}

function refreshpage(seconds){
	if(typeof(seconds) == "number")
		setTimeout("refreshpage()", seconds*1000);
	else
		location.href = location.href;
}

function hideLinkTag(){
	if(document.all){
		var tagObjs = document.all.tags("a");
		
		for(var i = 0; i < tagObjs.length; ++i)
			tagObjs(i).outerHTML = tagObjs(i).outerHTML.replace(">"," hidefocus=true>");
	}
}

function buttonOver(o){	//Lockchou 1206 modified
	o.style.color = "#FFFFFF";
	o.style.background = "url(/images/bgaibutton.gif) #ACCCE1";
	o.style.cursor = "hand";
}

function buttonOut(o){	//Lockchou 1206 modified
	o.style.color = "#000000";
	o.style.background = "url(/images/bgaibutton0.gif) #ACCCE1";
}

function flash_button(){
	if(navigator.appName.indexOf("Microsoft") < 0)
		return;
	
	var btnObj = getElementsByClassName_iefix("input", "button");
	
	for(var i = 0; i < btnObj.length; ++i){
		btnObj[i].onmouseover = function(){
				buttonOver(this);
			};
		
		btnObj[i].onmouseout = function(){
				buttonOut(this);
			};
	}
}

function no_flash_button(){
	if(navigator.appName.indexOf("Microsoft") < 0)
		return;

	var btnObj = getElementsByClassName_iefix("input", "button");

	for(var i = 0; i < btnObj.length; ++i){
		btnObj[i].onmouseover = "";
		
		btnObj[i].onmouseout = "";
	}
}

function gotoprev(formObj){
	var prev_page = formObj.prev_page.value;

	if(prev_page == "/")
		prev_page = "/index.asp";

	formObj.action = prev_page;
	formObj.target = "_parent";
	formObj.submit();
}

function add_option(selectObj, str, value, selected){
	var tail = selectObj.options.length;

	if(typeof(str) != "undefined")
		selectObj.options[tail] = new Option(str);
	else
		selectObj.options[tail] = new Option();

	if(typeof(value) != "undefined")
		selectObj.options[tail].value = value;
	else
		selectObj.options[tail].value = "";

	if(selected == 1)
		selectObj.options[tail].selected = selected;
}

function free_options(selectObj){
	if(selectObj == null)
		return;

	for(var i = selectObj.options.length-1; i >= 0; --i){
		selectObj.options[i].value = null;
		selectObj.options[i] = null;
	}
}

function blocking(obj_id, show){
	var state = show?'block':'none';

	if(document.getElementById)
		$(obj_id).style.display = state;
	else if(document.layers)
		document.layers[obj_id].display = state;
	else if(document.all)
		document.all[obj_id].style.display = state;
}

function inputCtrl(obj, flag){
	obj.disabled = (flag == 0);
}

// add eagle23
jQuery(document).ready(function(){
    var $j = jQuery.noConflict();

    $j("#logo").click(function(){
        location.href = '/';
    });

    // tabindex navigation
    $j(function(){
        var tabindex = 1;
        $j('input,select').each(function() {
            if (this.type != "hidden"  && this.type != 'radio') {
                var $input = $j(this);
                $input.attr("tabindex", tabindex);
                tabindex++;
            }
        });
    });

    var idFindSyslogPanel = setInterval(function(){
        if(is_mobile || log_float == '0'){
            clearInterval(idFindSyslogPanel);
        }else if($j('.syslog_panel').size() > 0){
            clearInterval(idFindSyslogPanel);

            var offsetLeft = $j('.wrapper').offset().left;
            $j('.syslog_panel').css({opacity: 1});
            $j('.syslog_panel').tabSlideOut({
                tabHandle: '.handle',
                imageHeight: '20px',
                imageWidth: '62px',
                tabLocation: 'top',
                speed: 300,
                action: 'click',
                topPos: '400px',
                leftPos: (offsetLeft+5)+'px',
                fixedPosition: true
            });

            setLogData();
            showClockLogArea();
        }
    }, 100);
});

// fix for ie
String.prototype.nl2br = function(){
    return this.replace(/\n/g, "\n\r");
}

function setLogStamp(mt){
    if(is_mobile || log_float == '0')
        return;

    var $j = jQuery.noConflict();

    if(isLocalStorageAvailable())
        log_stamp = localStorage.getItem('syslog_stamp');
    if(log_stamp == null)
        log_stamp = 0;

    if (log_stamp != mt){
        setToLocalStorage('syslog_stamp', mt);
        if (log_stamp != 0){
            setLogData();
            if(!$j('.syslog_panel').hasClass('open')){
                var tabText = 'Log <span class="label label-important">!</span>';
                $j(".log_text").html(tabText);
            }
        }
        log_stamp = mt;
    }
}

function setLogData(){
    var $j = jQuery.noConflict();
    $j.get('/log_content.asp', function(data){
        // fix for ie
        if($j.browser.msie && !is_ie11p)
            data = data.nl2br();
        if($j("#log_area").val() == ''){
            $j("#log_area").text(data);
            $j("#log_area").prop('scrollTop', $j("#log_area").prop('scrollHeight'));
            $j("#scrATop").val($j("#log_area").prop('scrollTop'));
        }else{
            var scrMaxTop = $j("#log_area").prop('scrollHeight')
            var scrTop = $j("#log_area").prop('scrollTop');
            $j("#log_area").text(data);
            var scrITop = scrMaxTop - scrTop;
            if($j("#scrATop").val() == scrTop || scrITop < 629){
                $j("#log_area").prop('scrollTop', scrMaxTop);
                $j("#scrATop").val($j("#log_area").prop('scrollTop'));
            }else{
                $j("#log_area").prop('scrollTop', scrTop);
            }
        }
    });
}

function showClockLogArea(){
    if(jQuery('#system_time').size() == 0){
        JS_timeObj.setTime(systime_millsec);
        systime_millsec += 1000;

        JS_timeObj2 = JS_timeObj.toString();
        JS_timeObj2 = JS_timeObj2.substring(0,3) + ", " +
        JS_timeObj2.substring(4,10) + "  " +
        checkTime(JS_timeObj.getHours()) + ":" +
        checkTime(JS_timeObj.getMinutes()) + ":" +
        checkTime(JS_timeObj.getSeconds()) + "  " +
        JS_timeObj.getFullYear() + " GMT" + timezone;
    }
    jQuery("#system_time_log_area").html(JS_timeObj2);
    setTimeout("showClockLogArea()", 1000);
}

function onCompleteSlideOutLogArea(){
    var idTimeout = setTimeout(function(){
        clearTimeout(idTimeout);
        jQuery(".log_text").html('Log');
    }, 1500);
}

function passwordShowHide(id){
    var obj = $j('#'+id);
    var changeTo = (obj.attr('type') == 'password') ? 'text' : 'password';
    if ($j.browser.msie && parseInt($j.browser.version, 10) < 9){
        var marker = $j('<span />').insertBefore('#'+id);
        obj.detach().attr('type', changeTo).insertAfter(marker);
        marker.remove();
    }else{
        document.getElementById(id).type = changeTo;
    }
}

/**
 * Local Storage HTML5 Standart
 * http://www.w3.org/TR/webstorage/
 */
/**
 * ckeck if localStorage available
 * @return void
 */
function isLocalStorageAvailable(){
    try {
        return 'localStorage' in window && window['localStorage'] !== null;
    } catch (e) {
        return false;
    }
}

/**
 * set value to localStorage
 * @param name string
 * @param value mixed
 */
function setToLocalStorage(name, value){
    if(isLocalStorageAvailable()){
        try {
            localStorage.setItem(name, value);
        } catch (e) {
            if (e == QUOTA_EXCEEDED_ERR) {
            }
        }
    }
}

/**
 * get from localStorage
 * @param name
 * @return mixed
 */
function getFromLocalStorage(name){
    if(isLocalStorageAvailable()){
        return localStorage.getItem(name);
    }
}

/**
 * remove from localStorage
 * @param name
 * @return void
 */
function removeFromLocalStorage(name){
    if(isLocalStorageAvailable()){
        localStorage.removeItem(name);
    }
}

(function($){
    var $j = $.noConflict();
    $j.fn.tabSlideOut = function(callerSettings){
        var settings =  $j.extend({
            tabHandle: '.handle',
            speed: 300,
            action: 'click',
            tabLocation: 'left',
            topPos: '200px',
            leftPos: '20px',
            fixedPosition: false,
            positioning: 'absolute',
            pathToTabImage: null,
            imageHeight: null,
            imageWidth: null
        }, callerSettings||{});

        settings.tabHandle =  $j(settings.tabHandle);
        var obj = this;
        if (settings.fixedPosition === true) {
            settings.positioning = 'fixed';
        } else {
            settings.positioning = 'absolute';
        }

        //ie6 doesn't do well with the fixed option
        if (document.all && !window.opera && !window.XMLHttpRequest) {
            settings.positioning = 'absolute';
        }

        //set initial tabHandle css
        settings.tabHandle.css({
            'display': 'block',
            'width' : settings.imageWidth,
            'height': settings.imageHeight,
            //'textIndent' : '-99999px',
            //'background' : 'url('+settings.pathToTabImage+') no-repeat',
            'outline' : 'none',
            'position' : 'absolute',
            'border-radius': '0px 0px 4px 4px',
            'background-color': '#f5f5f5',
            'border-left': '1px solid #ddd',
            'border-right': '1px solid #ddd',
            'border-bottom': '1px solid #ddd'
        });

        obj.css({
            'line-height' : '1',
            'position' : settings.positioning
        });

        var properties = {
            containerWidth: parseInt(obj.outerWidth(), 10) + 'px',
            containerHeight: parseInt(obj.outerHeight(), 10) + 'px',
            tabWidth: parseInt(settings.tabHandle.outerWidth(), 10) + 'px',
            tabHeight: parseInt(settings.tabHandle.outerHeight(), 10) + 'px'
        };

        //set calculated css
        if(settings.tabLocation === 'top' || settings.tabLocation === 'bottom') {
            obj.css({'left' : settings.leftPos});
            settings.tabHandle.css({'right' : -1});
        }

        if(settings.tabLocation === 'top') {
            obj.css({'top' : '-' + properties.containerHeight});
            settings.tabHandle.css({'bottom' : '-' + properties.tabHeight});
        }

        if(settings.tabLocation === 'bottom') {
            obj.css({'bottom' : '-' + properties.containerHeight, 'position' : 'fixed'});
            settings.tabHandle.css({'top' : '-' + properties.tabHeight});

        }

        if(settings.tabLocation === 'left' || settings.tabLocation === 'right') {
            obj.css({
                'height' : properties.containerHeight,
                'top' : settings.topPos
            });

            settings.tabHandle.css({'top' : 0});
        }

        if(settings.tabLocation === 'left') {
            obj.css({ 'left': '-' + properties.containerWidth});
            settings.tabHandle.css({'right' : '-' + properties.tabWidth});
        }

        if(settings.tabLocation === 'right') {
            obj.css({ 'right': '-' + properties.containerWidth});
            settings.tabHandle.css({'left' : '-' + properties.tabWidth});

            $j('html').css('overflow-x', 'hidden');
        }

        //functions for animation events

        settings.tabHandle.click(function(event){
            event.preventDefault();
        });

        var slideIn = function() {

            if (settings.tabLocation === 'top') {
                obj.animate({top:'-' + properties.containerHeight}, settings.speed).removeClass('open');
            } else if (settings.tabLocation === 'left') {
                obj.animate({left: '-' + properties.containerWidth}, settings.speed).removeClass('open');
            } else if (settings.tabLocation === 'right') {
                obj.animate({right: '-' + properties.containerWidth}, settings.speed).removeClass('open');
            } else if (settings.tabLocation === 'bottom') {
                obj.animate({bottom: '-' + properties.containerHeight}, settings.speed).removeClass('open');
            }

        };

        var slideOut = function() {

            if (settings.tabLocation == 'top') {
                obj.animate({top:'-3px'},  settings.speed, onCompleteSlideOutLogArea()).addClass('open');
            } else if (settings.tabLocation == 'left') {
                obj.animate({left:'-3px'},  settings.speed, onCompleteSlideOutLogArea()).addClass('open');
            } else if (settings.tabLocation == 'right') {
                obj.animate({right:'-3px'},  settings.speed, onCompleteSlideOutLogArea()).addClass('open');
            } else if (settings.tabLocation == 'bottom') {
                obj.animate({bottom:'-3px'},  settings.speed, onCompleteSlideOutLogArea()).addClass('open');
            }
        };

        var clickScreenToClose = function() {
            obj.click(function(event){
                event.stopPropagation();
            });

            $j(document).click(function(){
                slideIn();
            });
        };

        var clickAction = function(){
            settings.tabHandle.click(function(event){
                if (obj.hasClass('open')) {
                    slideIn();
                } else {
                    slideOut();
                }
            });

            clickScreenToClose();
        };

        var hoverAction = function(){
            obj.hover(
                function(){
                    slideOut();
                },

                function(){
                    slideIn();
                });

            settings.tabHandle.click(function(event){
                if (obj.hasClass('open')) {
                    slideIn();
                }
            });
            clickScreenToClose();

        };

        //choose which type of action to bind
        if (settings.action === 'click') {
            clickAction();
        }

        if (settings.action === 'hover') {
            hoverAction();
        }
    };
})(jQuery);

/* ======================================================================
 * padavan-tw 介面框架
 * - 標記側欄／內容欄 class（tw.css 用）
 * - 手機：選單抽屜、底部分頁列
 * - 手機：有表頭的資料表加上欄位名稱，改成卡片
 * ====================================================================== */
function tw_nav(open){
	var b = document.body;
	if (!b) return;
	if (open) b.classList.add('tw-nav-open'); else b.classList.remove('tw-nav-open');
	var btn = document.querySelector('.tw-menu-btn');
	if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
	if (open) {
		var first = document.querySelector('.tw-side a');
		if (first) first.focus();
	}
}

function tw_tag_layout(){
	var nav = document.querySelector('.side_nav');
	if (!nav) return false;
	var side = nav.parentNode;
	while (side && !(side.className && /\bspan3\b/.test(side.className)))
		side = side.parentNode;
	if (!side) return false;
	side.classList.add('tw-side');
	side.id = side.id || 'tw-side';
	side.setAttribute('aria-label', '主選單');
	var main = side.nextElementSibling;
	while (main && !/\bspan9\b/.test(main.className))
		main = main.nextElementSibling;
	if (main) {
		main.classList.add('tw-main');
		main.setAttribute('role', 'main');
	}
	return true;
}

function tw_tabbar(){
	if (document.querySelector('.tw-tabbar') || !document.querySelector('.tw-side'))
		return;
	var here = location.pathname.replace(/^\//, '') || 'index.asp';
	/* 手機底部分頁：總覽、裝置、Wi-Fi、診斷、更多（HANDOFF 5.4） */
	var tabs = [
		['index.asp', 'home', '總覽'],
		['tw_devices.asp', 'devices', '裝置'],
		['tw_wifi.asp', 'wifi', 'Wi-Fi'],
		['tw_diag.asp', 'search', '診斷']
	];
	var h = '', inTabs = false;
	for (var i = 0; i < tabs.length; i++) {
		var on = (here == tabs[i][0]);
		if (on) inTabs = true;
		h += '<a href="/'+tabs[i][0]+'"'+(on ? ' aria-current="page"' : '')+'>'+tw_icon(tabs[i][1], 22)+'<span>'+tabs[i][2]+'</span></a>';
	}
	h += '<button type="button" onclick="tw_nav(true);" aria-controls="tw-side"'+(inTabs ? '' : ' aria-current="page"')+'>'+tw_icon('more', 22)+'<span>更多</span></button>';
	var bar = document.createElement('nav');
	bar.className = 'tw-tabbar';
	bar.setAttribute('aria-label', '主要分頁');
	bar.innerHTML = h;
	document.body.appendChild(bar);

	var scrim = document.createElement('div');
	scrim.className = 'tw-scrim';
	scrim.onclick = function(){ tw_nav(false); };
	document.body.appendChild(scrim);
}

function tw_header_labels(row, n){
	// 一列全是 th、且欄數符合時，回傳欄位名稱
	if (!row || !row.cells || row.cells.length < 3 || (n && row.cells.length != n)) return null;
	var labels = [];
	for (var c = 0; c < row.cells.length; c++) {
		var cell = row.cells[c];
		if (cell.tagName != 'TH' || cell.colSpan > 1) return null;
		labels.push((cell.textContent || '').replace(/\s+/g, ' ').trim());
	}
	return labels;
}

function tw_apply_labels(rows, start, labels){
	var n = 0;
	for (var r = start; r < rows.length; r++) {
		var cs = rows[r].cells;
		if (cs.length < 3) { rows[r].classList.add('tw-plain'); continue; }
		n++;
		for (var k = 0; k < cs.length && k < labels.length; k++) {
			if (cs[k].hasAttribute('data-label')) continue;
			var lab = labels[k];
			if (!lab && cs[k].querySelector('input[type="checkbox"]')) lab = '選取';
			if (lab) cs[k].setAttribute('data-label', lab);
		}
	}
	return n;
}

function tw_table_cards(root){
	// 手機版：資料表的每一列變成卡片，欄位名稱放在每格左側
	// 1) 表頭在同一個表格（第一列全是 th）
	// 2) Padavan 常見寫法：表頭在上一個表格的最後幾列（例如 row_static_caption），清單是另一個 table-list
	var tables = (root || document).querySelectorAll('.tw-main table');
	var lastHead = null;
	for (var t = 0; t < tables.length; t++) {
		var tb = tables[t];
		if (tb.classList.contains('tw-table')) continue;	/* 新介面的清單自己處理手機版 */
		var rows = tb.rows;
		if (!rows || !rows.length) continue;
		var own = null, start = 0;
		for (var r = 0; r < rows.length && r < 3; r++) {
			own = tw_header_labels(rows[r]);
			if (own) { start = r + 1; break; }
		}
		if (own && rows.length > start) {
			// 表頭後面若是輸入列（新增項目用），只加標籤，不做成卡片
			var next = rows[start];
			if (next && next.querySelector('input, select') && /table-list/.test(tb.className) === false && rows.length == start + 1) {
				rows[start - 1].classList.add('tw-head-row');
				next.classList.add('tw-labeled');
				tw_apply_labels(rows, start, own);
				lastHead = { labels: own, row: rows[start - 1] };
				continue;
			}
			if (tw_apply_labels(rows, start, own)) {
				tb.classList.add('tw-cards');
				rows[start - 1].classList.add('tw-head-row');
			}
			lastHead = { labels: own, row: rows[start - 1] };
			continue;
		}
		// 在設定表格裡找最後一個表頭列（欄位說明列），給後面的輸入列與清單表格用
		var found = null;
		for (var r2 = rows.length - 1; r2 >= 0; r2--) {
			var lab = tw_header_labels(rows[r2]);
			if (lab) { found = { labels: lab, row: rows[r2], index: r2 }; break; }
		}
		if (found) {
			found.row.classList.add('tw-head-row');
			for (var r3 = found.index + 1; r3 < rows.length; r3++)
				if (rows[r3].cells.length == found.labels.length && rows[r3].querySelector('input, select')) {
					rows[r3].classList.add('tw-labeled');
					tw_apply_labels([rows[r3]], 0, found.labels);
				}
			lastHead = found;
			continue;
		}
		if (/table-list/.test(tb.className) && lastHead) {
			var cnt = 0;
			for (var r4 = 0; r4 < rows.length; r4++)
				if (rows[r4].cells.length == lastHead.labels.length) cnt++;
			if (cnt && tw_apply_labels(rows, 0, lastHead.labels))
				tb.classList.add('tw-cards');
		}
	}
}

function tw_ui_init(){
	if (!tw_tag_layout()) return;
	tw_tabbar();
	tw_table_cards();
	document.addEventListener('keydown', function(e){
		if (e.key == 'Escape' && document.body.classList.contains('tw-nav-open')) tw_nav(false);
	});
	var side = document.querySelector('.tw-side');
	if (side) side.addEventListener('click', function(e){
		var a = e.target.closest ? e.target.closest('a') : null;
		if (a && a.getAttribute('href') && a.getAttribute('href').indexOf('javascript') != 0) tw_nav(false);
	});
	// 很多頁面在載入後才用 JS 填入表格（裝置清單、轉送規則…），內容變動時重新標記
	var main = document.querySelector('.tw-main');
	if (main && window.MutationObserver) {
		var timer = 0;
		new MutationObserver(function(){
			clearTimeout(timer);
			timer = setTimeout(function(){ tw_table_cards(main); }, 150);
		}).observe(main, { childList: true, subtree: true });
	}
}

if (document.readyState == 'loading')
	document.addEventListener('DOMContentLoaded', tw_ui_init);
else
	tw_ui_init();
