interface ImportMetaEnv {
  readonly AJT_RUNTIME: boolean;
}
declare module 'virtual:ajt-runtime-db' {
  export const runtimeEnabled: boolean;
  export function publishedRows(collection: string): Promise<any[]>;
}
