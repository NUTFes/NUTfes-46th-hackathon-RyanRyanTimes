// 制限された Windows 環境で os.userInfo() が ENOMEM になる場合の任意プリロード。
// tsx の一時ディレクトリ名にだけ必要なユーザー情報を、既存の環境変数で補う。
// ファイルアクセス権やネットワーク権限は変更しない。
const os = require("node:os");
if (process.platform === "win32") {
  const original = os.userInfo;
  os.userInfo = function (options) {
    try { return original.call(os, options); }
    catch (error) {
      if (error.code !== "ERR_SYSTEM_ERROR" || error.info?.syscall !== "uv_os_get_passwd" || error.info?.code !== "ENOMEM") throw error;
      const encode = value => options?.encoding === "buffer" ? Buffer.from(value) : value;
      return { uid: -1, gid: -1, username: encode(process.env.USERNAME || "local"), homedir: encode(os.homedir()), shell: null };
    }
  };
}
