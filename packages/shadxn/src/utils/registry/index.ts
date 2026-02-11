import path from "path";
import { Config } from "@/utils/get-config";
import {
  registryBaseColorSchema,
  registryIndexSchema,
  registryItemSchema,
  registryItemWithContentSchema,
  registryWithContentSchema,
  stylesSchema,
} from "@/utils/registry/schema";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import { z } from "zod";

let baseUrl = process.env.COMPONENTS_REGISTRY_URL ?? "https://ui.shadcn.com";
const agent = process.env.https_proxy
  ? new HttpsProxyAgent(process.env.https_proxy)
  : undefined;

export function setBaseUrl(newBaseUrl: string) {
  baseUrl = newBaseUrl;
}

export function getBaseUrl() {
  return baseUrl;
}
export function isUrl(path: string) {
  try {
    new URL(path)
    return true
  } catch (error) {
    return false
  }
}

export function getRegistryUrl(path: string) {
  if (isUrl(path)) {
    // If the url contains /chat/b/, we assume it's the v0 registry.
    // We need to add the /json suffix if it's missing.
    const url = new URL(path)
    if (url.pathname.match(/\/chat\/b\//) && !url.pathname.endsWith("/json")) {
      url.pathname = `${url.pathname}/json`
    }

    return url.toString()
  }
  return path
}

export async function getRegistryIndex() {
  try {
    const [result] = await fetchRegistry(["index.json"]);
    return registryIndexSchema.parse(result);
  } catch (error) {
    throw new Error(`Failed to fetch components from registry.`);
  }
}

export async function getRegistryStyles() {
  try {
    const [result] = await fetchRegistry(["styles/index.json"]);

    return stylesSchema.parse(result);
  } catch (error) {
    throw new Error(`Failed to fetch styles from registry.`);
  }
}

export async function getRegistryBaseColors() {
  return [
    {
      name: "slate",
      label: "Slate",
    },
    {
      name: "gray",
      label: "Gray",
    },
    {
      name: "zinc",
      label: "Zinc",
    },
    {
      name: "neutral",
      label: "Neutral",
    },
    {
      name: "stone",
      label: "Stone",
    },
  ];
}

export async function getRegistryBaseColor(baseColor: string) {
  try {
    const [result] = await fetchRegistry([`colors/${baseColor}.json`]);

    return registryBaseColorSchema.parse(result);
  } catch (error) {
    throw new Error(`Failed to fetch base color from registry.`);
  }
}

export async function resolveTree(
  index: z.infer<typeof registryIndexSchema>,
  names: string[]
) {
  const tree: z.infer<typeof registryIndexSchema> = [];

  for (const name of names) {
    const entry = index.find((entry) => entry.name === name);

    if (!entry) {
      continue;
    }

    tree.push(entry);

    if (entry.registryDependencies) {
      const dependencies = await resolveTree(index, entry.registryDependencies);
      tree.push(...dependencies);
    }
  }

  return tree.filter(
    (component, index, self) =>
      self.findIndex((c) => c.name === component.name) === index
  );
}

export async function fetchTree(
  style: string,
  tree: z.infer<typeof registryIndexSchema>,
  url: string = baseUrl
) {
  try {
    const paths = tree.map((item) => `styles/${style}/${item.name}.json`);
    const result = await fetchRegistry(paths);

    return registryWithContentSchema.parse(result);
  } catch (error) {
    throw new Error(`Failed to fetch tree from registry.`);
  }
}
// For now, we fetch only one schema
export async function fetchSchema(
  url: string
) {
  url = getRegistryUrl(url);

  try {
    const response = await fetch(url, {
      agent,
    });
    
    let result: any = await response.json();
    // dirty backward compatibility fix
    result.type = result.type.replace("registry:", "components:");
    result.registryDependencies = result.files.flatMap((file: any) => {
      // Extract all component names from the imports
      const matches = file.content.matchAll(/from "@\/components\/ui\/([a-zA-Z_\-0-9]*)"/g);
      const components = Array.from(matches, (match: any) => match[1]);
      return components;
    });
    result.files = result.files.map((file: any) => {
      return {
        ...file,
        name: file.name || file.path.split("/").pop().split(".").shift(),
        dependencies: result.dependencies || [],
        devDependencies: result.devDependencies || [],
        path: file.path.split("/").pop(),
      };
    });


    return registryWithContentSchema.parse([result]);

  } catch (error) {
    console.error(error);
    process.exit(1);
    throw new Error(`Failed to fetch schema from ${url}.`);
  }
}

export async function getItemTargetPath(
  config: Config,
  item: Pick<z.infer<typeof registryItemWithContentSchema>, "type">,
  override?: string
) {
  if (override) {
    return override;
  }

  if (item.type === "components:ui" && config.aliases.ui) {
    return config.resolvedPaths.ui;
  }
  const [parent, type] = item.type.split(":");
  if (!(parent in config.resolvedPaths)) {
    return null;
  }

  return path.join(
    config.resolvedPaths[parent as keyof typeof config.resolvedPaths],
    type
  );
}

async function fetchRegistry(paths: string[]) {
  try {
    const results = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`${baseUrl}/registry/${path}`, {
          agent,
        });
        return await response.json();
      })
    );

    return results;
  } catch (error) {
    throw new Error(`Failed to fetch registry from ${baseUrl}.`);
  }
}
