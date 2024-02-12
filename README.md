
# shadxn
[Getting Started](https://medium.com/@anis.marrouchi/revolutionizing-component-management-with-shadxn-73569fdfd0d6)

`shadxn` is an experimental CLI tool that builds upon the foundation of the `shadcn-ui` CLI. It is designed to enhance your development workflow by allowing the integration of components and dependencies into your project. This tool introduces the flexibility of selecting component registries, enabling developers to add custom registries for personalized or public sharing of components. We extend our deepest gratitude to the `shadcn-ui` project and its contributors for their foundational work that made `shadxn` possible.

## Acknowledgment 
This project builds on top of the original `Shadcn UI` CLI. We are deeply grateful to `Shadcn` and all contributors to the `Shadcn UI` project for their pioneering work and for laying the groundwork that `shadxn` now builds upon.
 -  **Project:** Shadcn UI
 -  **Author:** [Shadcn](https://twitter.com/shadcn) 
 -  **License:** MIT 
 -  **Source:** [https://github.com/shadcn/ui](https://github.com/shadcn-ui/ui)

## Features

- **Custom Registry Support:** Initialize and manage custom registries to declare your own components.
- **Enhanced `add` Command:** Add components from a selected registry, allowing for greater flexibility and customization.
- **Project Initialization:** Initialize your project with default registries in `components.js`, preparing it for immediate development.
- **Compatibility:** Extendable to various frameworks and libraries, `shadxn` is designed to fit into any development ecosystem.

## Installation

`shadxn` can be installed using various package managers or run directly with `npx` for immediate usage without global installation. Choose the method that best fits your workflow:

### Using npm

```bash
npm install -g shadxn
```

This command installs `shadxn` globally on your machine, making it accessible from anywhere in your terminal.

### Using Yarn

```bash
yarn global add shadxn
```

Yarn users can also install `shadxn` globally, ensuring it's available from any terminal session.

### Using pnpm

```bash
pnpm add -g shadxn
```

For those preferring `pnpm` for its efficient handling of node modules, this command will globally install `shadxn`.

### Using Bun

```bash
bun add -g shadxn
```

If you're using `Bun`, a modern JavaScript runtime, this command will globally install `shadxn` on your system.

### Using npx (No Installation Required)

For a quick, one-time use, you can run `shadxn` directly with `npx` without needing to install it globally:

```bash
npx shadxn [command]
```

This method is particularly useful for running the latest version of `shadxn` without affecting your global package setup.

## Usage

```bash
Usage: shadxn [options] [command]

Options:
  -v, --version                  display the version number
  -h, --help                     display help for command

Commands:
  init [options]                 initialize your project and install dependencies, adds default registries
  add [options] [components...]  add components to your project from selected registries
  diff [options] [component]     check for component updates against the registry
  registry <action> [project]    manage the project's component registry
  help [command]                 display help for command
```

### Commands in Detail

- **init:** Sets up your project with essential dependencies and a default registry in `components.js` for components management.
- **add:** Enhances the original `add` command to allow selection of a registry for component retrieval, streamlining the addition of components to your project.
- **registry:** A new command to initialize and manage custom registries, supporting actions like `init` for registry setup and `build` for registry deployment.

### Examples

```bash
# Initialize your project
npx shadxn init

# Add a component from a shadcn registry
npx shadxn add button

# Or create and use your custom registry
# 1. Create your custom registry
npx shadxn registry init
# Start adding your custom components and declare them within the registry/registry.tsx file
# 2. Build your custom registry
npx shadxn registry build

# 3. Run your local registry or deploy to Vercel
pnpm run dev

# 4. Activate your custom registry
npx shadxn registry activate my-registry

# 5. Add a component from your custom registry
npx shadxn add your-component -r my-registry
```

## Documentation

For more detailed information and documentation, visit [https://ui.shadcn.com/docs/cli](https://ui.shadcn.com/docs/cli).

## License

`shadxn` is licensed under the [MIT license](https://github.com/anis-marrouchi/shadxn/blob/main/LICENSE.md).

## Objective and Current State

The main objectives of `shadxn` are to:
- Allow the addition of custom registries for tailored component management.
- Provide an unopinionated tool that integrates into any workflow without restriction.
- Enable the creation of custom registries for either internal use or public sharing.
- Extend its utility across different frameworks and libraries, promoting versatility in development environments.

As an experimental project, `shadxn` is in active development, and contributions, feedback, and suggestions are welcome to enhance its capabilities and reach.
