import fs from "fs";
import debug from "debug";
import tmp from "tmp";
import child_process from "child_process";
import glob from "glob";
import write from "write";
import path from "path";
import dependencyTree from "dependency-tree";
import appRootPath from "app-root-path";
import pkgDir from "pkg-dir";
import identifyRequiredPerms, { ALL_PERMISSIONS } from "./permissionExtractor";
import { JSONSchemaForGoogleChromeExtensionManifestFiles as ExtensionManifest } from "./browser-extension-manifest";

const logger = debug("web-ext-manifest-gen");
const genPermsLogger = logger.extend("generatePermissions");
const semgrepLogger = genPermsLogger.extend("semgrep");

function bundleCode(outpath, ...entrypoints) {
  genPermsLogger("Bundling code");
  const entrypointStr = entrypoints.join(" ");
  genPermsLogger(entrypointStr);
  return new Promise((resolve, reject) => {
    const cmd = `esbuild --bundle --target=es2020 --outfile=${outpath}  ${entrypointStr}`;
    child_process.exec(cmd, (err, stdout, stderr) => {
      genPermsLogger(stdout);
      if (err) {
        genPermsLogger("Code bundle failed!");
        genPermsLogger(stderr);
        reject(err);
      } else {
        resolve(void 0);
      }
    });
  });
}

const mktemp = () =>
  new Promise((resolve, reject) => {
    tmp.file((err, path) => {
      if (err) {
        logger("mktemp failed!!");
        reject(err);
      } else {
        logger(`temp path at ${path}`);
        resolve(path);
      }
    });
  });

const getVersionFromGitTags = () =>
  new Promise((resolve, reject) => {
    child_process.exec("git tag --list", (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      const out = stdout
        .toString()
        .split("\n")
        .map((el) => el.match(/([\d\.]+\d)/i))
        .filter(Boolean)
        .map((reMatch) => reMatch[1])
        .sort()
        .reverse()[0];
      resolve(out);
    });
  });

const _hasJq = () => {
  try {
    child_process.execSync("which jq");
    return true;
  } catch (_e) {
    throw "You must install `jq`, google it!";
  }
};
const _hasSemgrep = () => {
  //TODO check for particular semgrep version
  try {
    child_process.execSync("which semgrep");
    return true;
  } catch (_e) {
    throw "You must install `semgrep`, google it!";
  }
};

const verifyPermFinderDeps = () => {
  _hasJq();
  _hasSemgrep();
};

const _findUsedPermssionsSemgrepHelper =
  (entryPoint) =>
    (semgrepSearch: string): Promise<string[]> =>
      new Promise((resolve, reject) => {
        const fileExt = entryPoint.split(".").reverse()[0];
        semgrepLogger(`Treating ${entryPoint} as ${fileExt}`)
        // const semgrepQuery = `semgrep -e '${semgrepSearch}' --json --quiet --lang=${fileExt} --exclude=node_modules ${entryPoint} | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r`;
        // going back to hardcode ts cuz I think this is broken
        const semgrepQuery = `semgrep -e '${semgrepSearch}' --json --quiet --lang=ts --exclude=node_modules ${entryPoint} | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r`;
        semgrepLogger(`Checking ${entryPoint} for ${semgrepQuery}`);
        child_process.exec(semgrepQuery, (err, stdout, stderr) => {
          if (err) {
            semgrepLogger("Error!!", err);
            reject(stderr);
          } else {
            const r = stdout.toString().split("\n").filter(Boolean);
            semgrepLogger("got", r);
            resolve(r);
          }
        });
      });

function uniqify(els: string[]): string[] {
  return Array.from(new Set(els))
}

const findUsedPermissionsCore = async (entrypoint): Promise<string[]> => {
  const _helper = _findUsedPermssionsSemgrepHelper(entrypoint);
  const perms = await Promise.all([
    _helper("browser.$X"),
    _helper("browser.runtime.$X"),
  ]);
  const flatPerms = perms
    .flatMap((e) => e)
  genPermsLogger("flat perms", flatPerms)
  const allPermsList = Object.keys(ALL_PERMISSIONS).map(a => a.toLowerCase())
  const result = flatPerms
    .filter((p) => allPermsList.includes(p.toLowerCase()))
  genPermsLogger("final perms core", result)
  return result
}
const _findUsedPermssionsSemgrepHelperViaBundle = (bundledJsPath) => (semgrepSearch: string) =>
  new Promise((resolve, reject) => {
    const semgrepQuery = `semgrep -e '${semgrepSearch}' --json --quiet --lang=js --exclude=node_modules ${bundledJsPath} | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r | sort -u`
    semgrepLogger(`Checking ${bundledJsPath} for ${semgrepQuery}`)
    child_process.exec(
      semgrepQuery,
      (err, stdout, stderr) => {
        if (err) {
          semgrepLogger('Error!!', err)
          reject(stderr);
        } else {
          const r = stdout.toString().split("\n").filter(Boolean);
          semgrepLogger('got', r)
          resolve(r);
        }
      }
    );
  })


