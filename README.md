# Welcome to web-ext-manifest-gen 👋

[![No Maintenance Intended](http://unmaintained.tech/badge.svg)](http://unmaintained.tech/)
[![Version](https://img.shields.io/npm/v/web-ext-manifest-gen.svg)](https://www.npmjs.com/package/web-ext-manifest-gen)

## How to use it

### autogenerate permissions

The flag `--generatePermissions` will attempt some serious hackyness in order to determine the required permissions for your extension. To accomplish this it will 1) try to bundle your code based on provided entrypoints, 2) feed that bundle to `semgrep`, in order to identify the APIs your extension (and it's dependencies) use.

# Local Development

## Install

```sh
npm install
```

## Run tests

```sh
npm run test
```

## Show your support

Give a ⭐️ if this project helped you!

---

This README was generated with ❤️ by readme-md-generator
