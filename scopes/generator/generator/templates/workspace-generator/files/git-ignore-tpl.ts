export function gitIgnoreTemplate() {
  return `export function gitIgnore() {
    return \`.idea/
.vscode/
.git
.bit
node_modules/
build
public
.DS_Store
*.tgz
template/src/__tests__/__snapshots__/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
/.changelog
.npm/
yarn.lock
\`;
  }
  `;
}