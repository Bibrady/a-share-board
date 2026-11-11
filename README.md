# a-share-board
A股每日收盘创10日新高突破筛选看板（自动更新，数据来源：同花顺 Fuyao）

## 模型 / AI 探索进度

页面：<https://bibrady.github.io/a-share-board/pages/ai-evo/>  
导航：顶栏「研究」→「模型/AI探索」

这是 GitHub Pages 静态站：**刷新不会连探索器**，只强拉仓库里已提交的 `progress.json` / `trials.json`（cache-bust + 尽量读 GitHub 最新 commit，避开 Pages 缓存）。探索器本地在跑、站上却不动，是因为快照还没同步进仓库。

### 探索器必须用 `sync_ai_evo_dashboard` 同步

把探索器输出拷进本仓库（需要站上跟着变时再 `--commit --push`）：

```
python3 sync_ai_evo_dashboard.py --from /path/to/explorer/out
python3 sync_ai_evo_dashboard.py --from /path/to/explorer/out --commit --push
python3 sync_ai_evo_dashboard.py --from /path/to/explorer/out --watch 60 --commit --push
```

也可设环境变量 `AI_EVO_SRC` 作为默认 `--from`。进度文件必须带 `updated_at`，页面靠它判断快照有没有变。

- `pages/ai-evo/data/progress.json` — 主数据：`status`、`evals_done`、`evals_per_sec`、`fee`、`best_so_far`、`top5`，以及可选的 `recent_trials`
- `pages/ai-evo/data/trials.json` — 可选片段。若存在且含 `trials`（或 `recent_trials`），优先用来画「最近试验」表

### 刷新按钮在做什么

点「刷新」会：

1. 强拉 `progress.json` 和 `trials.json`（`cache: no-store` + `?t=&r=`）；未用 `?src=` 时先读 GitHub 最新 commit，再回退到 Pages
2. 更新页头「拉取」时间为这次实际取数时间（证明 cache-bust 有跑）
3. 若 `updated_at` 没变：toast「数据仍是仓库快照；需同步探索器」，并提示「站上数据未更新」
4. 若 `updated_at` 变了：toast「数据已更新」并重绘

可选覆盖进度地址（给 bot / CDN 以后用）：

```
https://bibrady.github.io/a-share-board/pages/ai-evo/?src=https://example.com/progress.json
https://bibrady.github.io/a-share-board/pages/ai-evo/?src=https://example.com/live/
```

`?src=` 指向文件时，同目录的 `trials.json` 会一并尝试；指向目录时会读该目录下的 `progress.json` / `trials.json`。请对 URL 做 encode。

约 30 秒自动拉一次本地快照；自动刷新不会弹「未更新」toast。`?poll=0` 可关掉自动拉。费率按币安 USDT-M VIP0 吃单 0.05% 展示。

改顶栏分组时编辑 `site_nav.py` 里的 `GROUPS`，然后执行：

```
python3 site_nav.py
```

页面里的 `<!--SITE_NAV-->` 会被替换成与现有看板相同的浅色纸顶栏。
