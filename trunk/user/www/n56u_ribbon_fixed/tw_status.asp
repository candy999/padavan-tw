<% wanlink(); %>
<% nf_values(); %>
<% kuroshio_status(); %>
<% netdev(); %>
var tw_sys = <% json_system_status(); %>;
var tw_clients = [<% get_static_client(); %>];
var tw_wl = {<% wl_auth_list(); %>};
var tw_dhcp_static = [<% get_nvram_list("LANHostConfig", "ManualDHCPList"); %>];
var tw_mf = [<% get_nvram_list("FirewallConfig", "MFList"); %>];
var tw_nv = {
link_internet: "<% nvram_get_x("", "link_internet"); %>",
macfilter: "<% nvram_get_x("", "macfilter_enable_x"); %>",
rt_radio: "<% nvram_get_x("", "rt_radio_x"); %>",
wl_radio: "<% nvram_get_x("", "wl_radio_x"); %>",
rt_guest: "<% nvram_get_x("", "rt_guest_enable"); %>",
wl_guest: "<% nvram_get_x("", "wl_guest_enable"); %>",
rt_channel: "<% nvram_get_x("", "rt_channel"); %>",
wl_channel: "<% nvram_get_x("", "wl_channel"); %>",
kuroshio_enable: "<% nvram_get_x("", "kuroshio_enable"); %>",
wgs_enable: "<% nvram_get_x("", "wgs_enable"); %>"
};
