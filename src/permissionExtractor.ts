// TODO use semgrep for this
//// bundle to find relevant code
// rollup --format=es -p=typescript --file=rolledup.js -- src/code/background/index.ts
//// add permission of same name for each line of output
// cat rolledup.js | semgrep -e 'browser.$X' --json --quiet --lang=js | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r | sort -u
//// add webRequestBlocking if this is a match
// cat rolledup.js | semgrep -e 'browser.webRequest.$R.addListener(..., ..., ["blocking", ...])'

const genRegex = perm =>
  new RegExp(`(chromep?|browser)[\\s\\n]*\\.[\\s\\n]*${perm}`);

const ALL_PERMISSIONS = {
  alarms: s => genRegex("alarms").test(s),
  bookmarks: s => genRegex("bookmarks").test(s),
  contentSettings: s => genRegex("contentSettings").test(s),
  contextMenus: s => genRegex("contextMenus").test(s),
  cookies: s => genRegex("cookies").test(s),
  declarativeContent: s => genRegex("declarativeContent").test(s),
  declarativeNetRequest: s => genRegex("declarativeNetRequest").test(s),
  declarativeWebRequest: s => genRegex("declarativeWebRequest").test(s),
  desktopCapture: s => genRegex("desktopCapture").test(s),
  displaySource: s => genRegex("displaySource").test(s),
  dns: s => genRegex("dns").test(s),
  documentScan: s => genRegex("documentScan").test(s),
  downloads: s => genRegex("downloads").test(s),
  experimental: s => genRegex("experimental").test(s),
  fileBrowserHandler: s => genRegex("fileBrowserHandler").test(s),
  fileSystemProvider: s => genRegex("fileSystemProvider").test(s),
  fontSettings: s => genRegex("fontSettings").test(s),
  gcm: s => genRegex("gcm").test(s),
  geolocation: s => genRegex("geolocation").test(s),
  history: s => genRegex("history").test(s),
  identity: s => genRegex("identity").test(s),
  idle: s => genRegex("idle").test(s),
  idltest: s => genRegex("idltest").test(s),
  management: s => genRegex("management").test(s),
  nativeMessaging: s => ["connectNative", "nativeMessaging"].some(sym => genRegex(sym).test(s)),
  notifications: s => genRegex("notifications").test(s),
  pageCapture: s => genRegex("pageCapture").test(s),
  platformKeys: s => genRegex("platformKeys").test(s),
  power: s => genRegex("power").test(s),
  printerProvider: s => genRegex("printerProvider").test(s),
  privacy: s => genRegex("privacy").test(s),
  processes: s => genRegex("processes").test(s),
  proxy: s => genRegex("proxy").test(s),
  sessions: s => genRegex("sessions").test(s),
  signedInDevices: s => genRegex("signedInDevices").test(s),
  storage: s => genRegex("storage").test(s),
  tabCapture: s => genRegex("tabCapture").test(s),
  // tabs: s => /(chromep?|browser)[\s\n]*\.[\s\n]*tabs/.test(s),
  topSites: s => genRegex("topSites").test(s),
  tts: s => genRegex("tts").test(s),
  ttsEngine: s => genRegex("ttsEngine").test(s),
  unlimitedStorage: s => genRegex("unlimitedStorage").test(s),
  vpnProvider: s => genRegex("vpnProvider").test(s),
  wallpaper: s => genRegex("wallpaper").test(s),
  webNavigation: s => genRegex("webNavigation").test(s),
  webRequest: s => genRegex("webRequest").test(s),
  webRequestBlocking: s =>
    ALL_PERMISSIONS.webRequest(s) && s.includes("'blocking'")
};
export default function identifyPermissionsInSource(fileContents: Buffer) {
  return Object.entries(ALL_PERMISSIONS)
    .filter(([_, permTest]) => permTest(fileContents))
    .map(([permType]) => permType);
}