const findUsedPermissionsCoreViaBundle = (bundledJsPath): Promise<any[]> => {
  const _helper = _findUsedPermssionsSemgrepHelperViaBundle(bundledJsPath)
  return Promise.all([
    _helper('browser.$X'),
    _helper('browser.runtime.$X'),
    _helper('$Y.browser.$X'),
    _helper('$Y.browser.runtime.$X'),
  ]).then((items) => items.flatMap((e) => e));
};

const _checkForBlockingWebrequestPerm = (bundledJsPath) =>
  new Promise((resolve, reject) => {
    child_process.exec(
      `semgrep -e 'browser.webRequest.$R.addListener($CB, $PARAMS, [..., "blocking", ...])' --json --quiet --lang=js --exclude=node_modules ${bundledJsPath} | jq '.results | .[] | .extra.metavars."$X".abstract_content' -r | sort -u`,
      (err, stdout, stderr) => {
        if (err) {
          reject(stderr);
        } else {
          const countFound = stdout
            .toString()
            .split("\n")
            .filter(Boolean).length;
          resolve(countFound > 0);
        }
      }
    );
  }).then(
    (a) => a,
    () => false
  );

async function findUsedPermissions(entryPoint): Promise<string[]> {
  const basePermList = await findUsedPermissionsCore(entryPoint);
  if (await _checkForBlockingWebrequestPerm(entryPoint)) {
    basePermList.push("webRequestBlocking");
  }


  return uniqify(basePermList);
}

const findPermissions = async (...entrypoints) => {
  verifyPermFinderDeps();
  const allPerms = await Promise.all(entrypoints.map(findUsedPermissions));
  genPermsLogger("All perms almost", allPerms)
  const final = allPerms.flatMap((e) => e).filter(Boolean);
  genPermsLogger("final perms", final)
  return final
}

const findUsedPermissionsViaBundle = async (bundledJsPath) =>
  [
    ...(await findUsedPermissionsCoreViaBundle(bundledJsPath)),
    (await _checkForBlockingWebrequestPerm(bundledJsPath))
      ? "webRequestBlocking"
      : null,
  ].filter(Boolean);

const findPermissionsViaBundle = async (...entrypoints) => {
  verifyPermFinderDeps();
  const bundledJsPath = await mktemp();
  await bundleCode(bundledJsPath, ...entrypoints);
  return findUsedPermissionsViaBundle(bundledJsPath);
};
const findAllDependentFiles = () =>
  new Promise((resolve, reject) => {
    glob("./**/*.*s", (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(files.filter((f) => f.indexOf("node_modules") === -1));
    });
  })
    .then(async (files: string[]) => {
      const directory = await pkgDir(process.cwd());
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
            filter: (path) =>
              ["__tests__", "__test__", ".spec.", ".test."].every(
                (x) => !path.includes(x)
              ),
          })
          .forEach((dep) => {
            acc.add(dep);
          });
        return acc;
      }, new Set());
    })
    .then((s) => Array.from(s));

