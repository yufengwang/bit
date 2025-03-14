import { Analytics } from '@teambit/legacy/dist/analytics/analytics';
import { DEFAULT_LANGUAGE, WORKSPACE_JSONC } from '@teambit/legacy/dist/constants';
import { ResolveModulesConfig } from '@teambit/legacy/dist/consumer/component/dependencies/files-dependency-builder/types/dependency-tree-type';
import { AbstractVinyl } from '@teambit/legacy/dist/consumer/component/sources';
import DataToPersist from '@teambit/legacy/dist/consumer/component/sources/data-to-persist';
import { ExtensionDataList, ILegacyWorkspaceConfig } from '@teambit/legacy/dist/consumer/config';
import { InvalidBitJson } from '@teambit/legacy/dist/consumer/config/exceptions';
import LegacyWorkspaceConfig, {
  WorkspaceConfigProps as LegacyWorkspaceConfigProps,
} from '@teambit/legacy/dist/consumer/config/workspace-config';
import logger from '@teambit/legacy/dist/logger/logger';
import { PathOsBased, PathOsBasedAbsolute } from '@teambit/legacy/dist/utils/path';
import { assign, parse, stringify, CommentJSONValue } from 'comment-json';
import * as fs from 'fs-extra';
import * as path from 'path';
import { isEmpty, omit } from 'lodash';

import { SetExtensionOptions } from './config.main.runtime';
import { ExtensionAlreadyConfigured } from './exceptions';
import { ConfigDirNotDefined } from './exceptions/config-dir-not-defined';
import InvalidConfigFile from './exceptions/invalid-config-file';
import { HostConfig } from './types';

const INTERNAL_CONFIG_PROPS = ['$schema', '$schemaVersion'];

export type LegacyInitProps = {
  standAlone?: boolean;
};

export type WorkspaceConfigFileProps = {
  // TODO: make it no optional
  $schema?: string;
  $schemaVersion?: string;
} & ExtensionsDefs;

export type ComponentScopeDirMapEntry = {
  defaultScope?: string;
  directory: string;
};

export type ComponentScopeDirMap = Array<ComponentScopeDirMapEntry>;

export type WorkspaceExtensionProps = {
  defaultOwner?: string;
  defaultScope?: string;
  defaultDirectory?: string;
  components?: ComponentScopeDirMap;
};

export type PackageManagerClients = 'npm' | 'yarn' | undefined;

export interface DependencyResolverExtensionProps {
  packageManager: PackageManagerClients;
  strictPeerDependencies?: boolean;
  extraArgs?: string[];
  packageManagerProcessOptions?: any;
  useWorkspaces?: boolean;
  manageWorkspaces?: boolean;
}

export type WorkspaceSettingsNewProps = {
  'teambit.workspace/workspace': WorkspaceExtensionProps;
  'teambit.dependencies/dependency-resolver': DependencyResolverExtensionProps;
};

export type WorkspaceLegacyProps = {
  dependenciesDirectory?: string;
  bindingPrefix?: string;
  resolveModules?: ResolveModulesConfig;
  saveDependenciesAsComponents?: boolean;
};

export type ExtensionsDefs = WorkspaceSettingsNewProps;

export class WorkspaceConfig implements HostConfig {
  raw?: any;
  _path?: string;
  _extensions: ExtensionDataList;
  _legacyProps?: WorkspaceLegacyProps;
  isLegacy: boolean;

  constructor(private data?: WorkspaceConfigFileProps, private legacyConfig?: LegacyWorkspaceConfig) {
    this.isLegacy = Boolean(legacyConfig);
    const isHarmony = !this.isLegacy;
    logger.debug(`workspace-config, isLegacy: ${this.isLegacy}`);
    Analytics.setExtraData('is_harmony', isHarmony);
    this.raw = data;
    this.loadExtensions();
  }

  get path(): PathOsBased {
    return this._path || this.legacyConfig?.path || '';
  }

  set path(configPath: PathOsBased) {
    this._path = configPath;
  }

  get extensions(): ExtensionDataList {
    return this._extensions;
  }

  private loadExtensions() {
    const withoutInternalConfig = omit(this.raw, INTERNAL_CONFIG_PROPS);
    this._extensions = ExtensionDataList.fromConfigObject(withoutInternalConfig);
  }

