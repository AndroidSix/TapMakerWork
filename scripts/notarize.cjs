const path = require("node:path");
const { notarize } = require("@electron/notarize");

exports.default = async function notarizeMacRelease(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) return;
  await notarize({
    appPath: path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    appleId,
    appleIdPassword,
    teamId
  });
};
