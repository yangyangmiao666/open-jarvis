import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import githubDarkDefault from "shiki/themes/github-dark-default.mjs";
import githubLightDefault from "shiki/themes/github-light-default.mjs";

import langTypescript from "shiki/langs/typescript.mjs";
import langTsx from "shiki/langs/tsx.mjs";
import langJavascript from "shiki/langs/javascript.mjs";
import langJsx from "shiki/langs/jsx.mjs";
import langPython from "shiki/langs/python.mjs";
import langJson from "shiki/langs/json.mjs";
import langCss from "shiki/langs/css.mjs";
import langHtml from "shiki/langs/html.mjs";
import langMarkdown from "shiki/langs/markdown.mjs";
import langYaml from "shiki/langs/yaml.mjs";
import langBash from "shiki/langs/bash.mjs";
import langSql from "shiki/langs/sql.mjs";
import langVue from "shiki/langs/vue.mjs";
import langRust from "shiki/langs/rust.mjs";
import langGo from "shiki/langs/go.mjs";
import langToml from "shiki/langs/toml.mjs";
import langXml from "shiki/langs/xml.mjs";
import langLog from "shiki/langs/log.mjs";
import langC from "shiki/langs/c.mjs";
import langCpp from "shiki/langs/cpp.mjs";
import langCsharp from "shiki/langs/csharp.mjs";
import langJava from "shiki/langs/java.mjs";
import langKotlin from "shiki/langs/kotlin.mjs";
import langSwift from "shiki/langs/swift.mjs";
import langRuby from "shiki/langs/ruby.mjs";
import langPhp from "shiki/langs/php.mjs";
import langMatlab from "shiki/langs/matlab.mjs";
import langDocker from "shiki/langs/docker.mjs";
import langMakefile from "shiki/langs/makefile.mjs";
import langIni from "shiki/langs/ini.mjs";
import langPowershell from "shiki/langs/powershell.mjs";
import langBat from "shiki/langs/bat.mjs";
import langR from "shiki/langs/r.mjs";
import langScala from "shiki/langs/scala.mjs";
import langLua from "shiki/langs/lua.mjs";
import langGraphql from "shiki/langs/graphql.mjs";
import langSvelte from "shiki/langs/svelte.mjs";
import langAstro from "shiki/langs/astro.mjs";
import langDiff from "shiki/langs/diff.mjs";
import langCmake from "shiki/langs/cmake.mjs";

/** Fallback when extension is unknown — neutral tokenization vs. markdown */
export const SHIKI_FALLBACK_LANG = "log";

const LOADED_LANG_IDS = new Set([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "json",
  "css",
  "html",
  "markdown",
  "yaml",
  "bash",
  "sql",
  "vue",
  "rust",
  "go",
  "toml",
  "xml",
  "log",
  "c",
  "cpp",
  "csharp",
  "java",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "matlab",
  "docker",
  "makefile",
  "ini",
  "powershell",
  "bat",
  "r",
  "scala",
  "lua",
  "graphql",
  "svelte",
  "astro",
  "diff",
  "cmake",
]);

let highlighterPromise: Promise<HighlighterCore> | null = null;

export async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDarkDefault, githubLightDefault],
      langs: [
        langTypescript,
        langTsx,
        langJavascript,
        langJsx,
        langPython,
        langJson,
        langCss,
        langHtml,
        langMarkdown,
        langYaml,
        langBash,
        langSql,
        langVue,
        langRust,
        langGo,
        langToml,
        langXml,
        langLog,
        langC,
        langCpp,
        langCsharp,
        langJava,
        langKotlin,
        langSwift,
        langRuby,
        langPhp,
        langMatlab,
        langDocker,
        langMakefile,
        langIni,
        langPowershell,
        langBat,
        langR,
        langScala,
        langLua,
        langGraphql,
        langSvelte,
        langAstro,
        langDiff,
        langCmake,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  pyw: "python",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  vue: "vue",
  rs: "rust",
  go: "go",
  toml: "toml",
  xml: "xml",
  plist: "xml",
  svg: "xml",
  log: "log",
  txt: "log",
  c: "c",
  h: "c",
  i: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  inl: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  php: "php",
  phtml: "php",
  m: "matlab",
  mlx: "matlab",
  dockerfile: "docker",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "bat",
  cmd: "bat",
  r: "r",
  scala: "scala",
  sc: "scala",
  lua: "lua",
  graphql: "graphql",
  gql: "graphql",
  svelte: "svelte",
  astro: "astro",
  diff: "diff",
  patch: "diff",
  cmake: "cmake",
};

function langOrFallback(id: string): string {
  return LOADED_LANG_IDS.has(id) ? id : SHIKI_FALLBACK_LANG;
}

/**
 * Shiki language id for highlighting (only bundled langs).
 */
export function getLanguageFromFilePath(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const base = fileName.toLowerCase();

  if (base === "dockerfile" || base.endsWith(".dockerfile")) {
    return langOrFallback("docker");
  }
  if (
    base === "makefile" ||
    base === "gnumakefile" ||
    /^makefile\./.test(base)
  ) {
    return langOrFallback("makefile");
  }
  if (base === "cmakelists.txt") {
    return langOrFallback("cmake");
  }

  const ext = fileName.includes(".")
    ? fileName.split(".").pop()?.toLowerCase()
    : undefined;
  if (!ext) return SHIKI_FALLBACK_LANG;

  const mapped = EXT_TO_LANG[ext];
  if (mapped) return langOrFallback(mapped);

  return SHIKI_FALLBACK_LANG;
}
