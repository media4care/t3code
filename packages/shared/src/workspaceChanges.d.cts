export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly hasTest: boolean;
  readonly deps: ReadonlyArray<string>;
}

/** @public -- CommonJS imports resolve the implementation rather than this declaration. */
export function decide(
  files: ReadonlyArray<string> | null,
  packages: ReadonlyArray<WorkspacePackage>,
  full: boolean,
  t3Rules?: boolean,
): {
  affected: Array<string>;
  outputs: {
    typecheck: boolean;
    build: boolean;
    test: boolean;
    test_packages: string;
    test_web: boolean;
    test_server: boolean;
    rust: boolean;
    release_smoke: boolean;
    mobile_native: boolean;
  };
};

export interface WorkspaceManifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly scripts?: Record<string, string>;
}
/** @public -- CommonJS imports resolve the implementation rather than this declaration. */
export function workspacePatterns(contents: string): Array<string>;
/** @public -- CommonJS imports resolve the implementation rather than this declaration. */
export function workspacePackage(
  manifest: WorkspaceManifest,
  dir: string,
  t3Rules?: boolean,
): WorkspacePackage;

/** @public -- CommonJS imports resolve the implementation rather than this declaration. */
export const CHECK_INPUT_PATHS: ReadonlyArray<string>;
/** @public -- CommonJS imports resolve the implementation rather than this declaration. */
export const INSTALL_INPUTS: ReadonlyArray<string>;
