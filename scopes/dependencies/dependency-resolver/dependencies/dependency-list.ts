import { uniqBy, property } from 'lodash';
import { Dependency, DependencyLifecycleType, SerializedDependency, SemverVersion, PackageName } from './dependency';
import { KEY_NAME_BY_LIFECYCLE_TYPE } from './constants';
import { ComponentDependency } from './component-dependency';

export type LifecycleDependenciesManifest = Record<PackageName, SemverVersion>;

export interface DependenciesManifest {
  dependencies?: LifecycleDependenciesManifest;
  devDependencies?: LifecycleDependenciesManifest;
  peerDependencies?: LifecycleDependenciesManifest;
}

export type FindDependencyOptions = {
  ignoreVersion?: boolean;
};
export class DependencyList {
  constructor(private _dependencies: Array<Dependency>) {
    this._dependencies = uniqDeps(_dependencies);
  }
  // constructor(private _dependencies: Dependency[]){}

  get dependencies(): Dependency[] {
    return this._dependencies;
  }

  sort(): DependencyList {
    const sorted = this.dependencies.sort((a, b) => {
      if (a.id < b.id) {
        return -1;
      }
      if (a.id > b.id) {
        return 1;
      }
      return 0;
    });
    return new DependencyList(sorted);
  }

  /**
   * @param componentIdStr complete string include the scope and the version
   */
  findDependency(componentIdStr: string, opts: FindDependencyOptions = {}): Dependency | undefined {
    const ignoreVersion = opts.ignoreVersion;
    if (!ignoreVersion) {
      return this.dependencies.find((dep) => dep.id === componentIdStr);
    }
    const componentIdStrWithoutVersion = removeVersion(componentIdStr);
    return this.dependencies.find((dep) => removeVersion(dep.id) === componentIdStrWithoutVersion);
  }

  forEach(predicate: (dep: Dependency, index?: number) => void): void {
    this.dependencies.forEach(predicate);
  }

  map(predicate: (dep: Dependency, index?: number) => any) {
    return this.dependencies.map(predicate);
  }

  filter(predicate: (dep: Dependency, index?: number) => boolean): DependencyList {
    const filtered = this.dependencies.filter(predicate);
    return DependencyList.fromArray(filtered);
  }

  toTypeArray<T extends Dependency>(typeName: string): T[] {
    const list: T[] = this.dependencies.filter((dep) => dep.type === typeName) as any as T[];
    return list;
  }

  byTypeName(typeName: string): DependencyList {
    const filtered = this.dependencies.filter((dep) => dep.type === typeName);
    return DependencyList.fromArray(filtered);
  }

  byLifecycle(lifecycle: DependencyLifecycleType): DependencyList {
    const filtered = this.dependencies.filter((dep) => dep.lifecycle === lifecycle);
    return DependencyList.fromArray(filtered);
  }

  serialize(): SerializedDependency[] {
    const serialized = this.dependencies.map((dep) => {
      return dep.serialize();
    });
    return serialized;
  }

  getComponentDependencies(): ComponentDependency[] {
    return this.dependencies.filter((dep) => dep instanceof ComponentDependency) as ComponentDependency[];
  }

  toDependenciesManifest(): Required<DependenciesManifest> {
    const manifest: Required<DependenciesManifest> = {
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    };
    this.forEach((dep) => {
      const keyName = KEY_NAME_BY_LIFECYCLE_TYPE[dep.lifecycle];
      const entry = dep.toManifest();
      if (entry) {
        manifest[keyName][entry.packageName] = entry.version;
      }
    });
    return manifest;
  }

  static merge(lists: DependencyList[]): DependencyList {
    const res: Dependency[] = [];
    const deps = lists.reduce((acc, curr) => {
      acc = acc.concat(curr.dependencies);
      return acc;
    }, res);
    return new DependencyList(deps);
  }

  static fromArray(dependencies: Array<Dependency>) {
    return new DependencyList(dependencies);
  }
}

function uniqDeps(dependencies: Array<Dependency>): Array<Dependency> {
  const uniq = uniqBy(dependencies, property('id'));
  return uniq;
}

function removeVersion(id: string): string {
  if (id.startsWith('@')) return id.split('@')[1]; // scoped package
  return id.split('@')[0];
}
