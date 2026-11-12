/* padavan-tw：WireGuard 金鑰與裝置設定檔（只在瀏覽器裡計算）
 *
 * 新增裝置時，裝置的私鑰在瀏覽器產生、只顯示這一次，不會送到路由器；
 * 路由器只保存裝置的公鑰與預共用金鑰（PSK）。
 * X25519 依 RFC 7748 實作（BigInt），亂數用 crypto.getRandomValues。
 */

var tw_wg = (function () {
	var P = (BigInt(1) << BigInt(255)) - BigInt(19);
	var A24 = BigInt(121665);
	var ZERO = BigInt(0), ONE = BigInt(1);

	function mod(a) {
		a = a % P;
		return a < ZERO ? a + P : a;
	}

	function modpow(b, e) {
		var r = ONE;
		b = mod(b);
		while (e > ZERO) {
			if (e & ONE) r = mod(r * b);
			b = mod(b * b);
			e >>= ONE;
		}
		return r;
	}

	function le2big(b) {
		var r = ZERO;
		for (var i = 31; i >= 0; i--)
			r = (r << BigInt(8)) | BigInt(b[i]);
		return r;
	}

	function big2le(n) {
		var out = new Uint8Array(32);
		for (var i = 0; i < 32; i++) {
			out[i] = Number(n & BigInt(255));
			n >>= BigInt(8);
		}
		return out;
	}

	function clamp(k) {
		var c = new Uint8Array(k);
		c[0] &= 248;
		c[31] &= 127;
		c[31] |= 64;
		return c;
	}

	/* RFC 7748 第 5 節 */
	function x25519(k, u) {
		var sc = le2big(clamp(k));
		var uu = new Uint8Array(u);
		uu[31] &= 127;
		var x1 = le2big(uu);
		var x2 = ONE, z2 = ZERO, x3 = x1, z3 = ONE, swap = ZERO, t, kt, tmp;
		for (t = 254; t >= 0; t--) {
			kt = (sc >> BigInt(t)) & ONE;
			swap ^= kt;
			if (swap) { tmp = x2; x2 = x3; x3 = tmp; tmp = z2; z2 = z3; z3 = tmp; }
			swap = kt;
			var A = mod(x2 + z2), AA = mod(A * A);
			var B = mod(x2 - z2), BB = mod(B * B);
			var E = mod(AA - BB);
			var C = mod(x3 + z3), D = mod(x3 - z3);
			var DA = mod(D * A), CB = mod(C * B);
			x3 = mod((DA + CB) * (DA + CB));
			z3 = mod(x1 * mod((DA - CB) * (DA - CB)));
			x2 = mod(AA * BB);
			z2 = mod(E * mod(AA + A24 * E));
		}
		if (swap) { tmp = x2; x2 = x3; x3 = tmp; tmp = z2; z2 = z3; z3 = tmp; }
		return big2le(mod(x2 * modpow(z2, P - BigInt(2))));
	}

	var BASE = new Uint8Array(32);
	BASE[0] = 9;

	function b64(bytes) {
		var s = "";
		for (var i = 0; i < bytes.length; i++)
			s += String.fromCharCode(bytes[i]);
		return btoa(s);
	}

	function unb64(s) {
		var bin = atob(s), out = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++)
			out[i] = bin.charCodeAt(i);
		return out;
	}

	function random32() {
		var b = new Uint8Array(32);
		(window.crypto || window.msCrypto).getRandomValues(b);
		return b;
	}

	function supported() {
		try {
			return typeof BigInt === "function" && !!(window.crypto || window.msCrypto) && typeof btoa === "function";
		} catch (e) {
			return false;
		}
	}

	/* 產生一組裝置金鑰：{priv, pub, psk}（Base64，跟 wg genkey／pubkey／genpsk 相同格式） */
	function keypair() {
		var priv = clamp(random32());
		return { priv: b64(priv), pub: b64(x25519(priv, BASE)), psk: b64(random32()) };
	}

	function pubkey(privB64) {
		return b64(x25519(unb64(privB64), BASE));
	}

	function valid_key(s) {
		return /^[A-Za-z0-9+\/]{42}[AEIMQUYcgkosw480]=$/.test(s || "");
	}

	/* IPv4 位址與遮罩 → 網段字串（例如 192.168.2.0/24） */
	function lan_cidr(ip, mask) {
		var a = ip.split("."), m = mask.split("."), n = [], bits = 0, i, v;
		if (a.length != 4 || m.length != 4) return "";
		for (i = 0; i < 4; i++) {
			v = parseInt(m[i], 10);
			n.push(parseInt(a[i], 10) & v);
			while (v) { bits += v & 1; v >>= 1; }
		}
		return n.join(".") + "/" + bits;
	}

	/* opt: {priv, psk, addr, dns, serverPub, endpoint, full, lanCidr, vpnNet} */
	function client_conf(o) {
		var allowed = o.full ? "0.0.0.0/0, ::/0" : (o.vpnNet + (o.lanCidr ? ", " + o.lanCidr : ""));
		return "[Interface]\n" +
			"PrivateKey = " + o.priv + "\n" +
			"Address = " + o.addr + "/32\n" +
			(o.dns ? "DNS = " + o.dns + "\n" : "") +
			"\n[Peer]\n" +
			"PublicKey = " + o.serverPub + "\n" +
			"PresharedKey = " + o.psk + "\n" +
			"Endpoint = " + o.endpoint + "\n" +
			"AllowedIPs = " + allowed + "\n" +
			"PersistentKeepalive = 25\n";
	}

	/* QR 碼（需要 qrcode.js）；回傳 SVG 字串 */
	function qr_svg(text) {
		if (typeof qrcode !== "function") return "";
		var q = qrcode(0, "M");
		q.addData(text);
		q.make();
		return q.createSvgTag(4, 8);
	}

	/* 私人網段、CGNAT：外面的人連不到這個位址 */
	function is_private_ip(ip) {
		var a = (ip || "").split(".").map(function (x) { return parseInt(x, 10); });
		if (a.length != 4 || isNaN(a[0])) return false;
		return a[0] == 10 || a[0] == 127 || a[0] == 0 ||
			(a[0] == 100 && a[1] >= 64 && a[1] <= 127) ||
			(a[0] == 172 && a[1] >= 16 && a[1] <= 31) ||
			(a[0] == 192 && a[1] == 168) ||
			(a[0] == 169 && a[1] == 254);
	}

	return {
		supported: supported,
		keypair: keypair,
		pubkey: pubkey,
		x25519: x25519,
		valid_key: valid_key,
		lan_cidr: lan_cidr,
		client_conf: client_conf,
		qr_svg: qr_svg,
		is_private_ip: is_private_ip,
		b64: b64,
		unb64: unb64
	};
})();

if (typeof module === "object" && module.exports)
	module.exports = tw_wg;
