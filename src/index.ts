import fs from "fs";
import tmp from 'tmp'
import child_process from 'child_process';
import glob from "glob";
import write from "write";
import path from "path";
import dependencyTree from "dependency-tree";
import appRootPath from "app-root-path";
import pkgDir from "pkg-dir";
import identifyRequiredPerms from "./permissionExtractor";
import { JSONSchemaForGoogleChromeExtensionManifestFiles as ExtensionManifest } from "./browser-extension-manifest";

const bundleCode = (outpath, ...entrypoints) => new Promise((resolve, reject) => {
  child_process.exec(`rollup --format=es -p=typescript --file=${outpath} -- ${entrypoints.join(" ")}`, (err, stdout, stderr) => {
    if (err) {
      reject(err);
    }
    else {
      resolve();
    }
  });
});

const mktemp = () => new Promise((resolve, reject) => {
  tmp((err, path) => {
    if (err) {
      reject(err);
    }
    else {
      resolve(path);
    }
  });
});

const _hasJq = () => {
  try {
    child_process.execSync("which semgrep");
    return true;
  }
  catch (_e) {
    throw "You must install `jq`, google it!";
  }
};
const _hasSemgrep = () => {
  try {
    child_process.execSync("which semgrep");
    return true;
  }
  catch (_e) {
    throw "You must install `semgrep`, google it!";
  }
};
const verifyPermFinderDeps = () => {
  _hasJq();
  _hasSemgrep();
};
const findUsedPermissionsCore = (bundledJsPath): Promise<any[]> => new Promise((resolve, reject) => {
  child_process.exec(`semgrep -e 'browser.$X' --json --quiet --lang=js --exclude=node_modules ${bundledJsPath} | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r | sort -u`, (err, stdout, stderr) => {
    if (err) {
      reject(stderr);
    }
    else {
      const r = stdout.toString().split("\n").filter(Boolean);
      resolve(r);
    }
  });
});
const _checkForBlockingWebrequestPerm = (bundledJsPath) => new Promise((resolve, reject) => {
  child_process.exec(`semgrep -e 'browser.webRequest.$R.addListener($CB, $PARAMS, [..., "blocking", ...])' --json --quiet --lang=js --exclude=node_modules ${bundledJsPath} | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r | sort -u`, (err, stdout, stderr) => {
    if (err) {
      reject(stderr);
    }
    else {
      const countFound = stdout.toString().split("\n").filter(Boolean)
        .length;
      resolve(countFound > 0);
    }
  });
}).then((a) => a, () => false);

const findUsedPermissions = async (bundledJsPath) => [
  ...(await findUsedPermissionsCore(bundledJsPath)),
  (await _checkForBlockingWebrequestPerm(bundledJsPath))
    ? "webRequestBlocking"
    : null,
].filter(Boolean);
const findPermissions = async (...entrypoints) => {
  verifyPermFinderDeps();
  const bundledJsPath = await mktemp();
  await bundleCode(bundledJsPath, ...entrypoints);
  return findUsedPermissions(bundledJsPath);
};
const findAllDependentFiles = () =>
  new Promise((resolve, reject) => {
    glob("./**/*.*s", (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(files.filter(f => f.indexOf("node_modules") === -1));
    });
  })
    .then(async (files: string[]) => {
      const directory = await pkgDir(__dirname);
      // let tsConfig;
      // const tsConfigPath = `${directory}/tsconfig.json`;
      // if (fs.existsSync(tsConfigPath)) {
      //   tsConfig = tsConfigPath;
      // }
      return files.reduce((acc, f) => {
        // @ts-expect-error
        global.window = global.window || true;
        dependencyTree
          .toList({
            filename: f,
            directory,
            // tsConfig,
            filter: path =>
              ["__tests__", "__test__", ".spec.", ".test."].every(
                x => !path.includes(x)
              )
          })
          .forEach(dep => {
            acc.add(dep);
          });
        return acc;
      }, new Set());
    })
    .then(s => Array.from(s));

const _findPermissionsLegacy = () =>
  findAllDependentFiles().then(files =>
    Promise.all(
      files.map((f: string) =>
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
    )
      .then(filesWithContents =>
        filesWithContents.reduce((acc, [fileName, fileContents]) => {
          const foundPermissions = identifyRequiredPerms(
            fileContents as Buffer
          );
          for (const permType of foundPermissions) {
            console.log(
              `${fileName} needs ${permType} in the permission set, adding.`
            );
            acc.add(permType);
          }

          return acc;
        }, new Set())
      )
      .then(set => Array.from(set))
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

const getUrlMatches = (scriptPath: string): [string, ...string[]] => {
  const scriptModuleLines = fs
    .readFileSync(`./${scriptPath}`, "utf8")
    .split("\n");
  if (scriptModuleLines[0].includes("matches")) {
    let isCollectionMatchesLines = true;
    return scriptModuleLines.slice(1).reduce(
      (acc, el) => {
        if (!el.startsWith("//")) {
          isCollectionMatchesLines = false;
        }
        if (!isCollectionMatchesLines) {
          return acc;
        }
        return [...acc, el.replace("//", "").trim()];
      },
      [""]
    );
  } else {
    console.warn("No match urls listed, so matching against all urls");
    return ["*://*/*"];
  }
};

type ContentScripts = ExtensionManifest["content_scripts"];

const createContentScript = (contentScriptsDir: string) => (
  s: string
): ContentScripts[0] => {
  const scriptPath = path.join(contentScriptsDir, s);
  const matches = getUrlMatches(scriptPath);
  return { matches, js: [`./${scriptPath}`] };
};

const autoGenContentScripts = (
  contentScriptsDir: string
): Promise<ContentScripts | null> =>
  listFiles(contentScriptsDir).then(o => {
    if (o.length < 1) {
      return null;
    }
    return o.map(createContentScript(contentScriptsDir)) as ContentScripts;
  });

export const run = async () => {
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

  const permissionsBase = await (argv.generatePermissions === true
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
      return JSON.parse(fileContents.toString());
    } catch (e) {
      console.warn("Failed to parse a tempalte manifest, using empty object!");
      return {};
    }
  })();
  const manifest: ExtensionManifest = Object.assign(
    {},
    easilyOverridableDefaults,
    manifestBase,
    {
      manifest_version: 2,
      default_locale: argv.locale,
      name: pkgName
    }
  );
  if (argv.scripts) {
    const generatedContentScripts = await autoGenContentScripts(argv.scripts);
    if (generatedContentScripts !== null) {
      manifest.content_scripts = generatedContentScripts;
    }
  }

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
    manifest["optional_permissions"].push(perm);
  });

  argv.permissions.forEach(perm => {
    manifest.permissions.push(perm);
  });

  manifest.permissions = Array.from(new Set(manifest.permissions));
  manifest.optional_permissions = Array.from(
    new Set(manifest.optional_permissions)
  );
  await write("./manifest.json", JSON.stringify(manifest, null, 4));
};
