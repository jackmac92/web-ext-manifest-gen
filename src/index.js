const fs = require("fs");
const glob = require("glob");
const write = require("write");
const path = require("path");
const dependencyTree = require("dependency-tree");
const appRootPath = require("app-root-path");
const pkgDir = require("pkg-dir");

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
  nativeMessaging: s => genRegex("nativeMessaging").test(s),
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

const findAllDependentFiles = () =>
  new Promise((resolve, reject) => {
    glob("./**/*.*s", (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(files);
    });
  })
    .then(async files => {
      const pkgRootDir = await pkgDir(__dirname);
      return files.reduce((acc, f) => {
        global.window = global.window || true;
        dependencyTree
          .toList({
            filename: f,
            tsConfig: `${pkgRootDir}/tsconfig.json`,
            directory: pkgRootDir,
            filter: path =>
              [
                "node_modules",
                "__tests__",
                "__test__",
                ".spec.",
                ".test."
              ].every(x => !path.includes(x))
          })
          .forEach(dep => {
            acc.add(dep);
          });
        return acc;
      }, new Set());
    })
    .then(s => Array.from(s));

const findPermissions = () =>
  findAllDependentFiles().then(files =>
    Promise.all(
      files.map(f =>
        new Promise(resolve => {
          fs.readFile(f, {}, (err, data) => {
            if (err) {
              resolve("");
            } else {
              resolve(data.toString());
            }
          });
        }).then(contents => [f, contents])
      )
    ).then(filesWithContents =>
      filesWithContents.reduce((acc, [fileName, fileContents]) => {
        const foundPermissions = Object.entries(ALL_PERMISSIONS)
          .filter(([_, permTest]) => permTest(fileContents))
          .map(([permType]) => permType);

        for (const permType of foundPermissions) {
          console.log(
            `${fileName} needs ${permType} in the permission set, adding.`
          );
          acc.add(permType);
        }

        return acc;
      }, new Set())
    )
  );

const isCodeFile = file =>
  [".js", ".ts", ".jsx", ".tsx"].some(ext => file.endsWith(ext));

const forgivingReadDir = path => {
  try {
    const dir = fs.readdirSync(path);
    return Promise.resolve(dir);
  } catch (err) {
    return Promise.reject(err);
  }
};
const safeReadDir = p => forgivingReadDir(p).catch(() => []);
const listFiles = folder =>
  safeReadDir(folder).then(files =>
    files.filter(
      file => isCodeFile(file) && fs.lstatSync(path.join(folder, file)).isFile()
    )
  );

const getUrlMatches = scriptPath => {
  const scriptModuleLines = fs
    .readFileSync(`./${scriptPath}`, "utf8")
    .split("\n");
  if (scriptModuleLines[0].includes("matches")) {
    let isCollectionMatchesLines = true;
    return scriptModuleLines.slice(1).reduce((acc, el) => {
      if (!el.startsWith("//")) {
        isCollectionMatchesLines = false;
      }
      if (!isCollectionMatchesLines) {
        return acc;
      }
      return [...acc, el.replace("//", "").trim()];
    }, []);
  } else {
    console.warn("No match urls listed, so matching against all urls");
    return ["*://*/*"];
  }
};

const autoGenContentScripts = contentScriptsDir =>
  listFiles(contentScriptsDir).then(o =>
    o.map(s => {
      const scriptPath = path.join(contentScriptsDir, s);
      const matches = getUrlMatches(scriptPath);
      return { matches, js: [`./${scriptPath}`] };
    })
  );

module.exports.run = async () => {
  if (!fs.existsSync(`${appRootPath}/package.json`)) {
    console.error("Please run from an npm project");
    console.error("No package.json found!!");
    process.exit(1);
  }
  const {
    name: pkgName,
    version,
    description
  } = require(`${appRootPath}/package.json`);

  // https://unpkg.com/
  // TODO handle content_security_policy
  const argv = require("yargs")
    .usage("Usage: $0 -s [injectScriptsDir] -p [permission]")
    .option("scripts", {
      alias: "s",
      describe: "path to content scripts"
    })
    .option("devTools", {
      describe: "path to dev-tools html"
    })
    .option("template", {
      alias: "t",
      describe:
        "path to an existing manifest file which should be used for supplementary keys (will be overriden)"
    })
    .option("backgroundScripts", {
      type: "array",
      describe: "path to background file, multiple entries allowed"
    })
    .option("persistentBackground", {
      type: "boolean",
      default: true,
      describe:
        "Persistent background script? Necessary for things like background websocket connections"
    })
    .option("generatePermissions", {
      type: "boolean",
      default: false,
      describe:
        "Read source code to try to deduce the necessary permissions? (alpha)"
    })
    .option("locale", {
      describe: "path to background file, multiple entries allowed",
      default: "en"
    })
    .option("permissions", {
      alias: "p",
      type: "array",
      describe: "permissions to include in manifest",
      default: ["activeTab"]
    })
    .option("optionalPermissions", {
      type: "array",
      default: [],
      describe: "optional-permissions to include in manifest"
    }).argv;

  const permissionsBase = await (argv.generatePermissions
    ? findPermissions()
    : Promise.resolve([]));

  const easilyOverridableDefaults = {
    permissions: permissionsBase,
    optional_permissions: [],
    version,
    description,
    browser_action: {
      default_title: pkgName
    }
  };
  const manifestBase = (() => {
    try {
      const fileContents = fs.readFileSync(argv.template);
      return JSON.parse(fileContents);
    } catch (e) {
      console.warn("Failed to parse a tempalte manifest, using empty object!");
      return {};
    }
  })();
  const manifest = Object.assign({}, easilyOverridableDefaults, manifestBase, {
    manifest_version: 2,
    default_locale: argv.locale,
    name: pkgName
  });
  if (argv.scripts) {
    manifest.content_scripts = autoGenContentScripts(argv.scripts);
  }
  manifest.permissions = new Set(manifest.permissions);
  manifest.optional_permissions = new Set(manifest.optional_permissions);

  if (argv.devTools) {
    manifest.devtools_page = argv.devTools;
  }
  if (argv.backgroundScripts) {
    manifest.background = {
      scripts: argv.backgroundScripts,
      persistent: argv.persistentBackground
    };
  }

  argv.optionalPermissions.forEach(perm => {
    manifest["optional_permissions"].add(perm);
  });

  argv.permissions.forEach(perm => {
    manifest.permissions.add(perm);
  });

  manifest.permissions = Array.from(manifest.permissions);
  manifest.optional_permissions = Array.from(manifest.optional_permissions);
  await write("./manifest.json", JSON.stringify(manifest, null, 4));
};
