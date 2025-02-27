import { existsSync, promises as fs } from "fs";
import path from "path";
import { getConfig } from "@/src/utils/get-config";
import { getPackageManager } from "@/src/utils/get-package-manager";
import { handleError } from "@/src/utils/handle-error";
import { logger } from "@/src/utils/logger";
import {
  fetchTree,
  getItemTargetPath,
  getRegistryBaseColor,
  getRegistryIndex,
  resolveTree,
  setBaseUrl,
  getBaseUrl,
  isUrl,
  fetchSchema,
} from "@/src/utils/registry";
import { transform } from "@/src/utils/transformers";
import chalk from "chalk";
import { Command } from "commander";
import { execa } from "execa";
import ora from "ora";
import prompts from "prompts";
import { z } from "zod";

const addOptionsSchema = z.object({
  components: z.array(z.string()).optional(),
  yes: z.boolean(),
  overwrite: z.boolean(),
  cwd: z.string(),
  all: z.boolean(),
  path: z.string().optional(),
});

export const add = new Command()
  .name("add")
  .description("add a component to your project")
  .argument("[components...]", "the components to add")
  .option("-y, --yes", "skip confirmation prompt.", true)
  .option("-o, --overwrite", "overwrite existing files.", false)
  .option("-r, --registry <registry>", "the registry to use.", "shadcn")
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd()
  )
  .option("-a, --all", "add all available components", false)
  .option("-p, --path <path>", "the path to add the component to.")
  .option("-t, --type <type>", "the type of component to add. (ui, component, example). (default: ui)", "ui")
  .action(async (components, opts) => {
    const {registry: registryName, type} = opts;
    try {
      if (type === 'page' && !opts.path) {
        const response = await prompts({
            type: 'text',
            name: 'path',
            initial: 'src/app',
            message: 'Enter the path where the page component should be added:',
            validate: value => value.trim() === '' ? `Path can't be empty.` : true
        });
    
        if (response.path) {
            opts.path = response.path; // Update the opts with the provided path
        } else {
            logger.error('Path is required for page components. Exiting.');
            process.exit(1);
        }
    }
      const options = addOptionsSchema.parse({
        components,
        ...opts,
      });

      const cwd = path.resolve(options.cwd);

      if (!existsSync(cwd)) {
        logger.error(`The path ${cwd} does not exist. Please try again.`);
        process.exit(1);
      }

      const config = await getConfig(cwd);
      if (!config) {
        logger.warn(
          `Configuration is missing. Please run ${chalk.green(
            `init`
          )} to create a components.json file.`
        );
        process.exit(1);
      }

      // check if any  registries are defined. If so we let the user select which registry to use to set the base url. If not we use the default url
      if (config.registries?.length && config.registries.length > 1) {
        // check if a registryName is defined. If so we set the base url to the selected registry from the config file. In case the registryName is not defined we let the user select the registry to use
        if (registryName) {
          const registry = config.registries.find(
            (registry) => registry.name === registryName
          );
          if (!registry) {
            logger.error(
              `The registry ${registryName} does not exist. Please try again.`
            );
            process.exit(1);
          }
          setBaseUrl(registry.baseUrl);
        } else {
          const { registry } = await prompts({
            type: "select",
            name: "registry",
            message: "Select a registry",
            choices: config.registries.map((registry) => ({
              title: registry.name,
              value: registry.baseUrl,
            })),
          });
          if (!registry) {
            logger.error(`No registry selected. Exiting.`);
            process.exit(1);
          }
          setBaseUrl(registry);
        }
      }
      
      const registryIndex = await getRegistryIndex();
      let selectedComponents = options.all
        ? registryIndex.map((entry) => entry.name)
        : options.components;
      if (!options.components?.length && !options.all) {
        const { components } = await prompts({
          type: "multiselect",
          name: "components",
          message: "Which components would you like to add?",
          hint: "Space to select. A to toggle all. Enter to submit.",
          instructions: false,
          choices: registryIndex
          .filter((entry) => entry.type === `components:${type}`)
          .map((entry) => ({
            title: entry.name,
            value: entry.name,
            selected: options.all
              ? true
              : options.components?.includes(entry.name),
          })),
        });
        selectedComponents = components;
      }

      if (!selectedComponents?.length) {
        logger.warn("No components selected. Exiting.");
        process.exit(0);
      }
      let registryDependencies: any[] = [];
      // We add every component registryDependencies to the registryDependencies array
      const addRegistryDependencies = async (dependencies: string[]) => {
        let registryDependencyName: string[] = []
        for (const dependency of dependencies) {
          // the dependency name needs to be parsed: example: components/ui/form => form
          const dependencyName = dependency.split('/').pop();
          if (dependencyName && !selectedComponents.includes(dependencyName)) {
            // We don't want to add the same dependency multiple times
            if (!registryDependencyName.includes(dependencyName)) {
              registryDependencyName.push(dependencyName);
            }
          }
          const tree = await resolveTree(registryIndex, registryDependencyName);
          registryDependencies = await fetchTree(config.style, tree);
        }
      };
      for (const component of registryIndex) {
        if (selectedComponents.includes(component.name)) {
          if (component.registryDependencies) {
            await addRegistryDependencies(component.registryDependencies);
          }
        }
      }

      const tree = await resolveTree(registryIndex, selectedComponents);
      let payload: any = await fetchTree(config.style, tree);
      const baseColor = await getRegistryBaseColor(config.tailwind.baseColor);

      
        // Maybe its a schema url
        if (isUrl(selectedComponents[0])) {
          payload = await fetchSchema(selectedComponents[0]);
          for (const component of payload) {
              if (component.registryDependencies) {
                await addRegistryDependencies(component.registryDependencies);
              }
          }
        }

        if (!payload.length) {
          logger.warn("Selected components not found. Exiting.");
          process.exit(0);
        }

      if (!options.yes) {
        const { proceed } = await prompts({
          type: "confirm",
          name: "proceed",
          message: `Ready to install components and dependencies. Proceed?`,
          initial: true,
        });

        if (!proceed) {
          process.exit(0);
        }
      }

      const spinner = ora(`Installing components...`).start();
      // If we have registryDependencies we install them first
      for (const item of registryDependencies) {
        spinner.text = `Installing ${item.name}...`;
        const targetDir = await getItemTargetPath(
          config,
          item,
          undefined
        );

        if (!targetDir) {
          continue;
        }

        if (!existsSync(targetDir)) {
          await fs.mkdir(targetDir, { recursive: true });
        }

        const existingComponent = item.files.filter((file: any) =>
          existsSync(path.resolve(targetDir, file.name))
        );

        if (existingComponent.length && !options.overwrite) {
          if (registryDependencies.includes(item.name)) {
            spinner.stop();
            const { overwrite } = await prompts({
              type: "confirm",
              name: "overwrite",
              message: `Component ${item.name} already exists. Would you like to overwrite?`,
              initial: false,
            });

            if (!overwrite) {
              logger.info(
                `Skipped ${item.name}. To overwrite, run with the ${chalk.green(
                  "--overwrite"
                )} flag.`
              );
              continue;
            }

            spinner.start(`Installing ${item.name}...`);
          } else {
            continue;
          }
        }

        for (const file of item.files) {
          let filePath = path.resolve(targetDir, file.path? file.path : file.name);
          const directory = path.dirname(filePath);

          // Create the directory if it does not exist.
          await fs.mkdir(directory, { recursive: true });

          // Run transformers.
          const content = await transform({
            filename: file.name,
            raw: file.content,
            config,
            baseColor,
          });

          if (!config.tsx) {
            filePath = filePath.replace(/\.tsx$/, ".jsx");
            filePath = filePath.replace(/\.ts$/, ".js");
          }

          await fs.writeFile(filePath, content);
        }

        await installComponentDependencies(cwd, item);

      }
      for (const item of payload) {
        spinner.text = `Installing ${item.name}...`;
        const targetDir = await getItemTargetPath(
          config,
          item,
          options.path ? path.resolve(cwd, options.path) : undefined
        );

        if (!targetDir) {
          continue;
        }

        if (!existsSync(targetDir)) {
          await fs.mkdir(targetDir, { recursive: true });
        }

        const existingComponent = item.files.filter((file: any) =>
          existsSync(path.resolve(targetDir, file.name))
        );


        if (existingComponent.length && !options.overwrite) {
          if (selectedComponents.includes(item.name)) {
            spinner.stop();
            const { overwrite } = await prompts({
              type: "confirm",
              name: "overwrite",
              message: `Component ${item.name} already exists. Would you like to overwrite?`,
              initial: false,
            });

            if (!overwrite) {
              logger.info(
                `Skipped ${item.name}. To overwrite, run with the ${chalk.green(
                  "--overwrite"
                )} flag.`
              );
              continue;
            }

            spinner.start(`Installing ${item.name}...`);
          } else {
            continue;
          }
        }

        for (const file of item.files) {
          let filePath = path.resolve(targetDir, file.path? file.path : file.name);
          const directory = path.dirname(filePath);

          // Create the directory if it does not exist.
          await fs.mkdir(directory, { recursive: true });

          // Run transformers.
          const content = await transform({
            filename: file.name,
            raw: file.content,
            config,
            baseColor,
          });

          if (!config.tsx) {
            filePath = filePath.replace(/\.tsx$/, ".jsx");
            filePath = filePath.replace(/\.ts$/, ".js");
          }

          await fs.writeFile(filePath, content);
        }

        await installComponentDependencies(cwd, item);

      }
      spinner.succeed(`Done.`);
    } catch (error) {
      handleError(error);
    }
  });
async function installComponentDependencies(cwd: string, item: any) {
  const packageManager = await getPackageManager(cwd);

  // Install dependencies.
  if (item.dependencies?.length) {
    await execa(
      packageManager,
      [
        packageManager === "npm" ? "install" : "add",
        ...item.dependencies,
      ],
      {
        cwd,
      }
    );
  }

  // Install devDependencies.
  if (item.devDependencies?.length) {
    await execa(
      packageManager,
      [
        packageManager === "npm" ? "install" : "add",
        "-D",
        ...item.devDependencies,
      ],
      {
        cwd,
      }
    );
  }
}

