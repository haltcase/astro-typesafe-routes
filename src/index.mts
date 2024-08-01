import * as fs from "node:fs/promises";
import * as path from "path";
import * as prettier from "prettier";
import chokidar from "chokidar";

export async function listFiles(dir: string) {
  let results: string[] = [];

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subdirFiles = await listFiles(fullPath);
      results = results.concat(
        subdirFiles.map((file) => path.join(entry.name, file)),
      );
    } else {
      results.push(entry.name);
    }
  }

  return results;
}

export function filterValidAstroFiles(paths: string[]) {
  return paths.filter((p) => p.match(/\.(astro|md|mdx|html)$/));
}

export function trimFileExtensions(paths: string[]) {
  return paths.map((path) => path.replace(/\.([^.]+)$/, ""));
}

export function trimIndex(paths: string[]) {
  return paths.map((path) => path.replace(/index$/, ""));
}

export function trimTrailingSlash(paths: string[]) {
  return paths.map((path) => path.replace(/\/$/, ""));
}

export function addLeadingSlash(paths: string[]) {
  return paths.map((path) => (path.startsWith("/") ? path : "/" + path));
}

export type DynamicRoute = { path: string; params: string[] | null };

export function getDynamicRouteInfo(paths: string[]): DynamicRoute[] {
  return paths.map((path) => {
    const paramSegments = (path.match(/(\[[^\]]+\])/g) || []).map((segment) =>
      segment.replace(/\[|\]/g, ""),
    );
    return {
      path,
      params: paramSegments.length === 0 ? null : paramSegments,
    };
  });
}

export type GetRouteFileContentOpts = {
  trailingSlash: boolean;
  functionName: string;
};

export async function getRouteFileContent(routes: DynamicRoute[]) {
  const routeEntries = routes.map((route) => [
    route.path,
    { params: route.params },
  ]);
  const routesObject = Object.fromEntries(routeEntries);

  return `
  declare module "astro-typesafe-routes" {
    export type Routes = ${JSON.stringify(routesObject)};
  
    type Route = keyof Routes;
  
    type ParamsRecord<T extends Route> =
      Routes[T]["params"] extends Array<string>
        ? { [key in Routes[T]["params"][number]]: string }
        : null;
  
    type Options = {
      search?: ConstructorParameters<typeof URLSearchParams>[0];
      hash?: string;
      trailingSlash?: boolean;
    };

    type PathParameters<T extends Route> = Routes[T]["params"] extends null
      ? [pathName: T, options?: Options]
      : [
          pathName: T,
          options: Options & {
            params: ParamsRecord<T>;
          },
        ];

    export function $path<T extends Route>(...args: PathParameters<T>): string;
  }`;
}

export async function writeRouteFile(path: string, content: string) {
  await fs.writeFile(path, content, { encoding: "utf-8" });
}

export async function formatPrettier(content: string) {
  return await prettier.format(content, {
    parser: "typescript",
    plugins: [],
  });
}

export function logSuccess(path: string) {
  console.log(`✅ TypeSafe Astro route successfully created at ${path}`);
}

export async function getRoutes(pagesPath: string) {
  const files = await listFiles(pagesPath);
  const astroFiles = filterValidAstroFiles(files);
  const withoutExtension = trimFileExtensions(astroFiles);
  const withoutIndex = trimIndex(withoutExtension);
  const withoutTrailingSlash = trimTrailingSlash(withoutIndex);
  const withLeading = addLeadingSlash(withoutTrailingSlash);
  return getDynamicRouteInfo(withLeading);
}

export type RunCodeGenOptions = {
  pagesPath: string;
  outPath: string;
};

export async function runCodeGen(options: RunCodeGenOptions) {
  const routes = await getRoutes(options.pagesPath);

  const fileContent = await getRouteFileContent(routes);
  const formattedContent = await formatPrettier(fileContent);
  await writeRouteFile(options.outPath, formattedContent);

  logSuccess(options.outPath);

  return routes;
}

export function watch(path: string, callback: () => Promise<void>) {
  let watchPath = path;
  if (!watchPath.endsWith("/")) {
    watchPath += "/";
  }
  watchPath += "**/*.{astro,md,mdx,html}";

  const watcher = chokidar.watch(watchPath, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("add", callback);
  watcher.on("unlink", callback);
}

type PathParameters = [
  pathName: string,
  options?: {
    params?: Record<string, string>;
    trailingSlash?: boolean;
    search?: ConstructorParameters<typeof URLSearchParams>[0];
    hash?: string;
  },
];

export function $path(...args: PathParameters) {
  const [pathName, options] = args;
  const trailingSlash = options?.trailingSlash ?? false;

  let url: string = pathName;

  if (trailingSlash) {
    url += "/";
  }

  if (options?.params !== undefined) {
    for (const [paramKey, paramValue] of Object.entries<string>(
      options.params,
    )) {
      url = url.replace(`[${paramKey}]`, paramValue);
    }
  }

  const search = new URLSearchParams(options?.search);
  if (search.size > 0) {
    url += `?${search.toString()}`;
  }

  if (options?.hash !== undefined) {
    url += `#${options.hash}`;
  }

  return url;
}