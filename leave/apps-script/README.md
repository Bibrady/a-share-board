# 朔元请假审批 · 后端部署

静态 GitHub Pages 不能直写 Google 表。本目录是跑在你 Google 账号下的 Apps Script Web App：校验 Google 登录、核验邮箱白名单，再读写私有表格「朔元请假审批」。

表格保持私有即可，不要设为「知道链接的任何人」。不要把 Web App 密钥、服务账号 JSON 或可写 webhook 提交进仓库。

## 1. 部署 Apps Script

1. 用 **zhuoyang.shi@gmail.com** 打开 [Google Apps Script](https://script.google.com/)，「新建项目」，名称可填「朔元请假审批」。
2. 将本目录 `Code.gs` 全文粘贴进编辑器（覆盖默认 `myFunction`）。`appsscript.json` 可在「项目设置 → 显示 appsscript.json」后对照时区 `Asia/Shanghai`、运行时 V8。
3. 「部署 → 新建部署」：
   - 类型：**Web 应用**
   - 执行身份：**我**（脚本所有者）
   - 具有访问权限的用户：**任何人**
4. 授权脚本访问该 Google 表与外部请求（校验 ID token 时会访问 `oauth2.googleapis.com`）。
5. 复制 Web App 地址（`https://script.google.com/macros/s/…/exec`）。改代码后必须 **「管理部署 → 编辑 → 新版本」**，否则线上仍是旧版。

脚本首次成功处理请求时，会在表中自行补齐「员工」「配置」工作表（若尚不存在），并写入默认管理员 `zhuoyang.shi@gmail.com`。不要改仓库里的业务数据。

## 2. 创建 Google OAuth 客户端

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → API 和凭据 → 创建凭据 → **OAuth 客户端 ID**。
2. 应用类型：**Web 应用**。
3. **已获授权的 JavaScript 来源** 至少包含：
   - `https://bibrady.github.io`
   - 本地预览可再加 `http://localhost`、`http://127.0.0.1`
4. 不需要授权重定向 URI（页面只用 Google Identity Services 的 ID token）。
5. 复制客户端 ID（形如 `….apps.googleusercontent.com`）。

建议把同一客户端 ID 填进表格「配置」工作表的 `oauth_client_id`。填了之后，后端会校验 token 的 `aud`，避免其它 OAuth 客户端冒用。

## 3. 配到页面

编辑仓库中的 `leave/config.js`（勿把占位符直接上线）：

```js
window.LEAVE_CONFIG = {
  googleClientId: "你的客户端ID.apps.googleusercontent.com",
  appsScriptUrl: "https://script.google.com/macros/s/你的部署ID/exec"
};
```

提交并推送后，GitHub Pages 上的 https://bibrady.github.io/a-share-board/leave/ 才会真正接入。未填写时页面只显示「待完成接入」，不会请求任何请假数据。

## 4. 人员与请假类型

在私有表的「员工」工作表维护名单（默认仅卓炀）：

| 姓名 | 邮箱 | 角色 | 启用 |
| 卓炀 | zhuoyang.shi@gmail.com | 管理员 | 是 |

角色：`管理员` / `审批人` 可审批；`员工` 仅提交与撤销自己的待审批单。启用列空或「是」视为启用。

「配置」表 `leave_types` 为逗号分隔的类型，默认：年假,事假,病假,调休,其他。

## 5. 联调注意

- 前端用 `Content-Type: text/plain` POST JSON，以避开浏览器对 Apps Script 的 CORS 预检。
- 用浏览器打开请假页，应先出现 Google 登录墙；未登录看不到单据。
- 非白名单邮箱登录后只看到拒绝说明，没有列表。