  extension(extensionId: string, ignoreVersion: boolean): any {
    const existing = this.extensions.findExtension(extensionId, ignoreVersion);
    return existing?.config;
  }

  setExtension(extensionId: string, config: Record<string, any>, options: SetExtensionOptions): any {
    const existing = this.extension(extensionId, options.ignoreVersion);
    if (existing) {
      if (options.mergeIntoExisting) {
        config = { ...existing, ...config };
      } else if (!options.overrideExisting) {
        throw new ExtensionAlreadyConfigured(extensionId);
      }
    }

    this.raw[extensionId] = config;
    this.loadExtensions();
  }

  /**
   * Create an instance of the WorkspaceConfig by an instance of the legacy config
   *
   * @static
   * @param {*} legacyConfig
   * @returns
   * @memberof WorkspaceConfig
   */
  static fromLegacyConfig(legacyConfig) {
    return new WorkspaceConfig(undefined, legacyConfig);
  }

  /**
   * Create an instance of the WorkspaceConfig by data
   *
   * @static
   * @param {WorkspaceConfigFileProps} data
   * @returns
   * @memberof WorkspaceConfig
   */
  static fromObject(data: WorkspaceConfigFileProps) {
    return new WorkspaceConfig(data, undefined);
  }

  /**
   * Create an instance of the WorkspaceConfig by the workspace config template and override values
   *
   * @static
   * @param {WorkspaceConfigFileProps} data values to override in the default template
   * @returns
   * @memberof WorkspaceConfig
   */
  static async create(props: WorkspaceConfigFileProps, dirPath?: PathOsBasedAbsolute) {
    const template = await getWorkspaceConfigTemplateParsed();
    // TODO: replace this assign with some kind of deepAssign that keeps the comments
    // right now the comments above the internal props are overrides after the assign
    const merged = assign(template, props);
    const instance = new WorkspaceConfig(merged, undefined);
    if (dirPath) {
      instance.path = WorkspaceConfig.composeWorkspaceJsoncPath(dirPath);
    }
    return instance;
  }

  /**
   * Ensure the given directory has a workspace config
   * Load if existing and create new if not
   *
   * @static
   * @param {PathOsBasedAbsolute} dirPath
   * @param {WorkspaceConfigFileProps} [workspaceConfigProps={} as any]
   * @returns {Promise<WorkspaceConfig>}
   * @memberof WorkspaceConfig
   */
  static async ensure(
    dirPath: PathOsBasedAbsolute,
    workspaceConfigProps: WorkspaceConfigFileProps = {} as any
  ): Promise<WorkspaceConfig> {
    try {
      let workspaceConfig = await this.loadIfExist(dirPath);
      if (workspaceConfig) {
        return workspaceConfig;
      }
      workspaceConfig = await this.create(workspaceConfigProps, dirPath);
      return workspaceConfig;
    } catch (err: any) {
      if (err instanceof InvalidBitJson || err instanceof InvalidConfigFile) {
        const workspaceConfig = this.create(workspaceConfigProps, dirPath);
        return workspaceConfig;
      }
      throw err;
    }
  }

  /**
   * A function that register to the legacy ensure function in order to transform old props structure
   * to the new one
   * @param dirPath
   * @param standAlone
   * @param legacyWorkspaceConfigProps
   */
  static async onLegacyEnsure(
    dirPath: PathOsBasedAbsolute,
    standAlone: boolean,
    legacyWorkspaceConfigProps: LegacyWorkspaceConfigProps = {} as any
  ): Promise<WorkspaceConfig> {
    const newProps: WorkspaceConfigFileProps = transformLegacyPropsToExtensions(legacyWorkspaceConfigProps);
    // TODO: gilad move to constants file
    newProps.$schemaVersion = '1.0.0';
    return WorkspaceConfig.ensure(dirPath, newProps);
  }

  static async reset(dirPath: PathOsBasedAbsolute, resetHard: boolean): Promise<void> {
    const workspaceJsoncPath = WorkspaceConfig.composeWorkspaceJsoncPath(dirPath);
    if (resetHard && workspaceJsoncPath) {
      logger.info(`deleting the consumer workspace.jsonc file at ${workspaceJsoncPath}`);
      await fs.remove(workspaceJsoncPath);
    }
  }

