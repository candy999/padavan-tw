/*
 * padavan-tw 圖表主題（網路流量、系統資訊）：顏色取自 tw.css 的設計變數，亮色／暗色都正確；
 * 不用漸層、陰影、框線（2026-11-24 全頁巡查）。原本的主題是 2012 年的漸層白底。
 */
(function(){
	var cs = window.getComputedStyle ? getComputedStyle(document.documentElement) : null;
	function v(name, fallback){
		var x = cs ? cs.getPropertyValue(name).trim() : '';
		return x || fallback;
	}
	var text = v('--text', '#15181C'), muted = v('--muted', '#59616C'), line = v('--line', '#E1E4E9');
	var surface = v('--surface', '#FFFFFF'), surface2 = v('--surface-2', '#EEF0F3'), accent = v('--accent', '#2457D6');
	var down = v('--down', '#2457D6'), up = v('--up', '#C2610C');
	var font = v('--font', 'sans-serif');
	var base = { color: muted, fontFamily: font, fontSize: '12px' };

	// 頁面寫死的舊顏色換成設計色：下行（橘）→ --down、上行（深藍）→ --up；系統資訊的 CPU／記憶體也用同一組
	var remap = {
		'#ff9000': down, '#003eba': up,
		'#058dc7': down, '#50b432': v('--good', '#17734F'), '#ed561b': up, '#dddf00': v('--warn', '#96500A')
	};
	window.tw_chart_color = function(c){
		return (c && remap[String(c).toLowerCase()]) || c;
	};

	Highcharts.theme = {
		colors: [down, up, v('--good', '#17734F'), v('--warn', '#96500A'), v('--bad', '#B42318'), muted],
		chart: {
			backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0,
			plotBackgroundColor: 'transparent', plotShadow: false, plotBorderWidth: 0,
			style: { fontFamily: font }
		},
		title: { style: { color: text, fontFamily: font, fontWeight: '600', fontSize: '14px' } },
		subtitle: { style: { color: muted, fontFamily: font, fontSize: '12px' } },
		xAxis: {
			gridLineWidth: 0, lineWidth: 1, lineColor: line, tickWidth: 0, tickLength: 4, tickColor: line,
			labels: { y: 16, autoRotation: false, style: base },
			title: { style: { color: muted, fontFamily: font, fontWeight: '400', fontSize: '12px' } }
		},
		yAxis: {
			gridLineWidth: 1, gridLineColor: line, minorGridLineWidth: 0, minorTickInterval: null,
			lineWidth: 0, tickWidth: 0,
			labels: { x: 2, align: 'left', style: base },
			title: { style: { color: muted, fontFamily: font, fontWeight: '400', fontSize: '12px' } }
		},
		plotOptions: { series: { shadow: false } },
		tooltip: {
			backgroundColor: surface, borderColor: line, borderWidth: 1, borderRadius: 8, shadow: false,
			style: { color: text, fontFamily: font, fontSize: '12px' }
		},
		legend: {
			borderWidth: 0, backgroundColor: 'transparent',
			itemStyle: { color: text, fontFamily: font, fontWeight: '400', fontSize: '12px' },
			itemHoverStyle: { color: accent }, itemHiddenStyle: { color: line }
		},
		rangeSelector: {
			buttonTheme: {
				fill: surface2, stroke: 'none', 'stroke-width': 0, r: 6,
				style: { color: muted, fontWeight: '400' },
				states: { hover: { fill: line, style: { color: text } }, select: { fill: accent, style: { color: v('--on-accent', '#FFFFFF'), fontWeight: '600' } } }
			},
			labelStyle: { color: muted, fontFamily: font }
		},
		navigator: {
			margin: 10, outlineColor: line, maskFill: 'rgba(36, 87, 214, 0.12)',
			handles: { backgroundColor: surface2, borderColor: v('--line-strong', '#B9C0C9') },
			xAxis: { gridLineColor: line, labels: { style: base } },
			series: { color: down, lineColor: down }
		},
		scrollbar: {
			barBackgroundColor: surface2, barBorderColor: line, buttonArrowColor: muted,
			buttonBackgroundColor: surface2, buttonBorderColor: line, trackBackgroundColor: 'transparent', trackBorderColor: line, rifleColor: muted
		},
		credits: { style: { color: muted, fontSize: '10px' } },
		labels: { style: { color: muted } }
	};

	// 系統資訊頁的系列名稱（上游寫死英文）
	var names = { Busy: '忙碌', User: '使用者程式', System: '系統', Sirq: '軟體中斷', Used: '已使用', Buffers: '緩衝區', Cached: '快取' };

	// 頁面在建立圖表時給的系列顏色、名稱換掉；窄螢幕時圖例改放圖表下方，不疊在標題上（不改上游頁面）
	if (Highcharts.wrap && Highcharts.Chart) {
		Highcharts.wrap(Highcharts.Chart.prototype, 'init', function(proceed, options){
			var s = options && options.series;
			if (s) for (var i = 0; i < s.length; i++) {
				if (!s[i]) continue;
				if (s[i].color) s[i].color = window.tw_chart_color(s[i].color);
				if (names[s[i].name]) s[i].name = names[s[i].name];
			}
			if (options && window.innerWidth < 700) {
				options.legend = options.legend || {};
				options.legend.floating = false; options.legend.verticalAlign = 'bottom'; options.legend.align = 'center';
			}
			return proceed.apply(this, Array.prototype.slice.call(arguments, 1));
		});
	}
})();

// Apply the theme
var highchartsOptions = Highcharts.setOptions(Highcharts.theme);
