/*
 * padavan-tw：漫遊中控的驅動介面（tw_roam_drv.c 實作，tw_roamd.c 的決定層呼叫）
 *
 * 決定層只用這幾個函式，跟晶片無關；各晶片的 ioctl／事件細節都在 tw_roam_drv.c。
 * 原則（docs/ROAM-COOP.md 第 1 節）：只送 11k Beacon Request 與 11v BTM「建議」，
 * BTM 一律不設 Disassociation Imminent、不帶斷線計時，絕不送 Deauth／Disassoc。
 */
#ifndef TW_ROAM_H
#define TW_ROAM_H

/* 一個候選 BSS（鄰居清單、BTM 候選共用） */
struct twr_nbr {
	unsigned char bssid[6];
	int band;		/* 2 或 5 */
	int ch;
	int bw;			/* MHz */
	int pref;		/* BTM 偏好值 1～255（越大越想要），鄰居清單填 0 */
	int ft;			/* 有開 802.11r（同一個 Mobility Domain，可以快速漫遊過去） */
};

/* 驅動送上來的事件 */
#define TWR_EV_BCN_REPORT	1	/* 裝置回報量到某個 BSS */
#define TWR_EV_BTM_RESP		2	/* 裝置回覆 BTM（不是每顆驅動都有） */

struct twr_drv_ev {
	int type;
	int band;			/* 收到事件的頻段（2 或 5），不知道時 0 */
	unsigned char sta[6];
	unsigned char bssid[6];		/* Beacon Report：量到的 BSS；BTM Response：裝置要去的 BSS */
	int ch;
	int dbm;			/* Beacon Report 的訊號（標準 RCPI 換成 dBm；超出範圍時 0） */
	int rcpi;			/* Beacon Report 的原始 RCPI 欄位（0～254；有些裝置填的是有號數 dBm，由決定層判斷） */
	int status;			/* BTM Response 的狀態碼（0＝接受） */
};

/* 這台機型的驅動支援到哪裡（twr_drv_init 之後才有效） */
struct twr_drv_caps {
	const char *name;		/* 例："MT7603E＋MT7612E" */
	int bcn_req[2];			/* [0]＝2.4G、[1]＝5G：能送 Beacon Request */
	int bcn_rep[2];			/* 收得到 Beacon Report（含是哪台裝置回的） */
	int btm[2];			/* 能送 BTM（不踢人的版本） */
	int nbr[2];			/* 能由程式設定 11k 鄰居清單 */
	int sta_caps;			/* 能查每台裝置支不支援 11k／11v */
};

int twr_drv_init(struct twr_drv_caps *caps);
/* 結束前呼叫：把交給程式處理的功能（鄰居詢問）交回驅動 */
void twr_drv_close(void);
/* 送 Beacon Request：只量一個頻道（ch），bssid 為 NULL 時量該頻道所有 BSS；回傳 0＝已交給驅動 */
int twr_drv_bcn_req(int band, const unsigned char *sta, int ch, const unsigned char *bssid, int token);
/* 送 BTM 建議（Request Mode：Preferred Candidate List Included＋Abridged，不設 Disassociation Imminent） */
int twr_drv_btm_req(int band, const unsigned char *sta, const struct twr_nbr *cand, int n, int token);
void twr_drv_btm_imminent(int on);	/* 1＝之後的 BTM 加上 Disassociation Imminent（D3 的原始版本體才有效） */
/* 設定 11k 鄰居清單（驅動回答裝置的 Neighbor Report Request 時用） */
int twr_drv_set_nbr(int band, const struct twr_nbr *list, int n);
/* 查裝置能力：*k、*v 為 1＝支援、0＝不支援、-1＝不知道 */
void twr_drv_sta_caps(int band, const unsigned char *sta, int *k, int *v);
/* 事件：回傳可以 poll 的 fd（沒有事件路徑時 -1）；twr_drv_read 讀出最多 max 筆，回傳筆數 */
int twr_drv_event_fd(void);
int twr_drv_read(struct twr_drv_ev *ev, int max);

#endif
