const ui = [
  {
    name: "google-gemini-effect",
    type: "components:ui",
    dependencies: ["framer-motion", "clsx", "tailwind-merge"],
    files: ["ui/google-gemini-effect.tsx"],
  },
  {
    name: "typewriter-effect",
    type: "components:ui",
    dependencies: ["framer-motion", "clsx", "tailwind-merge"],
    files: ["ui/typewriter-effect.tsx"],
  },
];

const example = [
  {
    name: "google-gemini-effect-demo",
    type: "components:example",
    registryDependencies: ["google-gemini-effect"],
    files: ["example/google-gemini-effect-demo.tsx"],
  },
  {
    name: "typewriter-effect-demo",
    type: "components:example",
    registryDependencies: ["typewriter-effect"],
    files: ["example/typewriter-effect-demo.tsx"],
  },
];


const registry = [...ui, ...example];
export {registry};