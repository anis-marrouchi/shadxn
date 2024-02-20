// @ts-nocheck
import { Command } from "commander";
import { logger } from "@/src/utils/logger";
import * as fsx from "fs-extra";
import * as fs from "fs";
import path from "path";
import template from "lodash.template";
import { rimraf } from "rimraf";
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { handleError } from "@/src/utils/handle-error";
import { z } from "zod";
import prompts from "prompts";
import { handleError } from "@/src/utils/handle-error";
import { registrySchema, types } from "@/src/utils/registry/schema";
import { pathToFileURL } from 'url';
// Convert a file system path to a file URL
const toFileUrl = (filePath) => pathToFileURL(filePath).href;
const currentFileUrl = new URL(import.meta.url);
const __dirname = path.dirname(currentFileUrl.pathname);

// Main registry command
const registry = new Command("registry").description(
  "Manage the project registry."
);

// Subcommand for initialization
registry
  .command("init")
  .description("Initialize the registry for a project.")
  .argument(
    "[project]",
    "The project to initialize (default: default)",
    "default"
  )
  .option("-r, --registry <registry>", "the registry to use. We have blank, shadcn and aceternity. (default: blank)", "shadcn")
  .action(async (project, opts) => {
    try {
      await init(project, opts); // Assuming init accepts a project argument
    } catch (error) {
      logger.error(`Error initializing registry: ${error.message}`);
    }
  });

// Subcommand for building
registry
  .command("build")
  .description("Build the registry for a project.")
  .argument("[project]", "The project to build (default: default)", "default")
  .action(async (project) => {
    try {
      await build(project);
    } catch (error) {
      logger.error(`Error building registry: ${error.message}`);
    }
  });

registry
  .command("add")
  .description("Activate a registry by adding its URL to your project.")
  .argument("<registryName>", "Name of the registry to add")
  .action(async (registryName) => {
    const cwd = process.cwd();
    const componentsPath = path.join(cwd, "components.json");

    // Check if components.json exists
    if (!existsSync(componentsPath)) {
      logger.warn(
        `components.json does not exist. Have you run the init command?`
      );
      return;
    }

    // Prompt for the registry URL
    const answers = await prompts([
      {
        type: "text",
        name: "url",
        message: `Enter the URL for the ${registryName} registry:`,
        validate: (input) => isValidUrl(input) || "Please enter a valid URL.",
      },
    ]);

    // Read the existing components.json
    let components = JSON.parse(readFileSync(componentsPath, "utf8"));

    // Ensure the registries array exists
    components.registries = components.registries || [];

    // Check if the registry already exists
    const registryIndex = components.registries.findIndex(
      (registry) => registry.name === registryName
    );

    if (registryIndex > -1) {
      // Update existing registry
      components.registries[registryIndex].baseUrl = answers.url;
      logger.info(`Updated ${registryName} registry URL to ${answers.url}`);
    } else {
      // Add new registry
      components.registries.push({ name: registryName, baseUrl: answers.url });
      logger.info(`Added ${registryName} registry with URL ${answers.url}`);
    }

    // Write the updated components.json back to disk
    writeFileSync(componentsPath, JSON.stringify(components, null, 2), "utf8");
  });

function isValidUrl(url) {
  const urlRule = z.string().url();
  const result = urlRule.safeParse(url);
  return result.success;
}

async function init(project, opts) {
  switch (project) {
    case "default":
      await initDefault(opts);
      break;
    default:
      logger.warn("Unsupported project type.");
  }
}

async function initDefault(opts) {
  try {
    logger.info("Initializing registry...");
    const { registry: registryName } = opts;
    let source = path.join(__dirname, "..", "src", "registries", registryName);
    source = decodeURIComponent(source);
    // Remove the leading backslash if present for Windows Users
    source = source.startsWith('\\') ? source.substring(1) : source;
    const destination = path.join(process.cwd(), "src", "registry");

    // Ensure the destination directory exists
    await fsx.ensureDir(destination);

    // Copy contents from source to destination
    await fsx.copy(source, destination, {
      overwrite: false,
      errorOnExist: false, // Don't throw error if destination exists
    });

    console.log("✅ Registry initialized");
  } catch (err) {
    handleError(err);
  }
}

async function build(project) {
  switch (project) {
    case "default":
      await buildDefault();
      break;
    default:
      logger.warn("Unsupported project type.");
  }
}