const _findPermissionsLegacy = () =>
  findAllDependentFiles().then((files) =>
    Promise.all(
      files.map((f: string) =>
        new Promise((resolve) => {
          fs.readFile(f, {}, (err, data) => {
            if (err) {
              resolve("");
            } else {
              resolve(data.toString());
            }
          });
        }).then((contents) => [f, contents])
      )
    )
      .then((filesWithContents) =>
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
      .then((set) => Array.from(set))
  );

const isCodeFile = (file) =>
  [".js", ".ts", ".jsx", ".tsx"].some((ext) => file.endsWith(ext));

const forgivingReadDir = (path) => {
  try {
    const dir = fs.readdirSync(path);
    return Promise.resolve(dir);
  } catch (err) {
    return Promise.reject(err);
  }
};
const safeReadDir = (p) => forgivingReadDir(p).catch(() => []);
const listFiles = (folder) =>
  safeReadDir(folder).then((files) =>
    files.filter(
      (file) =>
        isCodeFile(file) && fs.lstatSync(path.join(folder, file)).isFile()
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
type ContentScript = ExtensionManifest["content_scripts"][number];

const createContentScript =
  (contentScriptsDir: string) =>
    (s: string): ContentScripts[0] => {
      const scriptPath = path.join(contentScriptsDir, s);
      const matches = getUrlMatches(scriptPath);
      return { matches, js: [`./${scriptPath}`] };
    };

const isContentScripts = (obj: unknown): obj is ContentScripts => {
  return Array.isArray(obj) && obj.every(isContentScript);
};

const isContentScript = (obj: unknown): obj is ContentScript => {
  return obj !== null && Array.isArray((obj as ContentScript).matches);
};

const autoGenContentScripts = (
  contentScriptsDir: string
): Promise<ContentScripts | null> =>
  listFiles(contentScriptsDir).then((o) => {
    if (o.length < 1) {
      return null;
    }
    const result = o.map(createContentScript(contentScriptsDir));
    if (!isContentScripts(result)) {
      throw new TypeError("Malformed content scripts");
    }
    return result;
  });

export const run = async () => {
  if (!fs.existsSync(`${appRootPath}/package.json`)) {
    console.error("Please run from an npm project");
    console.error("No package.json found!!");
    process.exit(1);
  }
  const {
    name: pkgName,
    version: packageJsonVersion,
    description,
  } = require(`${appRootPath}/package.json`);

  // https://unpkg.com/
  // TODO handle content_security_policy
  const argv = require("yargs")
    .usage("Usage: $0 -s [injectScriptsDir] -p [permission]")
    .option("context", {
      alias: "c",
      describe: "root path used as for all other relative paths",
    })
    .option("scripts", {
      alias: "s",
      describe: "path to content scripts",
    })
    .option("devTools", {
      describe: "path to dev-tools html",
    })
    .option("template", {
      alias: "t",
      describe:
        "path to an existing manifest file which should be used for supplementary keys (will be overriden)",
    })
    .option("backgroundScripts", {
      type: "array",
      describe: "path to background file, multiple entries allowed",
    })
    .option("persistentBackground", {
      type: "boolean",
      default: true,
      describe:
        "Persistent background script? Necessary for things like background websocket connections",
    })
    .option("generatePermissions", {
      type: "boolean",
      default: false,
      describe:
        "Read source code to try to deduce the necessary permissions? (alpha)",
    })
    .option("locale", {
      describe: "path to background file, multiple entries allowed",
      default: "en",
    })
    .option("permissions", {
      alias: "p",
      type: "array",
      describe: "permissions to include in manifest",
      default: [],
    })
    .option("optionalPermissions", {
      type: "array",
      default: [],
      describe: "optional-permissions to include in manifest",
    }).argv;

  const permissionsBase = [];

  const version = await determineVersion(packageJsonVersion);

  const easilyOverridableDefaults = {
    permissions: permissionsBase,
    optional_permissions: [],
    version,
    description,
    browser_action: {
      default_title: pkgName,
    },
  };
  const manifestBase = (() => {
    try {
      const fileContents = fs.readFileSync(argv.template);
      return JSON.parse(fileContents.toString());
    } catch (e) {
      console.warn("Failed to parse a template manifest, using empty object!");
      return {};
    }
  })();
  let context = await pkgDir(process.cwd());
  const manifest: ExtensionManifest = Object.assign(
    {},
    easilyOverridableDefaults,
    manifestBase,
    {
      manifest_version: 2,
      default_locale: argv.locale,
      name: pkgName,
    }
  );
  if (argv.scripts) {
    const generatedContentScripts = await autoGenContentScripts(argv.scripts);
    if (generatedContentScripts !== null) {
      manifest.content_scripts = generatedContentScripts;
    }
  }

  if (argv.context) {
    context = path.resolve(import.meta.url, argv.context);
  }

  if (argv.devTools) {
    manifest.devtools_page = argv.devTools;
  }
  if (argv.backgroundScripts) {
    manifest.background = {
      scripts: argv.backgroundScripts,
      persistent: argv.persistentBackground,
    };
  }

  if (argv.generatePermissions) {
    let entrypoints = [];
    if (manifest.background && manifest.background.scripts) {
      entrypoints = manifest.background.scripts;
    }
    if (manifest.content_scripts) {
      entrypoints = [
        ...entrypoints,
        ...manifest.content_scripts.reduce((acc, el) => [...acc, ...el.js], []),
      ];
    }

    // entrypoints = entrypoints.map(e => path.join(directory, e))
    const discoveredPerms = await findPermissionsViaBundle(...entrypoints);
    manifest.permissions.push(...discoveredPerms);
  }

  argv.optionalPermissions.forEach((perm) => {
    manifest["optional_permissions"].push(perm);
  });

  argv.permissions.forEach((perm) => {
    manifest.permissions.push(perm);
  });
  manifest.permissions = manifest.permissions.filter(
    (x) => !manifest["optional_permissions"].includes(x)
  );

  manifest.permissions = Array.from(new Set(manifest.permissions));
  manifest.optional_permissions = Array.from(
    new Set(manifest.optional_permissions)
  );
  await write("./manifest.json", JSON.stringify(manifest, null, 4));
};

async function determineVersion(packageJsonVersion: any) {
  let version;
  if (process.env.CI && process.env.CI_COMMIT_NAME) {
    version = process.env.CI_COMMIT_NAME;
  } else if (
    typeof packageJsonVersion === "string" &&
    packageJsonVersion.length > 0
  ) {
    version = packageJsonVersion;
  } else {
    try {
      version = await getVersionFromGitTags();
    } catch {
      console.warn("No version provided, and unable to lookup in git tags");
    }
  }
  return version;
}
