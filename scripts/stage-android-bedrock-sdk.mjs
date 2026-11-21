import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [runtimeRoot, version] = process.argv.slice(2);
if (!runtimeRoot || !version) throw new Error('Expected an isolated npm install directory and a Bedrock version');

const modules = path.join(runtimeRoot, 'node_modules');
const minecraftData = path.join(modules, 'minecraft-data');
const dataRoot = path.join(minecraftData, 'minecraft-data', 'data');
const originalData = path.join(runtimeRoot, 'original-minecraft-data');
const allPaths = JSON.parse(fs.readFileSync(path.join(dataRoot, 'dataPaths.json'), 'utf8'));
const selected = allPaths.bedrock[version];
if (!selected) throw new Error(`Missing Minecraft data for ${version}`);

fs.renameSync(dataRoot, originalData);
for (const family of ['pc', 'bedrock']) {
  fs.cpSync(path.join(originalData, family, 'common'), path.join(dataRoot, family, 'common'), { recursive: true });
}
for (const [name, directory] of Object.entries(selected)) {
  const source = path.join(originalData, directory);
  const target = path.join(dataRoot, directory);
  const files = fs.readdirSync(source).filter(file => file.startsWith(name + '.'));
  if (files.length === 0) throw new Error(`Missing data entry ${directory}/${name}`);
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
}

fs.writeFileSync(path.join(dataRoot, 'dataPaths.json'), JSON.stringify({ pc: {}, bedrock: { [version]: selected } }));
execFileSync(process.execPath, [path.join(minecraftData, 'bin', 'generate_data.js')]);

// Friend-hosted worlds use NetherNet. Desktop RakNet implementations are excluded from this probe.
for (const name of ['raknet-native', 'raknet-node', '.bin', '.package-lock.json']) {
  fs.rmSync(path.join(modules, name), { recursive: true, force: true });
}

// The compatibility import uses jsp-raknet's compiled JavaScript and never invokes its compiler.
fs.rmSync(path.join(modules, 'jsp-raknet', 'node_modules', 'typescript'), { recursive: true, force: true });
