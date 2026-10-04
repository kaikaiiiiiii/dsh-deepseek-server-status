/**
 * 浏览器侧样式数据。
 * 入口通过 require.async 懒加载本模块，因此文件名遵守加载器的
 * `client.*.js` 约定；样式规则集中在这里，入口只负责插入一次。
 */
window.__ModuleLoader__.load({
  id: "dsh-deepseek-server-status",
  chunk: "client.css.js",
  factory: () => {
    const SHEET_RULES = [
      ".__dss_root{position:relative;display:inline-flex;align-items:center;min-width:0}",
      ".__dss_btn{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:6px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex}",
      ".__dss_btn:hover{color:var(--dsw-alias-label-secondary)}",
      ".__dss_label{white-space:nowrap}",
      ".__dss_dot{flex:none;width:8px;height:8px;border-radius:50%;display:inline-block}",
      ".__dss_ok{background:var(--dsw-alias-state-success-primary,#22c55e)}",
      ".__dss_maint{background:var(--dsw-alias-state-business-primary,#3b82f6)}",
      ".__dss_degraded{background:#f59e0b}",
      ".__dss_partial{background:#f97316}",
      ".__dss_outage{background:var(--dsw-alias-state-error-primary,#ef4444)}",
      ".__dss_unknown{background:var(--dsw-alias-label-tertiary,#9ca3af)}",
      ".__dss_panel{position:absolute;top:calc(100% + 6px);right:0;z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2)),var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2)));width:320px;max-width:min(520px,100vw - 32px);max-height:min(460px,100vh - 160px);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:10px;overflow:auto;font-size:12px;line-height:18px;min-width:0}",
      ".__dss_head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-weight:600}",
      ".__dss_sub{color:var(--dsw-alias-label-tertiary);font-size:11px}",
      ".__dss_sect{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}",
      ".__dss_link{color:var(--dsw-alias-brand-primary);text-decoration:none}",
      ".__dss_link:hover{text-decoration:underline}",
      ".__dss_err{color:var(--dsw-alias-label-error)}",
      ".__dss_chips{display:flex;align-items:center;gap:4px;flex-wrap:wrap}",
      ".__dss_chipGroup{display:flex;flex-direction:column;gap:4px}",
      ".__dss_chip{flex:0 0 auto;width:min(72px,calc((100% - 12px) / 4));height:32px;border-radius:5px;box-sizing:border-box;display:block;padding:0 2px;line-height:32px;color:#111827;font-size:12px;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}",
      ".__dss_chip.__dss_ok{background:#4ade80}",
      ".__dss_faults{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;min-width:0}",
      ".__dss_fault{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-secondary)}",
      ".__dss_faultDot{flex:none;width:8px;height:8px;border-radius:50%;display:inline-block}",
      ".__dss_faultState{flex:none}",
      ".__dss_faultTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}",
      ".__dss_faultTime{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}",
    ];

    return {
      SHEET_RULES,
      SHEET_TEXT: SHEET_RULES.join(""),
      SHEET_ID: "dsh-deepseek-server-status/main.css",
    };
  },
});
