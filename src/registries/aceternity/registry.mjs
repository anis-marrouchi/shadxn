import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let components = {};

function processDirectory(dirPath, basePath = '', parentComponentName = '', type = '', isSubcomponent = false) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Determine if the current directory is a component or part of a larger component
    const isComponent = basePath === '' || isSubcomponent;

    entries.forEach(entry => {
        const entryPath = path.join(dirPath, entry.name);
        const relativePath = path.join(basePath, entry.name);
        
        if (entry.isDirectory()) {
            // Check if the directory is a known subdirectory that should not be treated as a separate component
            if (entry.name === 'components' && !isComponent) {
                // Process as part of the current component
                processDirectory(entryPath, relativePath, parentComponentName, type, true);
            } else {
                // Process as a new component
                const componentName = entry.name;
                const uniqueKey = `${componentName}:${type}`;
                if (!components[uniqueKey]) {
                    components[uniqueKey] = {
                        name: componentName,
                        type: `components:${type}`,
                        files: [],
                        dependencies: [],
                        registryDependencies: [],
                    };
                }
                processDirectory(entryPath, relativePath, componentName, type, false);
            }
        } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
            // Process the file and add it to the appropriate component
            processFile(entryPath, relativePath, parentComponentName || basePath, type);
        }
    });
}


function processFile(filePath, relativePath, componentName, type) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const uniqueKey = componentName ? `${componentName}:${type}` : `${path.basename(filePath, path.extname(filePath))}:${type}`;

    if (!components[uniqueKey]) {
        components[uniqueKey] = {
            name: componentName || path.basename(filePath, path.extname(filePath)),
            type: `components:${type}`,
            files: [],
            dependencies: [],
            registryDependencies: [],
        };
    }

    let component = components[uniqueKey];
    component.files.push(relativePath);
    component.dependencies = [...new Set([...component.dependencies, ...extractDependencies(content)])];
    component.registryDependencies = [...new Set([...component.registryDependencies, ...extractRegistryDependencies(content)])];
}

function extractDependencies(content) {
    const npmDependencies = [];
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const dependency = match[1];
        // Check if dependency is not a relative or alias import
        if (!dependency.startsWith('.') && !dependency.startsWith('@/')) {
            // Split the dependency name on '/'
            const parts = dependency.split('/');
            // Check for scoped package or normal package with optional sub-package
            const isValidDependency = parts.length === 2 ? (parts[0].startsWith('@') && parts[1].length > 0) : parts.length === 1;
            // Exclude 'next' and 'react', but include their sub-packages
            if (isValidDependency && !(dependency === 'next' || dependency === 'react')) {
                npmDependencies.push(dependency);
            }
        }
    }
    return npmDependencies;
}


function extractRegistryDependencies(content) {
    const localDependencies = [];
    const importRegex = /from\s+['"]@\/([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        localDependencies.push(match[1].replace(/\.(tsx|ts)$/, ''));
    }
    return localDependencies;
}

const baseDirs = ['ui', 'example', 'page'];
baseDirs.forEach(type => {
    const dirPath = path.join(__dirname, 'default', type);
    if (fs.existsSync(dirPath)) {
        processDirectory(dirPath, '', '', type);
    }
});

export const registry = Object.values(components);