  /**
   * Get the path of the bit.jsonc file by a containing folder
   *
   * @static
   * @param {PathOsBased} dirPath containing dir of the bit.jsonc file
   * @returns {PathOsBased}
   * @memberof WorkspaceConfig
   */
  static composeWorkspaceJsoncPath(dirPath: PathOsBased): PathOsBased {
    return path.join(dirPath, WORKSPACE_JSONC);
  }

  static async pathHasWorkspaceJsonc(dirPath: PathOsBased): Promise<boolean> {
    const isExist = await fs.pathExists(WorkspaceConfig.composeWorkspaceJsoncPath(dirPath));
    return isExist;
  }

  /**
   * Check if the given dir has workspace config (new or legacy)
   * @param dirPath
   */
  static async isExist(dirPath: PathOsBased): Promise<boolean | undefined> {
    const jsoncExist = await WorkspaceConfig.pathHasWorkspaceJsonc(dirPath);
    if (jsoncExist) {
      return true;
    }
    return LegacyWorkspaceConfig._isExist(dirPath);
  }

  /**
   * Load the workspace configuration if it's exist
   *
   * @static
   * @param {PathOsBased} dirPath
   * @returns {(Promise<WorkspaceConfig | undefined>)}
   * @memberof WorkspaceConfig
   */
  static async loadIfExist(dirPath: PathOsBased): Promise<WorkspaceConfig | undefined> {
    const jsoncExist = await WorkspaceConfig.pathHasWorkspaceJsonc(dirPath);
    if (jsoncExist) {
      const jsoncPath = WorkspaceConfig.composeWorkspaceJsoncPath(dirPath);
      const instance = await WorkspaceConfig._loadFromWorkspaceJsonc(jsoncPath);
      instance.path = jsoncPath;
      return instance;
    }
    const legacyConfig = await LegacyWorkspaceConfig._loadIfExist(dirPath);
    if (legacyConfig) {
      return WorkspaceConfig.fromLegacyConfig(legacyConfig);
    }
    return undefined;
  }

  static async _loadFromWorkspaceJsonc(workspaceJsoncPath: PathOsBased): Promise<WorkspaceConfig> {
    const contentBuffer = await fs.readFile(workspaceJsoncPath);
    let parsed;
    try {
      parsed = parse(contentBuffer.toString());
    } catch (e: any) {
      throw new InvalidConfigFile(workspaceJsoncPath);
    }
    return WorkspaceConfig.fromObject(parsed);
  }

  async write({ dir }: { dir?: PathOsBasedAbsolute }): Promise<void> {
    const calculatedDir = dir || this._path;
    if (!calculatedDir) {
      throw new ConfigDirNotDefined();
    }
    if (this.data) {
      const files = await this.toVinyl(calculatedDir);
      const dataToPersist = new DataToPersist();
      if (files) {
        dataToPersist.addManyFiles(files);
        return dataToPersist.persistAllToFS();
      }
    }
    await this.legacyConfig?.write({ workspaceDir: calculatedDir });
    return undefined;
  }

  async toVinyl(workspaceDir: PathOsBasedAbsolute): Promise<AbstractVinyl[] | undefined> {
    if (this.data) {
      const jsonStr = stringify(this.data, undefined, 2);
      const base = workspaceDir;
      const fullPath = workspaceDir ? WorkspaceConfig.composeWorkspaceJsoncPath(workspaceDir) : this.path;
      const jsonFile = new AbstractVinyl({ base, path: fullPath, contents: Buffer.from(jsonStr) });
      return [jsonFile];
    }
    return this.legacyConfig?.toVinyl({ workspaceDir });
  }

  _legacyPlainObject(): { [prop: string]: any } | undefined {
    if (this.legacyConfig) {
      return this.legacyConfig.toPlainObject();
    }
    return undefined;
  }

