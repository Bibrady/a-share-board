# a-share-board
A股每日收盘创10日新高突破筛选看板（自动更新，数据来源：同花顺 Fuyao）

## 模型 / AI 探索进度

页面：<https://bibrady.github.io/a-share-board/pages/ai-evo/>  
导航：顶栏「研究」→「模型/AI探索」

探索器覆盖下面两个静态文件后，页面会自动拉取（约 30 秒刷新；也可点「刷新」）。GitHub Pages 有短缓存，请求带了 `?t=` 和 `cache: no-store`。

- `pages/ai-evo/data/progress.json` — 主数据：`status`、`evals_done`、`evals_per_sec`、`fee`、`best_so_far`、`top5`，以及可选的 `recent_trials`
- `pages/ai-evo/data/trials.json` — 可选片段。若存在且含 `trials`（或 `recent_trials`），优先用来画「最近试验」表

`progress.json` 字段示例见该文件。试验行至少要有策略名（`label` / `strategy`）和收益（`oos_mean_price` / `ret`）。费率按币安 USDT-M VIP0 吃单 0.05% 展示。

改顶栏分组时编辑 `site_nav.py` 里的 `GROUPS`，然后执行：

```
python3 site_nav.py
```

页面里的 `<!--SITE_NAV-->` 会被替换成与现有看板相同的浅色纸顶栏。