async function buildDefault() {
  try {
  logger.info("Building registry for Next.js project...");
  const REGISTRY_PATH = path.join(process.cwd(), "public/registry");
  const {registry: buildRegister} = await import(toFileUrl(path.join(process.cwd(), "src/registry/registry.mjs")));
  const {styles} = await import(toFileUrl(path.join(process.cwd(), "src/registry/styles.mjs")));
  const {colorMapping, colors} = await import(toFileUrl(path.join(process.cwd(), "src/registry/colors.mjs")));;
  const {themes} = await import(toFileUrl(path.join(process.cwd(), "src/registry/themes.mjs")));

  const result = registrySchema.safeParse(buildRegister);
  if (!result.success) {
    console.error(result.error);
    process.exit(1);
  }

  // ----------------------------------------------------------------------------
  // Build registry/styles/[style]/[name].json.
  // ----------------------------------------------------------------------------
  for (const style of styles) {
    const targetPath = path.join(REGISTRY_PATH, "styles", style.name);

    // Create directory if it doesn't exist.
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    for (const item of result.data) {
      const files = item.files?.map((file) => {
        // Construct the file path relative to the project structure
        // Adjust the path as necessary based on your project's directory structure
        const filePath = path.join(process.cwd(), "src", "registry", style.name, item.type.replace('components:', ''), file);
        // Read the file content
        const content = fs.readFileSync(filePath, "utf8");

        return {
          name: path.basename(file), // file name with extension
          path: file, // preserving the relative path structure
          content,
        };
      });
      
      const payload = {
        ...item,
        files,
      };

      // Determine the target path for each style. Sorry I'm in a rush, I can't finish this.
      const targetPath = path.join(REGISTRY_PATH, "styles", style.name, `${item.name}.json`);
      // Ensure the directory exists
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      // Write the payload to the target file
      fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
    }
  }

  // ----------------------------------------------------------------------------
  // Build registry/styles/index.json.
  // ----------------------------------------------------------------------------
  const stylesJson = JSON.stringify(styles, null, 2);
  fs.writeFileSync(
    path.join(REGISTRY_PATH, "styles/index.json"),
    stylesJson,
    "utf8"
  );

  // ----------------------------------------------------------------------------
  // Build registry/index.json.
  // ----------------------------------------------------------------------------
  const names = result.data
  .filter((item) => types.includes(item.type));
  const registryJson = JSON.stringify(names, null, 2);
  rimraf.sync(path.join(REGISTRY_PATH, "index.json"));
  fs.writeFileSync(
    path.join(REGISTRY_PATH, "index.json"),
    registryJson,
    "utf8"
  );

  // ----------------------------------------------------------------------------
  // Build registry/colors/index.json.
  // ----------------------------------------------------------------------------
  const colorsTargetPath = path.join(REGISTRY_PATH, "colors");
  rimraf.sync(colorsTargetPath);
  if (!fs.existsSync(colorsTargetPath)) {
    fs.mkdirSync(colorsTargetPath, { recursive: true });
  }

  const colorsData: Record<string, any> = {};
  for (const [color, value] of Object.entries(colors)) {
    if (typeof value === "string") {
      colorsData[color] = value;
      continue;
    }

    if (Array.isArray(value)) {
      colorsData[color] = value.map((item) => ({
        ...item,
        rgbChannel: item.rgb.replace(/^rgb\((\d+),(\d+),(\d+)\)$/, "$1 $2 $3"),
        hslChannel: item.hsl.replace(
          /^hsl\(([\d.]+),([\d.]+%),([\d.]+%)\)$/,
          "$1 $2 $3"
        ),
      }));
      continue;
    }

    if (typeof value === "object") {
      colorsData[color] = {
        ...value,
        rgbChannel: value.rgb.replace(/^rgb\((\d+),(\d+),(\d+)\)$/, "$1 $2 $3"),
        hslChannel: value.hsl.replace(
          /^hsl\(([\d.]+),([\d.]+%),([\d.]+%)\)$/,
          "$1 $2 $3"
        ),
      };
      continue;
    }
  }

  fs.writeFileSync(
    path.join(colorsTargetPath, "index.json"),
    JSON.stringify(colorsData, null, 2),
    "utf8"
  );

  // ----------------------------------------------------------------------------
  // Build registry/colors/[base].json.
  // ----------------------------------------------------------------------------
  const BASE_STYLES = `@tailwind base;
  @tailwind components;
  @tailwind utilities;
  `;

  const BASE_STYLES_WITH_VARIABLES = `@tailwind base;
  @tailwind components;
  @tailwind utilities;
   
  @layer base {
    :root {
      --background: <%- colors.light["background"] %>;
      --foreground: <%- colors.light["foreground"] %>;
  
      --card: <%- colors.light["card"] %>;
      --card-foreground: <%- colors.light["card-foreground"] %>;
   
      --popover: <%- colors.light["popover"] %>;
      --popover-foreground: <%- colors.light["popover-foreground"] %>;
   
      --primary: <%- colors.light["primary"] %>;
      --primary-foreground: <%- colors.light["primary-foreground"] %>;
   
      --secondary: <%- colors.light["secondary"] %>;
      --secondary-foreground: <%- colors.light["secondary-foreground"] %>;
   
      --muted: <%- colors.light["muted"] %>;
      --muted-foreground: <%- colors.light["muted-foreground"] %>;
   
      --accent: <%- colors.light["accent"] %>;
      --accent-foreground: <%- colors.light["accent-foreground"] %>;
   
      --destructive: <%- colors.light["destructive"] %>;
      --destructive-foreground: <%- colors.light["destructive-foreground"] %>;
  
      --border: <%- colors.light["border"] %>;
      --input: <%- colors.light["input"] %>;
      --ring: <%- colors.light["ring"] %>;
   
      --radius: 0.5rem;
    }
   
    .dark {
      --background: <%- colors.dark["background"] %>;
      --foreground: <%- colors.dark["foreground"] %>;
   
      --card: <%- colors.dark["card"] %>;
      --card-foreground: <%- colors.dark["card-foreground"] %>;
   
      --popover: <%- colors.dark["popover"] %>;
      --popover-foreground: <%- colors.dark["popover-foreground"] %>;
   
      --primary: <%- colors.dark["primary"] %>;
      --primary-foreground: <%- colors.dark["primary-foreground"] %>;
   
      --secondary: <%- colors.dark["secondary"] %>;
      --secondary-foreground: <%- colors.dark["secondary-foreground"] %>;
   
      --muted: <%- colors.dark["muted"] %>;
      --muted-foreground: <%- colors.dark["muted-foreground"] %>;
   
      --accent: <%- colors.dark["accent"] %>;
      --accent-foreground: <%- colors.dark["accent-foreground"] %>;
   
      --destructive: <%- colors.dark["destructive"] %>;
      --destructive-foreground: <%- colors.dark["destructive-foreground"] %>;
   
      --border: <%- colors.dark["border"] %>;
      --input: <%- colors.dark["input"] %>;
      --ring: <%- colors.dark["ring"] %>;
    }
  }
   
  @layer base {
    * {
      @apply border-border;
    }
    body {
      @apply bg-background text-foreground;
    }
  }`;

  for (const baseColor of ["slate", "gray", "zinc", "neutral", "stone"]) {
    const base: Record<string, any> = {
      inlineColors: {},
      cssVars: {},
    };
    for (const [mode, values] of Object.entries(colorMapping)) {
      base["inlineColors"][mode] = {};
      base["cssVars"][mode] = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string") {
          const resolvedColor = value.replace(/{{base}}-/g, `${baseColor}-`);
          base["inlineColors"][mode][key] = resolvedColor;

          const [resolvedBase, scale] = resolvedColor.split("-");
          const color = scale
            ? colorsData[resolvedBase].find(
                (item: { scale: number }) => item.scale === parseInt(scale)
              )
            : colorsData[resolvedBase];
          if (color) {
            base["cssVars"][mode][key] = color.hslChannel;
          }
        }
      }
    }

    // Build css vars.
    base["inlineColorsTemplate"] = template(BASE_STYLES)({});
    base["cssVarsTemplate"] = template(BASE_STYLES_WITH_VARIABLES)({
      colors: base["cssVars"],
    });

    fs.writeFileSync(
      path.join(REGISTRY_PATH, `colors/${baseColor}.json`),
      JSON.stringify(base, null, 2),
      "utf8"
    );
  }

  // ----------------------------------------------------------------------------
  // Build registry/themes.css
  // ----------------------------------------------------------------------------
  const THEME_STYLES_WITH_VARIABLES = `
    .theme-<%- theme %> {
      --background: <%- colors.light["background"] %>;
      --foreground: <%- colors.light["foreground"] %>;
   
      --muted: <%- colors.light["muted"] %>;
      --muted-foreground: <%- colors.light["muted-foreground"] %>;
   
      --popover: <%- colors.light["popover"] %>;
      --popover-foreground: <%- colors.light["popover-foreground"] %>;
   
      --card: <%- colors.light["card"] %>;
      --card-foreground: <%- colors.light["card-foreground"] %>;
   
      --border: <%- colors.light["border"] %>;
      --input: <%- colors.light["input"] %>;
   
      --primary: <%- colors.light["primary"] %>;
      --primary-foreground: <%- colors.light["primary-foreground"] %>;
   
      --secondary: <%- colors.light["secondary"] %>;
      --secondary-foreground: <%- colors.light["secondary-foreground"] %>;
   
      --accent: <%- colors.light["accent"] %>;
      --accent-foreground: <%- colors.light["accent-foreground"] %>;
   
      --destructive: <%- colors.light["destructive"] %>;
      --destructive-foreground: <%- colors.light["destructive-foreground"] %>;
   
      --ring: <%- colors.light["ring"] %>;
   
      --radius: <%- colors.light["radius"] %>;
    }
   
    .dark .theme-<%- theme %> {
      --background: <%- colors.dark["background"] %>;
      --foreground: <%- colors.dark["foreground"] %>;
   
      --muted: <%- colors.dark["muted"] %>;
      --muted-foreground: <%- colors.dark["muted-foreground"] %>;
   
      --popover: <%- colors.dark["popover"] %>;
      --popover-foreground: <%- colors.dark["popover-foreground"] %>;
   
      --card: <%- colors.dark["card"] %>;
      --card-foreground: <%- colors.dark["card-foreground"] %>;
   
      --border: <%- colors.dark["border"] %>;
      --input: <%- colors.dark["input"] %>;
   
      --primary: <%- colors.dark["primary"] %>;
      --primary-foreground: <%- colors.dark["primary-foreground"] %>;
   
      --secondary: <%- colors.dark["secondary"] %>;
      --secondary-foreground: <%- colors.dark["secondary-foreground"] %>;
   
      --accent: <%- colors.dark["accent"] %>;
      --accent-foreground: <%- colors.dark["accent-foreground"] %>;
   
      --destructive: <%- colors.dark["destructive"] %>;
      --destructive-foreground: <%- colors.dark["destructive-foreground"] %>;
   
      --ring: <%- colors.dark["ring"] %>;
    }`;

  const themeCSS = [];
  for (const theme of themes) {
    themeCSS.push(
      template(THEME_STYLES_WITH_VARIABLES)({
        colors: theme.cssVars,
        theme: theme.name,
      })
    );
  }

  fs.writeFileSync(
    path.join(REGISTRY_PATH, `themes.css`),
    themeCSS.join("\n"),
    "utf8"
  );

  // ----------------------------------------------------------------------------
  // Build registry/themes/[theme].json
  // ----------------------------------------------------------------------------
  rimraf.sync(path.join(REGISTRY_PATH, "themes"));
  for (const baseColor of ["slate", "gray", "zinc", "neutral", "stone"]) {
    const payload: {
      name: string;
      label: string;
      cssVars: {
        [x: string]: {};
      };
    } = {
      name: baseColor,
      label: baseColor.charAt(0).toUpperCase() + baseColor.slice(1),
      cssVars: {},
    };

    for (const [mode, values] of Object.entries(colorMapping)) {
      payload["cssVars"][mode] = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string") {
          const resolvedColor = value.replace(/{{base}}-/g, `${baseColor}-`);
          payload["cssVars"][mode][key] = resolvedColor;

          const [resolvedBase, scale] = resolvedColor.split("-");
          const color = scale
            ? colorsData[resolvedBase].find(
                (item) => item.scale === parseInt(scale)
              )
            : colorsData[resolvedBase];
          if (color) {
            payload["cssVars"][mode][key] = color.hslChannel;
          }
        }
      }
    }

    const targetPath = path.join(REGISTRY_PATH, "themes");

    // Create directory if it doesn't exist.
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    fs.writeFileSync(
      path.join(targetPath, `${payload.name}.json`),
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  }

  console.log("✅ Done!");
} catch (error) {
    handleError(error);
  }
}

export { registry };