  toLegacy(): ILegacyWorkspaceConfig {
    let componentsDefaultDirectory = this.extension('teambit.workspace/workspace', true)?.defaultDirectory;
    if (componentsDefaultDirectory && !componentsDefaultDirectory.includes('{name}')) {
      componentsDefaultDirectory = `${componentsDefaultDirectory}/{name}`;
    }

    return {
      lang: this.legacyConfig?.lang || DEFAULT_LANGUAGE,
      defaultScope: this.extension('teambit.workspace/workspace', true)?.defaultScope,
      _useWorkspaces: this.extension('teambit.dependencies/dependency-resolver', true)?.useWorkspaces,
      dependencyResolver: this.extension('teambit.dependencies/dependency-resolver', true),
      packageManager: this.extension('teambit.dependencies/dependency-resolver', true)?.packageManager,
      _bindingPrefix: this.extension('teambit.workspace/workspace', true)?.defaultOwner,
      _saveDependenciesAsComponents: this._legacyProps?.saveDependenciesAsComponents,
      _dependenciesDirectory: this._legacyProps?.dependenciesDirectory,
      componentsDefaultDirectory,
      _resolveModules: this._legacyProps?.resolveModules,
      _manageWorkspaces: this.extension('teambit.dependencies/dependency-resolver', true)?.manageWorkspaces,
      defaultOwner: this.extension('teambit.workspace/workspace', true)?.defaultOwner,
      extensions: this.extensions.toConfigObject(),
      // @ts-ignore
      path: this.path,
      isLegacy: this.isLegacy,
      write: ({ workspaceDir }) => this.write.call(this, { dir: workspaceDir }),
      toVinyl: this.toVinyl.bind(this),
      componentsConfig: this.legacyConfig ? this.legacyConfig?.overrides : undefined,
      getComponentConfig: this.legacyConfig
        ? this.legacyConfig?.overrides.getOverrideComponentData.bind(this.legacyConfig?.overrides)
        : () => undefined,
      _legacyPlainObject: this.legacyConfig
        ? this.legacyConfig?.toPlainObject.bind(this.legacyConfig)
        : () => undefined,
    };
  }
}

export function transformLegacyPropsToExtensions(
  legacyConfig: LegacyWorkspaceConfig | LegacyWorkspaceConfigProps
): ExtensionsDefs {
  // TODO: move to utils
  const removeUndefined = (obj) => {
    // const res = omit(mapObjIndexed((val) => val === undefined))(obj);
    // return res;
    Object.entries(obj).forEach((e) => {
      if (e[1] === undefined) delete obj[e[0]];
    });
    return obj;
  };

  const workspace = removeUndefined({
    defaultScope: legacyConfig.defaultScope,
    defaultDirectory: legacyConfig.componentsDefaultDirectory,
    defaultOwner: legacyConfig.bindingPrefix,
  });
  const dependencyResolver = removeUndefined({
    packageManager: legacyConfig.packageManager,
    // strictPeerDependencies: false,
    extraArgs: legacyConfig.packageManagerArgs,
    packageManagerProcessOptions: legacyConfig.packageManagerProcessOptions,
    manageWorkspaces: legacyConfig.manageWorkspaces,
    useWorkspaces: legacyConfig.useWorkspaces,
  });
  const variants = legacyConfig.overrides?.overrides;
  const data = {};
  if (workspace && !isEmpty(workspace)) {
    data['teambit.workspace/workspace'] = workspace;
  }
  if (dependencyResolver && !isEmpty(dependencyResolver)) {
    data['teambit.dependencies/dependency-resolver'] = dependencyResolver;
  }
  // TODO: add variants here once we have a way to pass the deps overrides and general key vals for package.json to
  // TODO: new extensions (via dependency-resolver extension and pkg extensions)
  // TODO: transform legacy props to new one once dependency-resolver extension and pkg extensions are ready
  if (variants && !isEmpty(variants)) {
    data['teambit.workspace/variants'] = variants;
  }
  // @ts-ignore
  return data;
}

export async function getWorkspaceConfigTemplateParsed(): Promise<CommentJSONValue> {
  let fileContent: Buffer;
  try {
    fileContent = await fs.readFile(path.join(__dirname, 'workspace-template.jsonc'));
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // when the extension is compiled by tsc, it doesn't copy .jsonc files into the dists, grab it from src
    fileContent = await fs.readFile(path.join(__dirname, '..', 'workspace-template.jsonc'));
  }
  return parse(fileContent.toString());
}

export function stringifyWorkspaceConfig(workspaceConfig: CommentJSONValue): string {
  return stringify(workspaceConfig, undefined, 2);
}
