/* 复制为 config.js 后填入真实值。OAuth Client ID 会公开出现在前端，这是预期行为；
   真正的保护在 Apps Script：校验 ID token 与邮箱白名单。 */
window.LEAVE_CONFIG = {
  googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  appsScriptUrl: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
};
